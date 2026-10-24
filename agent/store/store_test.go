package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStore_FileIDAndIncrementalStats(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_store_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	stateFile := filepath.Join(tmpDir, "state.json")
	st, err := NewStore(stateFile)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	// Yesterday: file1 with 100 lines
	yesterday := now.Add(-24 * time.Hour)
	rec1 := FileRecord{
		Path:        "/test/project/file1.cpp",
		Folder:      "/test/project",
		Ext:         "cpp",
		Size:        1000,
		ModTime:     yesterday.UnixNano(),
		Lines:       100,
		LastScanned: yesterday,
	}
	st.SetFile(rec1)

	savedRec1, ok := st.GetFile("/test/project/file1.cpp")
	if !ok || savedRec1.ID != 1 {
		t.Fatalf("expected ID 1, got %v", savedRec1.ID)
	}
	if savedRec1.BaseLines != 100 {
		t.Fatalf("expected BaseLines 100 for yesterday file, got %d", savedRec1.BaseLines)
	}

	stats := st.RecalculateStats(now)
	if stats.TotalLines != 100 {
		t.Fatalf("expected total 100 lines, got %d", stats.TotalLines)
	}
	if stats.TodayLines != 0 {
		t.Fatalf("expected today 0 lines (file modified yesterday), got %d", stats.TodayLines)
	}

	// Today: User modifies file1, adding 5 lines (now 105 lines)
	rec1Modified := FileRecord{
		Path:        "/test/project/file1.cpp",
		Folder:      "/test/project",
		Ext:         "cpp",
		Size:        1050,
		ModTime:     now.UnixNano(),
		Lines:       105,
		LastScanned: now,
	}
	st.SetFile(rec1Modified)

	savedMod1, _ := st.GetFile("/test/project/file1.cpp")
	if savedMod1.ID != 1 {
		t.Fatalf("file ID changed! expected 1, got %d", savedMod1.ID)
	}
	if savedMod1.BaseLines != 100 {
		t.Fatalf("BaseLines lost! expected 100, got %d", savedMod1.BaseLines)
	}

	stats = st.RecalculateStats(now)
	// Total should be 105
	if stats.TotalLines != 105 {
		t.Fatalf("expected total 105 lines, got %d", stats.TotalLines)
	}
	// Today should be delta: 105 - 100 = 5! NOT 105!
	if stats.TodayLines != 5 {
		t.Fatalf("expected today 5 lines (delta only!), got %d", stats.TodayLines)
	}

	// Today: User creates a new file2.java with 30 lines
	rec2 := FileRecord{
		Path:        "/test/project/file2.java",
		Folder:      "/test/project",
		Ext:         "java",
		Size:        300,
		ModTime:     now.UnixNano(),
		Lines:       30,
		LastScanned: now,
	}
	st.SetFile(rec2)

	savedRec2, ok := st.GetFile("/test/project/file2.java")
	if !ok || savedRec2.ID != 2 {
		t.Fatalf("expected ID 2 for new file, got %v", savedRec2.ID)
	}

	stats = st.RecalculateStats(now)
	if stats.TotalLines != 135 {
		t.Fatalf("expected total 135 lines, got %d", stats.TotalLines)
	}
	// Today should be 5 + 30 = 35 lines!
	if stats.TodayLines != 35 {
		t.Fatalf("expected today 35 lines, got %d", stats.TodayLines)
	}

	// Delete file1
	st.DeleteFile("/test/project/file1.cpp")
	stats = st.RecalculateStats(now)
	if stats.TotalLines != 30 {
		t.Fatalf("expected total 30 lines after delete, got %d", stats.TotalLines)
	}
	if stats.TotalFiles != 1 {
		t.Fatalf("expected 1 file after delete, got %d", stats.TotalFiles)
	}
}

func TestStore_RolloverAndMoveFile(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_store_test_rollover_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	stateFile := filepath.Join(tmpDir, "state.json")
	st, err := NewStore(stateFile)
	if err != nil {
		t.Fatal(err)
	}

	today := time.Now()
	// 新建一个已有 200 行的文件
	st.SetFile(FileRecord{
		Path:        "/test/project/old.cpp",
		Folder:      "/test/project",
		Ext:         "cpp",
		Inode:       12345,
		Lines:       200,
		ModTime:     today.UnixNano(),
		LastScanned: today,
	})

	// 此时 TodayLines 应该为 200
	stats := st.RecalculateStats(today)
	if stats.TodayLines != 200 {
		t.Fatalf("expected TodayLines 200, got %d", stats.TodayLines)
	}

	// 模拟跨天 Rollover
	tomorrow := today.Add(24 * time.Hour)
	rolled := st.RolloverIfNeeded(tomorrow)
	if !rolled {
		t.Fatalf("expected rollover to succeed")
	}

	rec, _ := st.GetFile("/test/project/old.cpp")
	if rec.BaseLines != 200 {
		t.Fatalf("expected BaseLines to be rolled to 200, got %d", rec.BaseLines)
	}

	// 跨天后未修改时 TodayLines 应当变为 0
	stats = st.RecalculateStats(tomorrow)
	if stats.TodayLines != 0 {
		t.Fatalf("expected TodayLines 0 on new day, got %d", stats.TodayLines)
	}

	// 模拟文件重命名: old.cpp 移到 renamed.cpp, 保持 inode 12345
	st.MoveFile("/test/project/old.cpp", FileRecord{
		Path:        "/test/project/renamed.cpp",
		Folder:      "/test/project",
		Ext:         "cpp",
		Inode:       12345,
		Lines:       200,
		ModTime:     tomorrow.UnixNano(),
		LastScanned: tomorrow,
	})

	movedRec, ok := st.GetFile("/test/project/renamed.cpp")
	if !ok {
		t.Fatalf("expected renamed.cpp to exist")
	}
	if movedRec.BaseLines != 200 {
		t.Fatalf("expected BaseLines 200 to be inherited, got %d", movedRec.BaseLines)
	}

	// TodayLines 应当仍然是 0，而不是暴涨 200 行！
	stats = st.RecalculateStats(tomorrow)
	if stats.TodayLines != 0 {
		t.Fatalf("expected TodayLines to remain 0 after rename, got %d", stats.TodayLines)
	}

	// MarkDirty 触发落盘并校验紧凑存储
	st.MarkDirty()
	time.Sleep(2100 * time.Millisecond) // 等待 2s 合并防抖

	data, err := os.ReadFile(stateFile)
	if err != nil {
		t.Fatalf("failed to read state file: %v", err)
	}
	if len(data) == 0 {
		t.Fatalf("state file is empty")
	}
}
