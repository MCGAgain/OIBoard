package scanner

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"syscall"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/store"
)

var errSkip = errors.New("skip file")

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
	cfg        *config.Config
	st         *store.Store
	mu         sync.Mutex
	isScanning bool
	opMu       sync.Mutex
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

// ClassifyLanguage 判断文件是否属于目标源码语言 (.c, .h, .cpp, .cc, .cxx, .hpp, .hh, .java)
func ClassifyLanguage(path string) (string, bool) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".c", ".h":
		return "c", true
	case ".cpp", ".cc", ".cxx", ".hpp", ".hh":
		return "cpp", true
	case ".java":
		return "java", true
	default:
		return "", false
	}
}

func inodeOf(info os.FileInfo) uint64 {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Ino)
	}
	return 0
}

// FastCountLinesAndHash 高性能分块读取换行符计数器并计算内容摘要（借鉴 scc 算法，避免堆分配；支持 20MB 大小过滤与二进制检查）
func FastCountLinesAndHash(path string) (int, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, "", err
	}
	defer f.Close()

	if fi, err := f.Stat(); err == nil && fi.Size() > 20<<20 { // >20MB 视为生成文件，跳过
		return 0, "", errSkip
	}

	buf := make([]byte, 32*1024)
	count := 0
	hasBytes := false
	lastByte := byte(0)
	first := true
	hasher := sha256.New()

	for {
		n, err := f.Read(buf)
		if n > 0 {
			if first {
				first = false
				if bytes.IndexByte(buf[:n], 0) >= 0 {
					return 0, "", errSkip // 含 \0，判定为二进制
				}
			}
			hasBytes = true
			hasher.Write(buf[:n])
			count += bytes.Count(buf[:n], []byte{'\n'})
			lastByte = buf[n-1]
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, "", err
		}
	}

	// 若文件非空且末尾没有换行符，将最后一行计入
	if hasBytes && lastByte != '\n' {
		count++
	}
	hashStr := ""
	if hasBytes {
		hashStr = hex.EncodeToString(hasher.Sum(nil)[:8])
	}
	return count, hashStr, nil
}

// FastCountLines 高性能分块读取换行符计数器（兼容既有接口）
func FastCountLines(path string) (int, error) {
	lines, _, err := FastCountLinesAndHash(path)
	return lines, err
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

	s.opMu.Lock()
	defer s.opMu.Unlock()

	cfgSnap := s.cfg.Get()
	now := time.Now()
	sep := string(filepath.Separator)

	for _, folder := range cfgSnap.Folders {
		if !folder.Enabled {
			continue
		}
		folderPath := filepath.Clean(folder.Path)
		fileInfo, err := os.Stat(folderPath)
		if err != nil || !fileInfo.IsDir() {
			continue // 根目录不可达（拔盘/权限），保留旧数据，等恢复后再对账
		}

		seenFiles := make(map[string]bool)
		var failed []string
		underFailed := func(p string) bool {
			for _, f := range failed {
				if p == f || strings.HasPrefix(p, f+sep) {
					return true
				}
			}
			return false
		}

		folderFileCount := 0
		folderLineCount := 0

		_ = filepath.WalkDir(folderPath, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				failed = append(failed, filepath.Clean(path))
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if defaultIgnoredDirs[strings.ToLower(name)] || (strings.HasPrefix(name, ".") && name != ".") {
					return filepath.SkipDir
				}
				return nil
			}

			cleanPath := filepath.Clean(path)
			if IsIgnoredPath(cleanPath) {
				return nil
			}

			lang, ok := ClassifyLanguage(cleanPath)
			if !ok {
				return nil
			}

			seenFiles[cleanPath] = true
			folderFileCount++

			info, err := d.Info()
			if err != nil {
				return nil
			}

			ino := inodeOf(info)
			cached, exists := s.st.GetFile(cleanPath)
			// 增量命中判定：文件大小与最后修改时间完全一致
			if !forceFull && exists && cached.Size == info.Size() && cached.ModTime == info.ModTime().UnixNano() {
				updated := false
				if cached.Inode == 0 && ino != 0 {
					cached.Inode = ino
					updated = true
				}
				if cached.FileUID == "" {
					cached.FileUID, cached.RelPath = DetermineFileIdentity(cleanPath, folderPath)
					updated = true
				}
				if updated {
					s.st.SetFile(cached)
				}
				folderLineCount += cached.Lines
				return nil
			}

			// 新增或修改过的文件：读取并重新计数及计算摘要
			lines, hashStr, err := FastCountLinesAndHash(cleanPath)
			if err != nil {
				if err == errSkip {
					if exists {
						s.st.DeleteFile(cleanPath)
					}
					return nil
				}
				if exists {
					folderLineCount += cached.Lines
				}
				return nil
			}

			fileUID, relPath := DetermineFileIdentity(cleanPath, folderPath)
			record := store.FileRecord{
				Path:        cleanPath,
				Folder:      folderPath,
				Ext:         lang,
				Inode:       ino,
				Size:        info.Size(),
				ModTime:     info.ModTime().UnixNano(),
				Lines:       lines,
				LastScanned: now,
				FileUID:     fileUID,
				RelPath:     relPath,
				ContentHash: hashStr,
			}
			s.st.SetFile(record)
			folderLineCount += lines
			return nil
		})

		// 外置盘被拔出/根目录不可达时，不能当作删除
		if _, err := os.Stat(folderPath); err != nil {
			continue // 根目录不可达（拔盘/权限），保留旧数据，等恢复后再对账
		}

		// 清理已在磁盘上删除的文件记录
		for _, rec := range s.st.GetAllFiles() {
			if filepath.Clean(rec.Folder) == folderPath {
				if !seenFiles[rec.Path] && !underFailed(rec.Path) {
					s.st.DeleteFile(rec.Path)
				}
			}
		}

		s.cfg.UpdateFolderStats(folderPath, folderFileCount, folderLineCount, now)
	}

	stats := s.st.RecalculateStats(now)
	s.st.MarkDirty()

	// 若单次扫描处理文件数较大（> 2000 个），通知 Go 运行时将未使用的堆内存归还操作系统
	if stats.TotalFiles > 2000 {
		debug.FreeOSMemory()
	}

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

// PathsUnder 返回库中位于 dir 之下的所有已记录文件路径
func (s *Scanner) PathsUnder(dir string) []string {
	prefix := filepath.Clean(dir) + string(filepath.Separator)
	var out []string
	for _, r := range s.st.GetAllFiles() {
		if strings.HasPrefix(r.Path, prefix) {
			out = append(out, r.Path)
		}
	}
	return out
}

// ProcessBatch 批量处理一个防抖窗口内的所有变动，末尾统一重算、统一标脏
func (s *Scanner) ProcessBatch(paths []string) bool {
	s.opMu.Lock()
	defer s.opMu.Unlock()

	now := time.Now()
	s.st.RolloverIfNeeded(now)

	type alive struct {
		path string
		info os.FileInfo
	}
	var present []alive
	var goneList []string
	goneByInode := map[uint64]string{} // inode -> 旧路径

	for _, p := range paths {
		p = filepath.Clean(p)
		info, err := os.Stat(p)
		if err != nil {
			if os.IsNotExist(err) {
				goneList = append(goneList, p)
				if c, ok := s.st.GetFile(p); ok && c.Inode != 0 {
					goneByInode[c.Inode] = p
				}
			}
			continue // 其他错误（权限等）保留旧记录，不当作删除
		}
		if !info.IsDir() {
			present = append(present, alive{p, info})
		}
	}

	changed := false
	affected := map[string]bool{}
	moved := map[string]bool{}

	for _, a := range present {
		if IsIgnoredPath(a.path) {
			continue
		}
		lang, ok := ClassifyLanguage(a.path)
		if !ok {
			continue
		}
		folder, in := s.FindFolderForPath(a.path)
		if !in {
			continue
		}
		ino := inodeOf(a.info)
		cached, exists := s.st.GetFile(a.path)
		if exists && cached.Inode != 0 &&
			cached.Size == a.info.Size() && cached.ModTime == a.info.ModTime().UnixNano() {
			if cached.FileUID == "" {
				cached.FileUID, cached.RelPath = DetermineFileIdentity(a.path, folder)
				s.st.SetFile(cached)
			}
			continue // 未变化（Inode==0 的旧记录会走一次重算以补齐 inode）
		}
		lines, hashStr, err := FastCountLinesAndHash(a.path)
		if err != nil {
			if err == errSkip && exists {
				s.st.DeleteFile(a.path)
				affected[folder] = true
				changed = true
			}
			continue
		}
		fileUID, relPath := DetermineFileIdentity(a.path, folder)
		rec := store.FileRecord{
			Path:        a.path,
			Folder:      folder,
			Ext:         lang,
			Inode:       ino,
			Size:        a.info.Size(),
			ModTime:     a.info.ModTime().UnixNano(),
			Lines:       lines,
			LastScanned: now,
			FileUID:     fileUID,
			RelPath:     relPath,
			ContentHash: hashStr,
		}
		if !exists && ino != 0 {
			if oldPath, hit := goneByInode[ino]; hit {
				if oldRec, ok := s.st.GetFile(oldPath); ok {
					affected[oldRec.Folder] = true
				}
				s.st.MoveFile(oldPath, rec)
				moved[oldPath] = true
				delete(goneByInode, ino)
				affected[folder] = true
				changed = true
				continue
			}
		}
		s.st.SetFile(rec)
		affected[folder] = true
		changed = true
	}

	for _, p := range goneList {
		if moved[p] {
			continue
		}
		cached, ok := s.st.GetFile(p)
		if !ok {
			continue
		}
		// 外置盘被拔出/根目录不可达时，不能当作删除
		if _, err := os.Stat(cached.Folder); err != nil {
			continue
		}
		s.st.DeleteFile(p)
		affected[cached.Folder] = true
		changed = true
	}

	if !changed {
		return false
	}
	s.st.RecalculateStats(now) // 整批只算一次
	for folder := range affected {
		recs := s.st.GetFilesByFolder(folder)
		total := 0
		for _, r := range recs {
			total += r.Lines
		}
		s.cfg.UpdateFolderStats(folder, len(recs), total, now)
	}
	s.st.MarkDirty() // 合并落盘
	return true
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

	ino := inodeOf(info)
	// 增量命中判定：文件大小与修改时间与缓存一致则直接跳过，零 CPU / 零磁盘读取开销
	cached, exists := s.st.GetFile(cleanPath)
	if exists && cached.Size == info.Size() && cached.ModTime == info.ModTime().UnixNano() {
		if cached.FileUID == "" {
			cached.FileUID, cached.RelPath = DetermineFileIdentity(cleanPath, folderPath)
			s.st.SetFile(cached)
		}
		return false, nil
	}

	// 仅读取并统计该单个变动文件
	lines, hashStr, err := FastCountLinesAndHash(cleanPath)
	if err != nil {
		if err == errSkip && exists {
			s.st.DeleteFile(cleanPath)
			s.st.RecalculateStats(time.Now())
			s.st.MarkDirty()
			return true, nil
		}
		return false, err
	}

	now := time.Now()
	fileUID, relPath := DetermineFileIdentity(cleanPath, folderPath)
	rec := store.FileRecord{
		Path:        cleanPath,
		Folder:      folderPath,
		Ext:         lang,
		Inode:       ino,
		Size:        info.Size(),
		ModTime:     info.ModTime().UnixNano(),
		Lines:       lines,
		LastScanned: now,
		FileUID:     fileUID,
		RelPath:     relPath,
		ContentHash: hashStr,
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
	s.st.MarkDirty()

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
	s.st.MarkDirty()

	return true, nil
}
