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
