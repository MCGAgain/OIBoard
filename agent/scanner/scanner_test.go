package scanner

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/store"
)

func TestScanner_FastCountLinesAndFiltering(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_scanner_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// 1. 头文件判断测试
	if lang, ok := ClassifyLanguage("foo.h"); !ok || lang != "c" {
		t.Fatalf("expected .h as c, got %s, %v", lang, ok)
	}
	if lang, ok := ClassifyLanguage("bar.hpp"); !ok || lang != "cpp" {
		t.Fatalf("expected .hpp as cpp, got %s, %v", lang, ok)
	}
	if lang, ok := ClassifyLanguage("baz.hh"); !ok || lang != "cpp" {
		t.Fatalf("expected .hh as cpp, got %s, %v", lang, ok)
	}

	// 2. 正常代码文件
	normalFile := filepath.Join(tmpDir, "test.cpp")
	_ = os.WriteFile(normalFile, []byte("int main() {\n    return 0;\n}\n"), 0644)
	lines, err := FastCountLines(normalFile)
	if err != nil || lines != 3 {
		t.Fatalf("expected 3 lines, got %d, err: %v", lines, err)
	}

	// 3. 含 \0 的二进制文件
	binFile := filepath.Join(tmpDir, "bin.cpp")
	_ = os.WriteFile(binFile, []byte("int main()\x00123\n"), 0644)
	_, err = FastCountLines(binFile)
	if err != errSkip {
		t.Fatalf("expected errSkip for binary file, got %v", err)
	}

	// 4. 超大文件 (>20MB)
	bigFile := filepath.Join(tmpDir, "big.cpp")
	f, _ := os.Create(bigFile)
	_ = f.Truncate(21 << 20) // 21MB
	_ = f.Close()
	_, err = FastCountLines(bigFile)
	if err != errSkip {
		t.Fatalf("expected errSkip for >20MB file, got %v", err)
	}
}

func TestScanner_ProcessBatchMoveDetection(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_batch_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfgPath := filepath.Join(tmpDir, "config.json")
	statePath := filepath.Join(tmpDir, "state.json")

	cfg, _ := config.LoadConfig(cfgPath)
	_, _ = cfg.AddFolder(tmpDir, "test_proj")

	st, _ := store.NewStore(statePath)
	sc := NewScanner(cfg, st)

	srcFile := filepath.Join(tmpDir, "source.cpp")
	_ = os.WriteFile(srcFile, []byte("line1\nline2\nline3\n"), 0644)

	// 初次批量处理
	sc.ProcessBatch([]string{srcFile})

	rec, ok := st.GetFile(srcFile)
	if !ok || rec.Lines != 3 {
		t.Fatalf("expected 3 lines, got %+v", rec)
	}

	// 模拟跨天
	tomorrow := time.Now().Add(24 * time.Hour)
	st.RolloverIfNeeded(tomorrow)

	// 重命名文件: source.cpp -> dest.cpp (inode 保持一致)
	destFile := filepath.Join(tmpDir, "dest.cpp")
	_ = os.Rename(srcFile, destFile)

	// 模拟防抖批次收集到了 [srcFile, destFile]
	changed := sc.ProcessBatch([]string{srcFile, destFile})
	if !changed {
		t.Fatalf("expected ProcessBatch to return changed=true on rename")
	}

	// 验证旧文件已删除，新文件已继承 BaseLines
	_, okOld := st.GetFile(srcFile)
	if okOld {
		t.Fatalf("expected old file to be deleted")
	}

	destRec, okNew := st.GetFile(destFile)
	if !okNew {
		t.Fatalf("expected dest file to exist")
	}
	if destRec.BaseLines != 3 {
		t.Fatalf("expected BaseLines 3 to be inherited across rename, got %d", destRec.BaseLines)
	}

	// TodayLines 应当保持为 0，而非暴涨为 3
	stats := st.GetStats()
	if stats.TodayLines != 0 {
		t.Fatalf("expected TodayLines to remain 0 after rename, got %d", stats.TodayLines)
	}
}

func TestScanner_OfflineReplaySemantics(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_replay_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfg, _ := config.LoadConfig(filepath.Join(tmpDir, "config.json"))
	_, _ = cfg.AddFolder(tmpDir, "test_proj")
	st, _ := store.NewStore(filepath.Join(tmpDir, "state.json"))
	sc := NewScanner(cfg, st)

	// 存量文件
	existing := filepath.Join(tmpDir, "existing.cpp")
	_ = os.WriteFile(existing, []byte("line1\nline2\n"), 0644)
	sc.ProcessBatch([]string{existing})

	// 模拟离线新建了一个临时文件并随即删除
	ephemeral := filepath.Join(tmpDir, "ephemeral.cpp")
	// 此时 ephemeral 磁盘上并不存在，且库中无记录
	// 回放批次中包含了 ephemeral 以及 existing 的更新
	_ = os.WriteFile(existing, []byte("line1\nline2\nline3\n"), 0644)

	// 批处理回放：包含已删除的不存在文件 ephemeral 与修改过的 existing
	changed := sc.ProcessBatch([]string{ephemeral, existing})
	if !changed {
		t.Fatalf("expected ProcessBatch to succeed")
	}

	// 验证 ephemeral 完全没有进入 store
	if _, ok := st.GetFile(ephemeral); ok {
		t.Fatalf("ephemeral file should not exist in store")
	}

	// 验证 existing 增量正确
	exRec, ok := st.GetFile(existing)
	if !ok || exRec.Lines != 3 {
		t.Fatalf("expected existing with 3 lines, got %+v", exRec)
	}
}
