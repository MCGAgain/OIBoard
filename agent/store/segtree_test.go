package store

import (
	"testing"
)

func TestSegmentTree_PointUpdateAndQuery(t *testing.T) {
	st := NewSegmentTree(8)

	// File 1: cpp 10 lines
	st.UpdatePoint(1, 10, "cpp", true)
	// File 2: c 5 lines
	st.UpdatePoint(2, 5, "c", true)
	// File 3: java 20 lines
	st.UpdatePoint(3, 20, "java", true)

	total := st.QueryTotal()
	if total.TotalLines != 35 {
		t.Fatalf("expected 35 lines, got %d", total.TotalLines)
	}
	if total.FileCount != 3 {
		t.Fatalf("expected 3 files, got %d", total.FileCount)
	}
	if total.CPPLines != 10 || total.CLines != 5 || total.JavaLines != 20 {
		t.Fatalf("breakdown mismatch: %+v", total)
	}

	// Update File 1 to 15 lines (point update)
	st.UpdatePoint(1, 15, "cpp", true)
	total = st.QueryTotal()
	if total.TotalLines != 40 {
		t.Fatalf("expected 40 lines after update, got %d", total.TotalLines)
	}
	if total.FileCount != 3 {
		t.Fatalf("expected 3 files after update, got %d", total.FileCount)
	}
	if total.CPPLines != 15 {
		t.Fatalf("expected 15 cpp lines, got %d", total.CPPLines)
	}

	// Remove File 2 (deactivate)
	st.UpdatePoint(2, 0, "", false)
	total = st.QueryTotal()
	if total.TotalLines != 35 {
		t.Fatalf("expected 35 lines after deletion, got %d", total.TotalLines)
	}
	if total.FileCount != 2 {
		t.Fatalf("expected 2 files after deletion, got %d", total.FileCount)
	}
	if total.CLines != 0 {
		t.Fatalf("expected 0 c lines after deletion, got %d", total.CLines)
	}

	// Dynamic capacity expansion test (pos 100 > initial capacity 32)
	st.UpdatePoint(100, 50, "cpp", true)
	total = st.QueryTotal()
	if total.TotalLines != 85 {
		t.Fatalf("expected 85 lines after expansion, got %d", total.TotalLines)
	}
	if total.FileCount != 3 {
		t.Fatalf("expected 3 files after expansion, got %d", total.FileCount)
	}

	// Range query test
	rangeNode := st.QueryRange(1, 3)
	if rangeNode.TotalLines != 35 {
		t.Fatalf("expected range [1, 3] to have 35 lines, got %d", rangeNode.TotalLines)
	}
}
