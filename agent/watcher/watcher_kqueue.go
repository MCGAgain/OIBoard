//go:build !(darwin && cgo)

package watcher

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"oiboard-agent/config"
	"oiboard-agent/scanner"
)

type Watcher struct {
	fsw         *fsnotify.Watcher
	cfg         *config.Config
	sc          *scanner.Scanner
	onChange    func()
	watchedDirs map[string]bool
	mu          sync.Mutex
	stopChan    chan struct{}
}

func (w *Watcher) SetStatePath(string) {}

func (w *Watcher) BackendName() string {
	return "kqueue"
}

func NewWatcher(cfg *config.Config, sc *scanner.Scanner, onChange func()) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &Watcher{
		fsw:         fsw,
		cfg:         cfg,
		sc:          sc,
		onChange:    onChange,
		watchedDirs: make(map[string]bool),
		stopChan:    make(chan struct{}),
	}

	w.ReloadFolders()
	return w, nil
}

// ReloadFolders 根据当前配置动态增减监听目录
func (w *Watcher) ReloadFolders() {
	w.mu.Lock()
	defer w.mu.Unlock()

	activeFolders := make(map[string]bool)
	cfgSnap := w.cfg.Get()
	for _, folder := range cfgSnap.Folders {
		if folder.Enabled {
			clean := filepath.Clean(folder.Path)
			activeFolders[clean] = true
		}
	}

	// 移除不再监听的旧目录
	for dir := range w.watchedDirs {
		inActive := false
		for root := range activeFolders {
			if dir == root || strings.HasPrefix(dir, root+string(filepath.Separator)) {
				inActive = true
				break
			}
		}
		if !inActive {
			_ = w.fsw.Remove(dir)
			delete(w.watchedDirs, dir)
		}
	}

	// 递归添加启用的目录
	for root := range activeFolders {
		w.addRecursiveLocked(root)
	}
}

func (w *Watcher) addRecursiveLocked(root string) {
	cleanRoot := filepath.Clean(root)
	info, err := os.Stat(cleanRoot)
	if err != nil || !info.IsDir() {
		return
	}

	_ = filepath.WalkDir(cleanRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		cleanPath := filepath.Clean(path)
		if cleanPath != cleanRoot && scanner.IsIgnoredPath(cleanPath) {
			return filepath.SkipDir
		}
		if !w.watchedDirs[cleanPath] {
			if err := w.fsw.Add(cleanPath); err == nil {
				w.watchedDirs[cleanPath] = true
			} else {
				log.Printf("[Watcher] 监听失败 %s: %v（可能 fd 耗尽，依赖定时对账兜底）", cleanPath, err)
			}
		}
		return nil
	})
}

// Start 启动文件系统事件监听主循环
func (w *Watcher) Start() {
	go func() {
		debounceTimer := time.NewTimer(time.Hour) // 初始长休眠
		debounceTimer.Stop()
		pendingFiles := make(map[string]bool)
		var pendingMu sync.Mutex

		for {
			select {
			case <-w.stopChan:
				return

			case err, ok := <-w.fsw.Errors:
				if !ok {
					return
				}
				log.Printf("[Watcher] 文件监听异常: %v", err)

			case event, ok := <-w.fsw.Events:
				if !ok {
					return
				}

				name := event.Name
				cleanPath := filepath.Clean(name)

				// 若新创建了子文件夹，自动递归纳入监听
				if event.Op&fsnotify.Create != 0 {
					if info, err := os.Stat(cleanPath); err == nil && info.IsDir() {
						if !scanner.IsIgnoredPath(cleanPath) {
							w.mu.Lock()
							w.addRecursiveLocked(cleanPath)
							w.mu.Unlock()
						}
						continue
					}
				}

				// 忽略非目标源码文件或被排除的临时/隐藏/编译目录
				if scanner.IsIgnoredPath(cleanPath) {
					continue
				}
				if _, ok := scanner.ClassifyLanguage(cleanPath); !ok {
					continue
				}

				// 命中目标源码文件变动（写入、创建、删除、重命名）
				pendingMu.Lock()
				pendingFiles[cleanPath] = true
				debounceTimer.Reset(300 * time.Millisecond)
				pendingMu.Unlock()

			case <-debounceTimer.C:
				pendingMu.Lock()
				files := make([]string, 0, len(pendingFiles))
				for f := range pendingFiles {
					files = append(files, f)
				}
				pendingFiles = make(map[string]bool)
				pendingMu.Unlock()

				if w.sc.ProcessBatch(files) && w.onChange != nil {
					w.onChange()
				}
			}
		}
	}()
}

// Stop 停止监听并释放系统资源
func (w *Watcher) Stop() {
	close(w.stopChan)
	if w.fsw != nil {
		_ = w.fsw.Close()
	}
}
