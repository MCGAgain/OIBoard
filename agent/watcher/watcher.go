//go:build darwin && cgo

package watcher

/*
#cgo LDFLAGS: -framework CoreServices -framework CoreFoundation

#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/stat.h>

extern void goFSEventsCallback(uintptr_t handle, char *path, uint32_t flags, uint64_t eventId);

static void c_fsevent_callback(
    ConstFSEventStreamRef streamRef,
    void *clientCallBackInfo,
    size_t numEvents,
    void *eventPaths,
    const FSEventStreamEventFlags eventFlags[],
    const FSEventStreamEventId eventIds[])
{
    uintptr_t handle = (uintptr_t)clientCallBackInfo;
    char **paths = (char **)eventPaths;
    for (size_t i = 0; i < numEvents; i++) {
        goFSEventsCallback(handle, paths[i], (uint32_t)eventFlags[i], (uint64_t)eventIds[i]);
    }
}

static FSEventStreamRef createAndStartStream(const char *path, uint64_t sinceWhen, double latency, dispatch_queue_t queue, uintptr_t handle) {
    CFStringRef mypath = CFStringCreateWithCString(kCFAllocatorDefault, path, kCFStringEncodingUTF8);
    if (!mypath) {
        return NULL;
    }
    CFArrayRef pathsToWatch = CFArrayCreate(NULL, (const void **)&mypath, 1, &kCFTypeArrayCallBacks);

    FSEventStreamContext context;
    context.version = 0;
    context.info = (void *)handle;
    context.retain = NULL;
    context.release = NULL;
    context.copyDescription = NULL;

    FSEventStreamCreateFlags flags = kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagNoDefer;
    FSEventStreamRef stream = FSEventStreamCreate(
        kCFAllocatorDefault,
        &c_fsevent_callback,
        &context,
        pathsToWatch,
        (FSEventStreamEventId)sinceWhen,
        (CFTimeInterval)latency,
        flags
    );

    CFRelease(pathsToWatch);
    CFRelease(mypath);

    if (stream) {
        FSEventStreamSetDispatchQueue(stream, queue);
        if (!FSEventStreamStart(stream)) {
            FSEventStreamInvalidate(stream);
            FSEventStreamRelease(stream);
            return NULL;
        }
    }
    return stream;
}

static void drain_block(void *context) {
    // empty callback to ensure previous queued events drained
}

static void stopStreamAndDrain(FSEventStreamRef stream, dispatch_queue_t queue) {
    if (stream) {
        FSEventStreamStop(stream);
        FSEventStreamInvalidate(stream);
        FSEventStreamRelease(stream);
    }
    if (queue) {
        dispatch_sync_f(queue, NULL, drain_block);
    }
}

static dispatch_queue_t createSerialQueue(const char *label) {
    return dispatch_queue_create(label, DISPATCH_QUEUE_SERIAL);
}

static char* getDeviceUUIDForPath(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        return NULL;
    }
    CFUUIDRef uuid = FSEventsCopyUUIDForDevice(st.st_dev);
    if (!uuid) {
        return NULL;
    }
    CFStringRef str = CFUUIDCreateString(kCFAllocatorDefault, uuid);
    CFRelease(uuid);
    if (!str) {
        return NULL;
    }
    CFIndex len = CFStringGetMaximumSizeForEncoding(CFStringGetLength(str), kCFStringEncodingUTF8) + 1;
    char *buffer = (char *)malloc(len);
    if (buffer) {
        if (!CFStringGetCString(str, buffer, len, kCFStringEncodingUTF8)) {
            free(buffer);
            buffer = NULL;
        }
    }
    CFRelease(str);
    return buffer;
}

static uint64_t getCurrentEventId(void) {
    return (uint64_t)FSEventsGetCurrentEventId();
}
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime/cgo"
	"runtime/debug"
	"strings"
	"sync"
	"time"
	"unsafe"

	"oiboard-agent/config"
	"oiboard-agent/scanner"
	"oiboard-agent/store"
)

const (
	flagMustScanSubDirs = 0x00000001
	flagUserDropped     = 0x00000002
	flagKernelDropped   = 0x00000004
	flagIDsWrapped      = 0x00000008
	flagHistoryDone     = 0x00000010
	flagRootChanged     = 0x00000020
	flagMount           = 0x00000040
	flagUnmount         = 0x00000080
	flagItemCreated     = 0x00000100
	flagItemRemoved     = 0x00000200
	flagItemRenamed     = 0x00000800
	flagItemModified    = 0x00001000
	flagItemIsDir       = 0x00020000
	flagItemIsFile      = 0x00010000

	maxPendingEvents = 5000 // 事件风暴降级阈值
)

// BatchProcessor 抽象扫描器的批量与全量处理能力
type BatchProcessor interface {
	ProcessBatch(paths []string) bool
	ScanAll(forceFull bool) (store.GlobalStats, error)
	PathsUnder(dir string) []string
}

type RootState struct {
	EventID uint64 `json:"event_id"`
	UUID    string `json:"uuid"`
}

// EventIDDecision 保存 eventId 回放决议
type EventIDDecision struct {
	SinceID            uint64
	NeedResetAndRescan bool
	TargetUUID         string
	LogMsg             string
	IsWarning          bool
}

// DecideEventIDReplay 根据已存状态与当前设备 UUID 决议回放起点与是否需要重扫
func DecideEventIDReplay(cleanRoot string, hasSaved bool, savedState RootState, currentUUID string) EventIDDecision {
	const sinceNow = 0xFFFFFFFFFFFFFFFF

	if !hasSaved || savedState.EventID == 0 {
		return EventIDDecision{
			SinceID:            sinceNow,
			NeedResetAndRescan: false,
			TargetUUID:         currentUUID,
			LogMsg:             fmt.Sprintf("[FSEvents] 目录 %s 从当前时刻开始监听", cleanRoot),
		}
	}

	// 此时 hasSaved 为 true 且 savedState.EventID > 0
	if savedState.UUID != "" && currentUUID != "" {
		if savedState.UUID != currentUUID {
			return EventIDDecision{
				SinceID:            sinceNow,
				NeedResetAndRescan: true,
				TargetUUID:         currentUUID,
				LogMsg:             fmt.Sprintf("[FSEvents] 目录 %s 设备 UUID 不一致 (旧: %s, 新: %s)，丢弃 eventId 并重扫", cleanRoot, savedState.UUID, currentUUID),
			}
		}
		return EventIDDecision{
			SinceID:            savedState.EventID,
			NeedResetAndRescan: false,
			TargetUUID:         currentUUID,
			LogMsg:             fmt.Sprintf("[FSEvents] 目录 %s 从 eventId=%d 回放增量事件", cleanRoot, savedState.EventID),
		}
	}

	// 规则 1: 如果 saved 有 uuid 但当前拿不到 uuid（比如设备离线或特殊卷），视为不可靠，丢弃 eventId，立即 ScanAll
	if savedState.UUID != "" && currentUUID == "" {
		return EventIDDecision{
			SinceID:            sinceNow,
			NeedResetAndRescan: true,
			TargetUUID:         "",
			LogMsg:             fmt.Sprintf("[FSEvents] 目录 %s 原有 UUID=%s 但当前设备无法获取 UUID，视为不可靠，丢弃 eventId 并重扫", cleanRoot, savedState.UUID),
		}
	}

	// 规则 2: 如果 saved 没有 uuid（旧文件升级上来），但当前能拿到 uuid，则用当前 uuid 补上并保存，eventId 仍信任（平滑升级，不需要重扫）
	if savedState.UUID == "" && currentUUID != "" {
		return EventIDDecision{
			SinceID:            savedState.EventID,
			NeedResetAndRescan: false,
			TargetUUID:         currentUUID,
			LogMsg:             fmt.Sprintf("[FSEvents] 目录 %s 兼容旧版无 UUID 配置，平滑升级绑定 UUID=%s，信任已存 eventId=%d 回放", cleanRoot, currentUUID, savedState.EventID),
		}
	}

	// 规则 3: 如果两者都拿不到 uuid，打 warning 并信任 eventId
	return EventIDDecision{
		SinceID:            savedState.EventID,
		NeedResetAndRescan: false,
		TargetUUID:         "",
		LogMsg:             fmt.Sprintf("[FSEvents] 警告: 目录 %s 无法获取设备 UUID 且无旧 UUID 记录，信任 eventId=%d 回放", cleanRoot, savedState.EventID),
		IsWarning:          true,
	}
}

type streamContext struct {
	root     string
	realRoot string
	uuid     string
	w        *Watcher
	stream   C.FSEventStreamRef
	handle   cgo.Handle
}

type Watcher struct {
	cfg       *config.Config
	sc        BatchProcessor
	onChange  func()
	statePath string

	qMu   sync.RWMutex
	queue C.dispatch_queue_t

	smu     sync.Mutex
	streams map[string]*streamContext

	mu            sync.Mutex
	pending       map[string]bool
	dirs          map[string]bool
	needFull      bool
	currentStates map[string]RootState
	timer         *time.Timer
	stopped       bool
	panicCount    int

	flushMu          sync.Mutex
	lastPersist      time.Time
	lastFullScan     time.Time
	fullScanCooldown time.Duration
}

func (w *Watcher) BackendName() string {
	return "FSEvents"
}

func (w *Watcher) SetCooldown(d time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.fullScanCooldown = d
}

func (w *Watcher) getQueue() C.dispatch_queue_t {
	w.qMu.RLock()
	defer w.qMu.RUnlock()
	return w.queue
}

func (w *Watcher) ensureQueueLocked() C.dispatch_queue_t {
	w.qMu.Lock()
	defer w.qMu.Unlock()
	if w.queue == nil {
		cLabel := C.CString("com.oiboard.fsevents.queue")
		w.queue = C.createSerialQueue(cLabel)
		C.free(unsafe.Pointer(cLabel))
	}
	return w.queue
}

func NewWatcher(cfg *config.Config, sc BatchProcessor, onChange func()) (*Watcher, error) {
	w := &Watcher{
		cfg:              cfg,
		sc:               sc,
		onChange:         onChange,
		streams:          make(map[string]*streamContext),
		pending:          make(map[string]bool),
		dirs:             make(map[string]bool),
		currentStates:    make(map[string]RootState),
		lastPersist:      time.Now(),
		fullScanCooldown: 30 * time.Second,
	}
	return w, nil
}

func (w *Watcher) SetStatePath(path string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.statePath = path
}

func (w *Watcher) loadEventIDs() map[string]RootState {
	res := make(map[string]RootState)
	if w.statePath == "" {
		return res
	}
	data, err := os.ReadFile(w.statePath)
	if err != nil {
		return res
	}

	// 1. 尝试新结构解析
	if err := json.Unmarshal(data, &res); err == nil && len(res) > 0 {
		return res
	}

	// 2. 兼容旧结构 map[string]uint64
	var legacy map[string]uint64
	if err := json.Unmarshal(data, &legacy); err == nil {
		for k, v := range legacy {
			res[k] = RootState{EventID: v}
		}
	}
	return res
}

func (w *Watcher) persist(states map[string]RootState, force bool) {
	if w.statePath == "" || len(states) == 0 {
		return
	}
	now := time.Now()
	if !force && now.Sub(w.lastPersist) < 5*time.Second {
		return
	}
	w.lastPersist = now

	data, err := json.MarshalIndent(states, "", "  ")
	if err != nil {
		return
	}
	tmp := w.statePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return
	}
	_ = os.Rename(tmp, w.statePath)
}

//export goFSEventsCallback
func goFSEventsCallback(handle C.uintptr_t, path *C.char, flags C.uint32_t, eventId C.uint64_t) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[FSEvents] 回调执行异常 panic: %v\n堆栈:\n%s", r, string(debug.Stack()))
		}
	}()

	h := cgo.Handle(handle)
	sCtx, ok := h.Value().(*streamContext)
	if !ok || sCtx == nil {
		return
	}
	p := C.GoString(path)
	sCtx.w.onEvent(sCtx, p, uint32(flags), uint64(eventId))
}

func (w *Watcher) onEvent(sCtx *streamContext, rawPath string, flags uint32, eventID uint64) {
	if flags&flagHistoryDone != 0 {
		return
	}

	cleanPath := filepath.Clean(rawPath)
	// 将 FSEvents 规范化路径映射回配置中的 root
	if strings.HasPrefix(cleanPath, sCtx.realRoot) {
		rel := strings.TrimPrefix(cleanPath, sCtx.realRoot)
		cleanPath = filepath.Clean(filepath.Join(sCtx.root, rel))
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	if w.stopped {
		return
	}

	st := w.currentStates[sCtx.root]
	if eventID > st.EventID {
		st.EventID = eventID
		if st.UUID == "" {
			st.UUID = sCtx.uuid
		}
		w.currentStates[sCtx.root] = st
	}

	dropMask := uint32(flagMustScanSubDirs | flagUserDropped | flagKernelDropped | flagIDsWrapped | flagRootChanged | flagMount | flagUnmount)
	if flags&dropMask != 0 {
		w.needFull = true
	}

	if os.Getenv("OIBOARD_DEBUG") == "1" {
		log.Printf("[DEBUG][FSEvents] 接收事件: %s, flags: 0x%08x, eventId: %d", cleanPath, flags, eventID)
	}

	// 忽略过滤
	if scanner.IsIgnoredPath(cleanPath) {
		w.resetTimerLocked()
		return
	}

	// 保护 B: 事件风暴降级
	if w.needFull {
		w.resetTimerLocked()
		return
	}
	if len(w.pending) >= maxPendingEvents {
		w.needFull = true
		w.pending = make(map[string]bool)
		w.dirs = make(map[string]bool)
		log.Printf("[FSEvents] 检测到事件风暴（pending 超过 %d），直接降级为全量增量扫描", maxPendingEvents)
		w.resetTimerLocked()
		return
	}

	if flags&flagItemIsDir != 0 {
		dirActionMask := uint32(flagItemCreated | flagItemRemoved | flagItemRenamed)
		if flags&dirActionMask != 0 {
			w.dirs[cleanPath] = true
		}
		w.resetTimerLocked()
		return
	}

	if _, ok := scanner.ClassifyLanguage(cleanPath); ok {
		w.pending[cleanPath] = true
	}
	w.resetTimerLocked()
}

func (w *Watcher) resetTimerLocked() {
	if w.stopped {
		return
	}
	if w.timer == nil {
		w.timer = time.AfterFunc(300*time.Millisecond, w.flush)
	} else {
		w.timer.Reset(300 * time.Millisecond)
	}
}

func (w *Watcher) flush() {
	w.flushMu.Lock()
	defer w.flushMu.Unlock()

	var filesToProcess []string
	var dirsToProcess []string

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[FSEvents] flush 发生异常 panic: %v\n堆栈:\n%s", r, string(debug.Stack()))
			w.mu.Lock()
			w.panicCount++
			if w.panicCount >= 3 {
				log.Printf("[FSEvents] 严重错误: flush 连续发生 %d 次 panic，放弃本批重试并降级，详细待处理列表已记入错误日志", w.panicCount)
				log.Printf("[FSEvents] 丢弃的待处理文件列表 (%d 个): %v", len(filesToProcess), filesToProcess)
				log.Printf("[FSEvents] 丢弃的待处理目录列表 (%d 个): %v", len(dirsToProcess), dirsToProcess)
				w.panicCount = 0
				w.needFull = false
			} else {
				log.Printf("[FSEvents] flush 发生 panic (第 %d/3 次)，置位 needFull=true 并在 5 秒后重新调度 flush", w.panicCount)
				w.needFull = true
				for _, f := range filesToProcess {
					w.pending[f] = true
				}
				for _, d := range dirsToProcess {
					w.dirs[d] = true
				}
				if w.timer != nil {
					w.timer.Stop()
				}
				w.timer = time.AfterFunc(5*time.Second, w.flush)
			}
			w.mu.Unlock()
		}
	}()

	w.mu.Lock()
	if w.stopped {
		w.mu.Unlock()
		return
	}
	filesToProcess = make([]string, 0, len(w.pending))
	for f := range w.pending {
		filesToProcess = append(filesToProcess, f)
	}
	w.pending = make(map[string]bool)

	dirsToProcess = make([]string, 0, len(w.dirs))
	for d := range w.dirs {
		dirsToProcess = append(dirsToProcess, d)
	}
	w.dirs = make(map[string]bool)

	needFull := w.needFull
	w.needFull = false

	statesSnapshot := make(map[string]RootState, len(w.currentStates))
	for k, v := range w.currentStates {
		statesSnapshot[k] = v
	}
	w.mu.Unlock()

	filesSet := make(map[string]bool, len(filesToProcess))
	for _, f := range filesToProcess {
		filesSet[f] = true
	}

	for _, dir := range dirsToProcess {
		for _, p := range w.sc.PathsUnder(dir) {
			filesSet[p] = true
		}
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			clean := filepath.Clean(path)
			if d.IsDir() {
				if clean != dir && scanner.IsIgnoredPath(clean) {
					return filepath.SkipDir
				}
				return nil
			}
			if scanner.IsIgnoredPath(clean) {
				return nil
			}
			if _, ok := scanner.ClassifyLanguage(clean); ok {
				filesSet[clean] = true
			}
			return nil
		})
	}

	// 保护 B: 批处理展开后如果超过阈值，直接降级为全量扫描
	if len(filesSet) >= maxPendingEvents {
		log.Printf("[FSEvents] 事件风暴降级：单批待处理文件数 %d 超过阈值 %d，直接全量对账", len(filesSet), maxPendingEvents)
		filesSet = make(map[string]bool)
		needFull = true
	}

	anyChanged := false
	if len(filesSet) > 0 {
		paths := make([]string, 0, len(filesSet))
		for p := range filesSet {
			paths = append(paths, p)
		}
		t0 := time.Now()
		if w.sc.ProcessBatch(paths) {
			anyChanged = true
		}
		if os.Getenv("OIBOARD_DEBUG") == "1" {
			log.Printf("[DEBUG][FSEvents] ProcessBatch 增量处理 %d 个文件, 耗时: %v", len(paths), time.Since(t0))
		}
	}

	if needFull {
		now := time.Now()
		timeSinceLast := now.Sub(w.lastFullScan)
		cooldown := w.fullScanCooldown
		if cooldown == 0 {
			cooldown = 30 * time.Second
		}
		if !w.lastFullScan.IsZero() && timeSinceLast < cooldown {
			log.Printf("[FSEvents] 距离上次全量扫描仅 %.1f 秒（处于 %v 冷却期内），暂缓全量扫，累积事件", timeSinceLast.Seconds(), cooldown)
			w.mu.Lock()
			w.needFull = true
			delay := cooldown - timeSinceLast
			if w.timer != nil {
				w.timer.Stop()
			}
			w.timer = time.AfterFunc(delay, w.flush)
			w.mu.Unlock()
		} else {
			log.Printf("[FSEvents] 触发全量增量安全对账...")
			w.lastFullScan = now
			if _, err := w.sc.ScanAll(false); err == nil {
				anyChanged = true
			}
		}
	}

	if anyChanged && w.onChange != nil {
		w.onChange()
	}

	w.persist(statesSnapshot, false)

	w.mu.Lock()
	w.panicCount = 0
	w.mu.Unlock()
}

func (w *Watcher) Start() {
	w.ensureQueueLocked()

	go func() {
		loaded := w.loadEventIDs()
		w.mu.Lock()
		for k, v := range loaded {
			w.currentStates[k] = v
		}
		w.mu.Unlock()

		w.smu.Lock()
		cfgSnap := w.cfg.Get()
		for _, f := range cfgSnap.Folders {
			if f.Enabled {
				cleanRoot := filepath.Clean(f.Path)
				t0 := time.Now()
				w.startLocked(cleanRoot)
				dur := time.Since(t0)
				log.Printf("[FSEvents] 目录 %s 监听就绪 (启动耗时: %v)", cleanRoot, dur)
			}
		}
		w.smu.Unlock()

		// Start 完成后补一次 ReloadFolders，确保在 Start 异步执行期间
		// 用户通过 Web 添加的文件夹最终也能被自动监听到
		w.ReloadFolders()
	}()
}

func (w *Watcher) ReloadFolders() {
	w.smu.Lock()
	defer w.smu.Unlock()

	q := w.getQueue()
	if q == nil {
		return
	}

	active := make(map[string]bool)
	cfgSnap := w.cfg.Get()
	for _, f := range cfgSnap.Folders {
		if f.Enabled {
			active[filepath.Clean(f.Path)] = true
		}
	}

	for root, sCtx := range w.streams {
		if !active[root] {
			C.stopStreamAndDrain(sCtx.stream, q)
			sCtx.handle.Delete()
			delete(w.streams, root)
		}
	}

	for root := range active {
		if _, exists := w.streams[root]; !exists {
			t0 := time.Now()
			w.startLocked(root)
			dur := time.Since(t0)
			log.Printf("[FSEvents] 动态加载目录 %s (耗时: %v)", root, dur)
		}
	}
}

func (w *Watcher) startLocked(root string) {
	cleanRoot := filepath.Clean(root)
	if _, exists := w.streams[cleanRoot]; exists {
		return
	}
	info, err := os.Stat(cleanRoot)
	if err != nil || !info.IsDir() {
		return
	}

	realRoot, err := filepath.EvalSymlinks(cleanRoot)
	if err != nil {
		realRoot = cleanRoot
	}
	realRoot = filepath.Clean(realRoot)

	cRealRoot := C.CString(realRoot)
	defer C.free(unsafe.Pointer(cRealRoot))

	var currentUUID string
	cUuid := C.getDeviceUUIDForPath(cRealRoot)
	if cUuid != nil {
		currentUUID = C.GoString(cUuid)
		C.free(unsafe.Pointer(cUuid))
	}

	w.mu.Lock()
	savedState, hasSaved := w.currentStates[cleanRoot]
	w.mu.Unlock()

	dec := DecideEventIDReplay(cleanRoot, hasSaved, savedState, currentUUID)
	log.Printf("%s", dec.LogMsg)
	sinceID := dec.SinceID
	needResetAndRescan := dec.NeedResetAndRescan

	// 记录当前时刻事件 ID，防止无事件的 root 在下次重启时丢失 eventId
	currSysID := uint64(C.getCurrentEventId())
	w.mu.Lock()
	if needResetAndRescan || !hasSaved || w.currentStates[cleanRoot].EventID == 0 {
		w.currentStates[cleanRoot] = RootState{
			EventID: currSysID,
			UUID:    dec.TargetUUID,
		}
	} else {
		st := w.currentStates[cleanRoot]
		st.UUID = dec.TargetUUID
		w.currentStates[cleanRoot] = st
	}
	w.mu.Unlock()

	sCtx := &streamContext{
		root:     cleanRoot,
		realRoot: realRoot,
		uuid:     currentUUID,
		w:        w,
	}
	h := cgo.NewHandle(sCtx)
	sCtx.handle = h

	q := w.getQueue()
	if q == nil {
		h.Delete()
		return
	}

	stream := C.createAndStartStream(
		cRealRoot,
		C.uint64_t(sinceID),
		1.0,
		q,
		C.uintptr_t(h),
	)
	if stream == nil {
		h.Delete()
		log.Printf("[FSEvents] 启动监听失败: %s", cleanRoot)
		return
	}
	sCtx.stream = stream
	w.streams[cleanRoot] = sCtx

	if needResetAndRescan {
		go func() {
			_, _ = w.sc.ScanAll(false)
		}()
	}
}

func (w *Watcher) Stop() {
	w.mu.Lock()
	w.stopped = true
	if w.timer != nil {
		w.timer.Stop()
	}
	statesSnapshot := make(map[string]RootState, len(w.currentStates))
	for k, v := range w.currentStates {
		statesSnapshot[k] = v
	}
	w.mu.Unlock()

	w.flush()

	w.smu.Lock()
	q := w.getQueue()
	for root, sCtx := range w.streams {
		if q != nil {
			C.stopStreamAndDrain(sCtx.stream, q)
		}
		sCtx.handle.Delete()
		delete(w.streams, root)
	}
	w.smu.Unlock()

	w.persist(statesSnapshot, true)
}
