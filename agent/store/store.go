package store

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type FileRecord struct {
	ID          int       `json:"id"`
	Path        string    `json:"path"`
	Folder      string    `json:"folder"`
	Ext         string    `json:"ext"`
	Inode       uint64    `json:"inode,omitempty"`
	Size        int64     `json:"size"`
	ModTime     int64     `json:"mod_time"` // Unix nano
	Lines       int       `json:"lines"`
	BaseLines   int       `json:"base_lines"` // 每日基线行数，用于精确计算今日增量代码
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
	Stats    GlobalStats           `json:"stats"`
	Files    map[string]FileRecord `json:"files"`
	NextID   int                   `json:"next_id,omitempty"`
	BaseDate string                `json:"base_date,omitempty"`
}

type Store struct {
	filePath  string
	stats     GlobalStats
	files     map[string]FileRecord
	idMap     map[int]string
	nextID    int
	baseDate  string
	segTree   *SegmentTree
	mu        sync.RWMutex
	saveMu    sync.Mutex
	saveTimer *time.Timer
}

func NewStore(filePath string) (*Store, error) {
	s := &Store{
		filePath: filePath,
		files:    make(map[string]FileRecord),
		idMap:    make(map[int]string),
		nextID:   1,
		stats:    GlobalStats{},
		segTree:  NewSegmentTree(64),
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
	s.baseDate = state.BaseDate
	if state.NextID > 1 {
		s.nextID = state.NextID
	}

	todayStr := time.Now().Format("2006-01-02")
	isNewDay := s.baseDate != todayStr
	s.baseDate = todayStr

	now := time.Now()
	y, m, d := now.Date()
	todayStartNano := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).UnixNano()

	maxID := 0
	if state.Files != nil {
		s.files = state.Files

		// 第一遍：为已有文件补全唯一 ID
		for p, rec := range s.files {
			if rec.ID > maxID {
				maxID = rec.ID
			}
			// 若跨天，将当前行数固化为新一天的基线
			if isNewDay {
				rec.BaseLines = rec.Lines
				s.files[p] = rec
			} else if rec.BaseLines == 0 && rec.ModTime < todayStartNano {
				// 历史存量文件，基线等于其总行数
				rec.BaseLines = rec.Lines
				s.files[p] = rec
			}
		}

		assignedID := maxID
		for p, rec := range s.files {
			if rec.ID <= 0 {
				assignedID++
				rec.ID = assignedID
				s.files[p] = rec
			}
			s.idMap[rec.ID] = p
		}
		if assignedID >= s.nextID {
			s.nextID = assignedID + 1
		}
	}

	// 初始化并构建线段树
	capacity := len(s.files) + 64
	if s.nextID > capacity {
		capacity = s.nextID + 32
	}
	s.segTree = NewSegmentTree(capacity)

	for _, rec := range s.files {
		s.segTree.UpdatePoint(rec.ID, rec.Lines, rec.Ext, true)
	}

	return nil
}

// MarkDirty 标记需要落盘，2 秒内的多次调用合并为一次写盘
func (s *Store) MarkDirty() {
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	if s.saveTimer != nil {
		return
	}
	s.saveTimer = time.AfterFunc(2*time.Second, func() {
		s.saveMu.Lock()
		s.saveTimer = nil
		s.saveMu.Unlock()
		if err := s.Save(); err != nil {
			log.Printf("[Store] 保存失败: %v", err)
		}
	})
}

// Save 改为：紧凑 JSON + fsync + 原子 rename
func (s *Store) Save() error {
	s.mu.RLock()
	state := StateData{Stats: s.stats, Files: s.files, NextID: s.nextID, BaseDate: s.baseDate}
	data, err := json.Marshal(state) // 去掉 Indent，体积和 CPU 都明显下降
	s.mu.RUnlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0755); err != nil {
		return err
	}
	tmp := s.filePath + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil { // 断电保护
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, s.filePath)
}

// RolloverIfNeeded 日期变化时，把所有文件的基线重置为当前行数
func (s *Store) RolloverIfNeeded(now time.Time) bool {
	today := now.Format("2006-01-02")
	s.mu.Lock()
	if s.baseDate == today {
		s.mu.Unlock()
		return false
	}
	for p, r := range s.files {
		r.BaseLines = r.Lines
		s.files[p] = r
	}
	s.baseDate = today
	s.mu.Unlock()

	s.RecalculateStats(now)
	s.MarkDirty()
	return true
}

// MoveFile 同一个防抖批次里判定为移动时继承旧记录的 ID 与 BaseLines
func (s *Store) MoveFile(oldPath string, rec FileRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	old, ok := s.files[oldPath]
	if !ok {
		return
	}
	delete(s.files, oldPath)
	rec.Path = filepath.Clean(rec.Path)
	rec.ID = old.ID
	rec.BaseLines = old.BaseLines // 关键：基线继承，不当作今天新写的代码
	s.files[rec.Path] = rec
	s.idMap[rec.ID] = rec.Path
	s.segTree.UpdatePoint(rec.ID, rec.Lines, rec.Ext, true)
}

func (s *Store) GetFile(path string) (FileRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rec, ok := s.files[filepath.Clean(path)]
	return rec, ok
}

func (s *Store) GetFileByID(id int) (FileRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	path, ok := s.idMap[id]
	if !ok {
		return FileRecord{}, false
	}
	rec, found := s.files[path]
	return rec, found
}

// SetFile 对指定文件执行单点更新或插入，同步更新线段树节点
func (s *Store) SetFile(rec FileRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cleanPath := filepath.Clean(rec.Path)
	rec.Path = cleanPath

	existing, exists := s.files[cleanPath]
	if exists {
		rec.ID = existing.ID
		rec.BaseLines = existing.BaseLines
	} else {
		if rec.ID <= 0 {
			rec.ID = s.nextID
			s.nextID++
		}
		// 判断是否为历史文件
		now := time.Now()
		y, m, d := now.Date()
		todayStart := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).UnixNano()
		if rec.ModTime < todayStart {
			rec.BaseLines = rec.Lines
		} else {
			rec.BaseLines = 0
		}
	}

	s.files[cleanPath] = rec
	s.idMap[rec.ID] = cleanPath

	// 线段树单点修改 O(log N)
	s.segTree.UpdatePoint(rec.ID, rec.Lines, rec.Ext, true)
}

// DeleteFile 对指定文件执行单点移除，同步清除线段树节点
func (s *Store) DeleteFile(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cleanPath := filepath.Clean(path)
	if rec, exists := s.files[cleanPath]; exists {
		s.segTree.UpdatePoint(rec.ID, 0, "", false)
		delete(s.idMap, rec.ID)
		delete(s.files, cleanPath)
	}
}

func (s *Store) DeleteFilesByFolder(folder string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cleanFolder := filepath.Clean(folder)
	for p, rec := range s.files {
		if filepath.Clean(rec.Folder) == cleanFolder {
			s.segTree.UpdatePoint(rec.ID, 0, "", false)
			delete(s.idMap, rec.ID)
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
		return list[i].ID < list[j].ID
	})
	return list
}

func (s *Store) GetStats() GlobalStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stats
}

func (s *Store) GetFilesByFolder(folder string) []FileRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cleanFolder := filepath.Clean(folder)
	var list []FileRecord
	for _, rec := range s.files {
		if filepath.Clean(rec.Folder) == cleanFolder {
			list = append(list, rec)
		}
	}
	return list
}

// RecalculateStats 利用线段树全局聚合根节点与单点增量计算最新指标
func (s *Store) RecalculateStats(now time.Time) GlobalStats {
	s.mu.Lock()
	defer s.mu.Unlock()

	totalNode := s.segTree.QueryTotal()

	stats := GlobalStats{
		TotalLines:  totalNode.TotalLines,
		TotalFiles:  totalNode.FileCount,
		CLines:      totalNode.CLines,
		CFiles:      totalNode.CFiles,
		CPPLines:    totalNode.CPPLines,
		CPPFiles:    totalNode.CPPFiles,
		JavaLines:   totalNode.JavaLines,
		JavaFiles:   totalNode.JavaFiles,
		LastScanAt:  now,
		LastSyncAt:  s.stats.LastSyncAt,
		LastSyncErr: s.stats.LastSyncErr,
	}

	y, m, d := now.Date()
	todayStartNano := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).UnixNano()

	for _, rec := range s.files {
		if rec.ModTime >= todayStartNano {
			stats.TodayFiles++
			// 今日增量代码 = 当前代码行数 - 每日零点基线行数 (确保修改已有文件只累加增量，而非累加全文件)
			delta := rec.Lines - rec.BaseLines
			if delta > 0 {
				stats.TodayLines += delta
			}
		}
	}

	s.stats = stats
	return stats
}

func (s *Store) SetStats(stats GlobalStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

func (s *Store) SetSyncStatus(syncTime time.Time, errStr string) {
	s.mu.Lock()
	s.stats.LastSyncAt = syncTime
	s.stats.LastSyncErr = errStr
	s.mu.Unlock()
	s.MarkDirty()
}
