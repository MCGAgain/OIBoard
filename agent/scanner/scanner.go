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

	stats := s.st.RecalculateStats(now)
	_ = s.st.Save()
	return stats, nil
}

// IsIgnoredPath 检查路径是否包含默认忽略目录或临时文件
func IsIgnoredPath(path string) bool {
	clean := filepath.Clean(path)
	parts := strings.Split(clean, string(filepath.Separator))
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			continue
		}
		if defaultIgnoredDirs[strings.ToLower(part)] || (strings.HasPrefix(part, ".") && part != ".") {
			return true
		}
	}
	base := filepath.Base(clean)
	if strings.HasPrefix(base, ".") || strings.HasSuffix(base, "~") || strings.HasSuffix(base, ".tmp") || strings.HasSuffix(base, ".swp") {
		return true
	}
	return false
}

// FindFolderForPath 查找包含该文件的监控目录
func (s *Scanner) FindFolderForPath(path string) (string, bool) {
	clean := filepath.Clean(path)
	cfgSnap := s.cfg.Get()
	for _, f := range cfgSnap.Folders {
		if !f.Enabled {
			continue
		}
		cleanFolder := filepath.Clean(f.Path)
		if clean == cleanFolder {
			return cleanFolder, true
		}
		rel, err := filepath.Rel(cleanFolder, clean)
		if err == nil && !strings.HasPrefix(rel, "..") && !strings.HasPrefix(rel, "/") {
			return cleanFolder, true
		}
	}
	return "", false
}

// ProcessChangedFile 仅针对变动或新增的单个文件进行精确增量分析（极致轻量，无需遍历任何目录）
func (s *Scanner) ProcessChangedFile(path string) (bool, error) {
	cleanPath := filepath.Clean(path)
	if IsIgnoredPath(cleanPath) {
		return false, nil
	}
	lang, ok := ClassifyLanguage(cleanPath)
	if !ok {
		return false, nil
	}

	folderPath, inFolder := s.FindFolderForPath(cleanPath)
	if !inFolder {
		return false, nil
	}

	info, err := os.Stat(cleanPath)
	if err != nil {
		if os.IsNotExist(err) {
			return s.ProcessDeletedFile(cleanPath)
		}
		return false, err
	}
	if info.IsDir() {
		return false, nil
	}

	// 增量命中判定：文件大小与修改时间与缓存一致则直接跳过，零 CPU / 零磁盘读取开销
	cached, exists := s.st.GetFile(cleanPath)
	if exists && cached.Size == info.Size() && cached.ModTime == info.ModTime().UnixNano() {
		return false, nil
	}

	// 仅读取并统计该单个变动文件
	lines, err := FastCountLines(cleanPath)
	if err != nil {
		return false, err
	}

	now := time.Now()
	rec := store.FileRecord{
		Path:        cleanPath,
		Folder:      folderPath,
		Ext:         lang,
		Size:        info.Size(),
		ModTime:     info.ModTime().UnixNano(),
		Lines:       lines,
		LastScanned: now,
	}
	s.st.SetFile(rec)
	s.st.RecalculateStats(now)

	// 更新对应监控目录统计
	folderRecs := s.st.GetFilesByFolder(folderPath)
	folderLines := 0
	for _, fr := range folderRecs {
		folderLines += fr.Lines
	}
	s.cfg.UpdateFolderStats(folderPath, len(folderRecs), folderLines, now)
	_ = s.st.Save()

	return true, nil
}

// ProcessDeletedFile 仅对被删除的单个文件记录进行清理
func (s *Scanner) ProcessDeletedFile(path string) (bool, error) {
	cleanPath := filepath.Clean(path)
	cached, exists := s.st.GetFile(cleanPath)
	if !exists {
		return false, nil
	}

	s.st.DeleteFile(cleanPath)
	now := time.Now()
	s.st.RecalculateStats(now)

	if cached.Folder != "" {
		folderRecs := s.st.GetFilesByFolder(cached.Folder)
		folderLines := 0
		for _, fr := range folderRecs {
			folderLines += fr.Lines
		}
		s.cfg.UpdateFolderStats(cached.Folder, len(folderRecs), folderLines, now)
	}
	_ = s.st.Save()

	return true, nil
}
