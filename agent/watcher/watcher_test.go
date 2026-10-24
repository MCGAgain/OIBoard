//go:build darwin && cgo

package watcher

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/scanner"
	"oiboard-agent/store"
)

func TestWatcher_OnEventAndFlush(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_watcher_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfgPath := filepath.Join(tmpDir, "config.json")
	statePath := filepath.Join(tmpDir, "state.json")
	fseventsPath := filepath.Join(tmpDir, "fsevents.json")

	cfg, _ := config.LoadConfig(cfgPath)
	_, _ = cfg.AddFolder(tmpDir, "test_proj")
	st, _ := store.NewStore(statePath)
	sc := scanner.NewScanner(cfg, st)

	changedCalled := false
	w, err := NewWatcher(cfg, sc, func() {
		changedCalled = true
	})
	if err != nil {
		t.Fatalf("NewWatcher failed: %v", err)
	}
	w.SetStatePath(fseventsPath)

	cleanRoot := filepath.Clean(tmpDir)
	sCtx := &streamContext{
		root:     cleanRoot,
		realRoot: cleanRoot,
		uuid:     "TEST-UUID-1234",
		w:        w,
	}

	testFile := filepath.Join(cleanRoot, "main.cpp")
	_ = os.WriteFile(testFile, []byte("int main() { return 0; }\n"), 0644)

	// 1. 模拟收到文件创建事件 (flagItemCreated | flagItemIsFile)
	w.onEvent(sCtx, testFile, flagItemCreated|flagItemIsFile, 1001)

	w.mu.Lock()
	if !w.pending[testFile] {
		w.mu.Unlock()
		t.Fatalf("expected testFile in pending")
	}
	if w.currentStates[cleanRoot].EventID != 1001 {
		w.mu.Unlock()
		t.Fatalf("expected currentID 1001, got %d", w.currentStates[cleanRoot].EventID)
	}
	w.mu.Unlock()

	// 2. 模拟触发 flush
	w.flush()

	// 验证文件已经被统计写入 store
	rec, ok := st.GetFile(testFile)
	if !ok || rec.Lines != 1 {
		t.Fatalf("expected 1 line in store, got %+v", rec)
	}
	if !changedCalled {
		t.Fatalf("expected onChange to be called")
	}

	// 3. 模拟目录重命名事件: sub1 -> sub2
	sub1 := filepath.Join(cleanRoot, "sub1")
	sub2 := filepath.Join(cleanRoot, "sub2")
	_ = os.MkdirAll(sub2, 0755)
	subFile := filepath.Join(sub2, "sub.cpp")
	_ = os.WriteFile(subFile, []byte("void f() {}\nvoid g() {}\n"), 0644)

	// onEvent 接收目录更名事件
	w.onEvent(sCtx, sub1, flagItemRenamed|flagItemIsDir, 1002)
	w.onEvent(sCtx, sub2, flagItemRenamed|flagItemIsDir, 1003)

	w.flush()

	// 验证 sub2 内部的文件通过 expandDir 自动发现并完成统计
	subRec, ok := st.GetFile(subFile)
	if !ok || subRec.Lines != 2 {
		t.Fatalf("expected sub.cpp with 2 lines, got %+v", subRec)
	}

	// 4. 模拟 MustScanSubDirs 触发 needFull
	w.onEvent(sCtx, cleanRoot, flagMustScanSubDirs, 1004)
	w.mu.Lock()
	if !w.needFull {
		w.mu.Unlock()
		t.Fatalf("expected needFull=true")
	}
	w.mu.Unlock()

	w.flush()

	w.mu.Lock()
	if w.needFull {
		w.mu.Unlock()
		t.Fatalf("expected needFull reset to false after flush")
	}
	w.mu.Unlock()

	// 5. 验证 RootState 持久化与旧格式兼容
	w.persist(map[string]RootState{cleanRoot: {EventID: 1004, UUID: "TEST-UUID-1234"}}, true)
	loaded := w.loadEventIDs()
	if loaded[cleanRoot].EventID != 1004 || loaded[cleanRoot].UUID != "TEST-UUID-1234" {
		t.Fatalf("expected persisted state {1004, TEST-UUID-1234}, got %+v", loaded[cleanRoot])
	}

	w.Stop()
}

func TestWatcher_EventStormDegrade(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_storm_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfg, _ := config.LoadConfig(filepath.Join(tmpDir, "config.json"))
	_, _ = cfg.AddFolder(tmpDir, "test_proj")
	st, _ := store.NewStore(filepath.Join(tmpDir, "state.json"))
	sc := scanner.NewScanner(cfg, st)

	w, _ := NewWatcher(cfg, sc, nil)
	cleanRoot := filepath.Clean(tmpDir)
	sCtx := &streamContext{
		root:     cleanRoot,
		realRoot: cleanRoot,
		w:        w,
	}

	// 模拟超过 5000 个事件涌入
	for i := 0; i < maxPendingEvents+10; i++ {
		fakePath := filepath.Join(cleanRoot, fmt.Sprintf("file_%d.cpp", i))
		w.onEvent(sCtx, fakePath, flagItemCreated|flagItemIsFile, uint64(i+1))
	}

	w.mu.Lock()
	if !w.needFull {
		w.mu.Unlock()
		t.Fatalf("expected needFull=true on event storm")
	}
	if len(w.pending) != 0 {
		w.mu.Unlock()
		t.Fatalf("expected pending map to be cleared on event storm, got len=%d", len(w.pending))
	}
	w.mu.Unlock()
}

func TestDecideEventIDReplay_UUIDSemantics(t *testing.T) {
	const sinceNow = uint64(0xFFFFFFFFFFFFFFFF)
	root := "/Users/test/repo"

	// 规则 1: saved 有 uuid 但当前拿不到 uuid，视为不可靠，丢弃 eventId，立即 ScanAll
	dec1 := DecideEventIDReplay(root, true, RootState{EventID: 500, UUID: "SAVED-UUID"}, "")
	if dec1.SinceID != sinceNow || !dec1.NeedResetAndRescan || dec1.TargetUUID != "" {
		t.Fatalf("Rule 1 failed: expected sinceNow, NeedResetAndRescan=true, TargetUUID='', got %+v", dec1)
	}

	// 规则 2: saved 没有 uuid（旧文件升级上来），但当前能拿到 uuid，则平滑升级并信任 eventId
	dec2 := DecideEventIDReplay(root, true, RootState{EventID: 600, UUID: ""}, "CURRENT-UUID")
	if dec2.SinceID != 600 || dec2.NeedResetAndRescan || dec2.TargetUUID != "CURRENT-UUID" {
		t.Fatalf("Rule 2 failed: expected 600, NeedResetAndRescan=false, TargetUUID='CURRENT-UUID', got %+v", dec2)
	}

	// 规则 3: 如果两者都拿不到 uuid，打 warning 并信任 eventId
	dec3 := DecideEventIDReplay(root, true, RootState{EventID: 700, UUID: ""}, "")
	if dec3.SinceID != 700 || dec3.NeedResetAndRescan || !dec3.IsWarning {
		t.Fatalf("Rule 3 failed: expected 700, NeedResetAndRescan=false, IsWarning=true, got %+v", dec3)
	}

	// UUID 不一致: 丢弃 eventId 并重扫
	dec4 := DecideEventIDReplay(root, true, RootState{EventID: 800, UUID: "OLD-UUID"}, "NEW-UUID")
	if dec4.SinceID != sinceNow || !dec4.NeedResetAndRescan || dec4.TargetUUID != "NEW-UUID" {
		t.Fatalf("UUID mismatch failed: expected sinceNow, NeedResetAndRescan=true, got %+v", dec4)
	}

	// UUID 一致: 信任已存 eventId 回放
	dec5 := DecideEventIDReplay(root, true, RootState{EventID: 900, UUID: "SAME-UUID"}, "SAME-UUID")
	if dec5.SinceID != 900 || dec5.NeedResetAndRescan || dec5.TargetUUID != "SAME-UUID" {
		t.Fatalf("UUID match failed: expected 900, NeedResetAndRescan=false, got %+v", dec5)
	}

	// 无已存记录
	dec6 := DecideEventIDReplay(root, false, RootState{}, "CURRENT-UUID")
	if dec6.SinceID != sinceNow || dec6.NeedResetAndRescan || dec6.TargetUUID != "CURRENT-UUID" {
		t.Fatalf("No saved state failed: expected sinceNow, NeedResetAndRescan=false, got %+v", dec6)
	}
}

type mockPanicBatchProcessor struct {
	mu         sync.Mutex
	panicBatch bool
	batchCalls int
	scanCalls  int
}

func (m *mockPanicBatchProcessor) ProcessBatch(paths []string) bool {
	m.mu.Lock()
	m.batchCalls++
	p := m.panicBatch
	m.mu.Unlock()
	if p {
		panic("simulated ProcessBatch critical panic")
	}
	return true
}

func (m *mockPanicBatchProcessor) ScanAll(forceFull bool) (store.GlobalStats, error) {
	m.mu.Lock()
	m.scanCalls++
	m.mu.Unlock()
	return store.GlobalStats{}, nil
}

func (m *mockPanicBatchProcessor) GetScanCalls() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.scanCalls
}

func (m *mockPanicBatchProcessor) SetPanicBatch(p bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.panicBatch = p
}

func (m *mockPanicBatchProcessor) PathsUnder(dir string) []string {
	return nil
}

func TestWatcher_PanicRecovery_ProcessBatch(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_panic_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfg, _ := config.LoadConfig(filepath.Join(tmpDir, "config.json"))
	mock := &mockPanicBatchProcessor{panicBatch: true}

	w, err := NewWatcher(cfg, mock, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Stop()

	testFile := filepath.Join(tmpDir, "test.cpp")

	// 第 1 次 panic: needFull=true, panicCount=1
	w.mu.Lock()
	w.pending[testFile] = true
	w.mu.Unlock()

	w.flush()

	w.mu.Lock()
	if w.timer != nil {
		w.timer.Stop()
	}
	if w.panicCount != 1 {
		t.Fatalf("expected panicCount=1, got %d", w.panicCount)
	}
	if !w.needFull {
		t.Fatalf("expected needFull=true after 1st panic")
	}
	w.mu.Unlock()

	// 第 2 次 panic: needFull=true, panicCount=2
	w.flush()

	w.mu.Lock()
	if w.timer != nil {
		w.timer.Stop()
	}
	if w.panicCount != 2 {
		t.Fatalf("expected panicCount=2, got %d", w.panicCount)
	}
	if !w.needFull {
		t.Fatalf("expected needFull=true after 2nd panic")
	}
	w.mu.Unlock()

	// 第 3 次 panic: 连续 3 次触发降级兜底，放弃本批重试，panicCount=0, needFull=false
	w.flush()

	w.mu.Lock()
	if w.timer != nil {
		w.timer.Stop()
	}
	if w.panicCount != 0 {
		t.Fatalf("expected panicCount=0 after 3rd panic degrade, got %d", w.panicCount)
	}
	if w.needFull {
		t.Fatalf("expected needFull=false after 3rd panic degrade")
	}
	w.mu.Unlock()

	// 恢复正常: panicBatch=false
	mock.SetPanicBatch(false)
	w.mu.Lock()
	w.pending[testFile] = true
	w.mu.Unlock()

	w.flush()

	w.mu.Lock()
	if w.panicCount != 0 {
		t.Fatalf("expected panicCount=0 on success, got %d", w.panicCount)
	}
	w.mu.Unlock()
}

func TestWatcher_Cooldown(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_cooldown_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfg, _ := config.LoadConfig(filepath.Join(tmpDir, "config.json"))
	mock := &mockPanicBatchProcessor{}

	w, _ := NewWatcher(cfg, mock, nil)
	defer w.Stop()

	w.SetCooldown(100 * time.Millisecond)

	// 1. 首次触发 needFull，立即执行 ScanAll
	w.mu.Lock()
	w.needFull = true
	w.mu.Unlock()

	w.flush()

	if mock.GetScanCalls() != 1 {
		t.Fatalf("expected 1 scan call, got %d", mock.GetScanCalls())
	}

	// 2. 立即再次触发 needFull（处于 100ms 冷却期内），暂缓执行并排期
	w.mu.Lock()
	w.needFull = true
	w.mu.Unlock()

	w.flush()

	if mock.GetScanCalls() != 1 {
		t.Fatalf("expected scanCalls to stay 1 during cooldown, got %d", mock.GetScanCalls())
	}

	// 3. 等待冷却期结束后，后台定时器应该自动触发全量对账
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if mock.GetScanCalls() >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if mock.GetScanCalls() != 2 {
		t.Fatalf("expected scanCalls to be 2 after cooldown expires, got %d", mock.GetScanCalls())
	}
}

func TestWatcher_ConcurrentStartAndReload(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_concurrent_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	sub1 := filepath.Join(tmpDir, "sub1")
	sub2 := filepath.Join(tmpDir, "sub2")
	_ = os.MkdirAll(sub1, 0755)
	_ = os.MkdirAll(sub2, 0755)

	cfgPath := filepath.Join(tmpDir, "config.json")
	cfg, _ := config.LoadConfig(cfgPath)
	_, _ = cfg.AddFolder(sub1, "sub1")

	mock := &mockPanicBatchProcessor{}
	w, err := NewWatcher(cfg, mock, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Stop()

	// 并发执行 Start 和多次 ReloadFolders，并在中途由 Web 端添加 sub2 目录
	var wg sync.WaitGroup
	wg.Add(3)

	go func() {
		defer wg.Done()
		w.Start()
	}()

	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond)
		// 模拟用户在 Web 端添加文件夹 sub2
		_, _ = cfg.AddFolder(sub2, "sub2")
		w.ReloadFolders()
	}()

	go func() {
		defer wg.Done()
		for i := 0; i < 5; i++ {
			time.Sleep(2 * time.Millisecond)
			w.ReloadFolders()
		}
	}()

	wg.Wait()

	// 等待异步 Start 及其收尾补调的 ReloadFolders 完成
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		w.smu.Lock()
		hasSub1 := w.streams[sub1] != nil
		hasSub2 := w.streams[sub2] != nil
		w.smu.Unlock()
		if hasSub1 && hasSub2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	w.smu.Lock()
	defer w.smu.Unlock()
	if w.streams[sub1] == nil || w.streams[sub2] == nil {
		t.Fatalf("expected both sub1 and sub2 to be watched, got sub1=%v, sub2=%v",
			w.streams[sub1] != nil, w.streams[sub2] != nil)
	}
}
