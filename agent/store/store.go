package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type FileRecord struct {
	Path        string    `json:"path"`
	Folder      string    `json:"folder"`
	Ext         string    `json:"ext"`
	Size        int64     `json:"size"`
	ModTime     int64     `json:"mod_time"` // Unix nano
	Lines       int       `json:"lines"`
	LastScanned time.Time `json:"last_scanned"`
}

type GlobalStats struct {
	TotalLines  int       `json:"total_lines"`
	TodayLines  int       `json:"today_lines"`
	TotalFiles  int       `json:"total_files"`
	TodayFiles  int       `json:"today_files"`
	CLines      int       `json:"c_lines"`
	CFiles      int       `json:"c_files"`
	CPPLines    int       `json:"cpp_lines"`
	CPPFiles    int       `json:"cpp_files"`
	JavaLines   int       `json:"java_lines"`
	JavaFiles   int       `json:"java_files"`
	LastScanAt  time.Time `json:"last_scan_at"`
	LastSyncAt  time.Time `json:"last_sync_at"`
	LastSyncErr string    `json:"last_sync_err"`
}

type StateData struct {
	Stats GlobalStats           `json:"stats"`
	Files map[string]FileRecord `json:"files"`
}

type Store struct {
	filePath string
	stats    GlobalStats
	files    map[string]FileRecord
	mu       sync.RWMutex
}

func NewStore(filePath string) (*Store, error) {
	s := &Store{
		filePath: filePath,
		files:    make(map[string]FileRecord),
		stats:    GlobalStats{},
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var state StateData
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	s.stats = state.Stats
	if state.Files != nil {
		s.files = state.Files
	}
	return nil
}

func (s *Store) Save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	state := StateData{
		Stats: s.stats,
		Files: s.files,
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := s.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, s.filePath)
}

func (s *Store) GetFile(path string) (FileRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.files[filepath.Clean(path)]
	return rec, ok
}

func (s *Store) SetFile(rec FileRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec.Path = filepath.Clean(rec.Path)
	s.files[rec.Path] = rec
}

func (s *Store) DeleteFile(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, filepath.Clean(path))
}

func (s *Store) DeleteFilesByFolder(folder string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cleanFolder := filepath.Clean(folder)
	for p, rec := range s.files {
		if filepath.Clean(rec.Folder) == cleanFolder {
			delete(s.files, p)
		}
	}
}

func (s *Store) GetAllFiles() []FileRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]FileRecord, 0, len(s.files))
	for _, rec := range s.files {
		list = append(list, rec)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].ModTime > list[j].ModTime
	})
	return list
}

func (s *Store) GetStats() GlobalStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *Store) SetStats(stats GlobalStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *Store) SetSyncStatus(syncTime time.Time, errStr string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats.LastSyncAt = syncTime
	s.stats.LastSyncErr = errStr
	_ = s.saveUnsafe()
}

func (s *Store) saveUnsafe() error {
	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	state := StateData{
		Stats: s.stats,
		Files: s.files,
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmpFile := s.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, s.filePath)
}
