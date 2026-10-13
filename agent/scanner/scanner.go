package scanner

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/store"
)

var defaultIgnoredDirs = map[string]bool{
	".git":                true,
	".svn":                true,
	".hg":                 true,
	".idea":               true,
	".vscode":             true,
	".clangd":             true,
	"node_modules":        true,
	"build":               true,
	"cmake-build-debug":   true,
	"cmake-build-release": true,
	"target":              true,
	"bin":                 true,
	"out":                 true,
	"obj":                 true,
	"dist":                true,
	".gradle":             true,
	".history":            true,
}

type Scanner struct {
	cfg   *config.Config
	st    *store.Store
	mu    sync.Mutex
	isScanning bool
}

func NewScanner(cfg *config.Config, st *store.Store) *Scanner {
	return &Scanner{
		cfg: cfg,
		st:  st,
	}
}

func (s *Scanner) IsScanning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isScanning
}

// ClassifyLanguage 判断文件是否属于目标源码语言 (.c, .cpp, .java 及扩展形式)
func ClassifyLanguage(path string) (string, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".c":
		return "c", true
	case ".cpp", ".cc", ".cxx":
		return "cpp", true
	case ".java":
		return "java", true
	default:
		return "", false
	}
}

// FastCountLines 高性能分块读取换行符计数器（借鉴 scc 算法，避免堆分配）
func FastCountLines(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	buf := make([]byte, 32*1024)
	count := 0
	hasBytes := false
	lastByte := byte(0)

	for {
		n, err := f.Read(buf)
		if n > 0 {
			hasBytes = true
			count += bytes.Count(buf[:n], []byte{'\n'})
			lastByte = buf[n-1]
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, err
		}
	}

	// 若文件非空且末尾没有换行符，将最后一行计入
	if hasBytes && lastByte != '\n' {
		count++
	}
	return count, nil
}

// ScanAll 执行全局增量扫描（forceFull 为 true 时强制重新统计已缓存文件）
func (s *Scanner) ScanAll(forceFull bool) (store.GlobalStats, error) {
	s.mu.Lock()
	if s.isScanning {
		s.mu.Unlock()
		return s.st.GetStats(), nil
	}
	s.isScanning = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.isScanning = false
		s.mu.Unlock()
	}()

	cfgSnap := s.cfg.Get()
	now := time.Now()

	for _, folder := range cfgSnap.Folders {
		if !folder.Enabled {
			continue
		}
		folderPath := filepath.Clean(folder.Path)
		fileInfo, err := os.Stat(folderPath)
		if err != nil || !fileInfo.IsDir() {
			continue
		}

		seenFiles := make(map[string]bool)
		folderFileCount := 0
		folderLineCount := 0

		_ = filepath.WalkDir(folderPath, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if defaultIgnoredDirs[strings.ToLower(name)] || (strings.HasPrefix(name, ".") && name != ".") {
					return filepath.SkipDir
				}
				return nil
			}

			lang, ok := ClassifyLanguage(path)
			if !ok {
				return nil
			}

			cleanPath := filepath.Clean(path)
			seenFiles[cleanPath] = true
			folderFileCount++

			info, err := d.Info()
			if err != nil {
				return nil
			}

			cached, exists := s.st.GetFile(cleanPath)
			// 增量命中判定：文件大小与最后修改时间完全一致
			if !forceFull && exists && cached.Size == info.Size() && cached.ModTime == info.ModTime().UnixNano() {
				folderLineCount += cached.Lines
				return nil
			}

			// 新增或修改过的文件：读取并重新计数
			lines, err := FastCountLines(cleanPath)
			if err != nil {
				if exists {
					folderLineCount += cached.Lines
				}
				return nil
			}

			record := store.FileRecord{
				Path:        cleanPath,
				Folder:      folderPath,
				Ext:         lang,
				Size:        info.Size(),
				ModTime:     info.ModTime().UnixNano(),
				Lines:       lines,
				LastScanned: now,
			}
			s.st.SetFile(record)
			folderLineCount += lines
			return nil
		})

		// 清理已在磁盘上删除的文件记录
		for _, rec := range s.st.GetAllFiles() {
			if filepath.Clean(rec.Folder) == folderPath {
				if !seenFiles[rec.Path] {
					s.st.DeleteFile(rec.Path)
				}
			}
		}

		s.cfg.UpdateFolderStats(folderPath, folderFileCount, folderLineCount, now)
	}

	// 汇总指标
	allRecords := s.st.GetAllFiles()
	stats := store.GlobalStats{
		LastScanAt: now,
	}

	// 计算今日起始时间戳 (当前本地日期的 00:00:00)
	y, m, d := now.Date()
	todayStartNano := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).UnixNano()

	for _, rec := range allRecords {
		stats.TotalFiles++
		stats.TotalLines += rec.Lines

		if rec.ModTime >= todayStartNano {
			stats.TodayFiles++
			stats.TodayLines += rec.Lines
		}

		switch rec.Ext {
		case "c":
			stats.CFiles++
			stats.CLines += rec.Lines
		case "cpp":
			stats.CPPFiles++
			stats.CPPLines += rec.Lines
		case "java":
			stats.JavaFiles++
			stats.JavaLines += rec.Lines
		}
	}

	// 保留原有的同步状态记录
	oldStats := s.st.GetStats()
	stats.LastSyncAt = oldStats.LastSyncAt
	stats.LastSyncErr = oldStats.LastSyncErr

	s.st.SetStats(stats)
	_ = s.st.Save()
	return stats, nil
}
