package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/scanner"
	"oiboard-agent/server"
	"oiboard-agent/store"
	"oiboard-agent/syncer"
	"oiboard-agent/watcher"
)

const (
	version = "1.0.0"
)

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatalf("无法获取用户主目录: %v", err)
	}
	defaultDataDir := filepath.Join(home, ".oiboard-agent")

	logDir := filepath.Join(home, "Library/Logs")
	_ = os.MkdirAll(logDir, 0755)
	if lw, err := newRotWriter(filepath.Join(logDir, "oiboard-agent.log")); err == nil {
		log.SetOutput(lw)
	}

	portFlag := flag.Int("port", 0, "本地后台管理网页端口 (默认 2054)")
	dataDirFlag := flag.String("data", defaultDataDir, "数据与配置文件存储目录")
	scanNowFlag := flag.Bool("scan-now", false, "立即执行一次扫描并退出")
	noWebFlag := flag.Bool("no-web", false, "纯事件驱动模式运行，不启动 Web 管理后台 HTTP 端口")
	versionFlag := flag.Bool("v", false, "显示版本号")
	flag.BoolVar(versionFlag, "version", false, "显示版本号")
	flag.Parse()

	if *versionFlag {
		fmt.Printf("OIBoard Agent v%s (macOS arm64/amd64)\n", version)
		os.Exit(0)
	}

	if err := os.MkdirAll(*dataDirFlag, 0755); err != nil {
		log.Fatalf("无法创建数据目录 %s: %v", *dataDirFlag, err)
	}

	configPath := filepath.Join(*dataDirFlag, "config.json")
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	if *portFlag > 0 {
		cfg.SetPort(*portFlag)
	}

	activePort := cfg.Get().Port
	if activePort <= 0 {
		activePort = 2054
	}

	statePath := filepath.Join(*dataDirFlag, "state.json")
	st, err := store.NewStore(statePath)
	if err != nil {
		log.Fatalf("初始化存储失败: %v", err)
	}

	sc := scanner.NewScanner(cfg, st)
	syn := syncer.NewSyncer(cfg, st)

	if *scanNowFlag {
		log.Printf("[CLI] 正在执行代码全量/增量扫描...")
		stats, err := sc.ScanAll(false)
		if err != nil {
			log.Fatalf("扫描失败: %v", err)
		}
		log.Printf("[CLI] 扫描完成: 总文件数 %d, 今日文件数 %d, 总行数: %d, 今日行数: %d",
			stats.TotalFiles, stats.TodayFiles, stats.TotalLines, stats.TodayLines)

		if cfg.Get().ServerURL != "" && cfg.Get().SyncToken != "" {
			log.Printf("[CLI] 正在同步数据至服务器 %s ...", cfg.Get().ServerURL)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if err := syn.SyncNow(ctx); err != nil {
				log.Printf("[CLI] 同步失败: %v", err)
			} else {
				log.Printf("[CLI] 同步成功!")
			}
		}
		os.Exit(0)
	}

	log.Printf("==================================================")
	log.Printf("  OIBoard 本地代码统计守护服务 (macOS Agent) v%s", version)
	log.Printf("  本地管理后台: http://127.0.0.1:%d", activePort)
	log.Printf("  数据存储目录: %s", *dataDirFlag)
	log.Printf("==================================================")

	// 事件驱动与变动防抖自动同步
	var syncDebounceTimer *time.Timer
	var syncMu sync.Mutex

	triggerSync := func() {
		cfgSnap := cfg.Get()
		if cfgSnap.AutoSync && cfgSnap.SyncToken != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := syn.SyncNow(ctx); err != nil {
				log.Printf("[EventSync] 自动同步失败: %v", err)
			} else {
				log.Printf("[EventSync] 代码变动已自动同步至看板")
			}
		}
	}

	onFileChange := func() {
		syncMu.Lock()
		defer syncMu.Unlock()
		if syncDebounceTimer != nil {
			syncDebounceTimer.Stop()
		}
		// 用户编辑可能连续保存，防抖 1.5 秒后仅执行一次网络同步
		syncDebounceTimer = time.AfterFunc(1500*time.Millisecond, triggerSync)
	}

	// 启动 HTTP 后台管理服务 (若未指定 -no-web)
	var srv *server.Server
	if !*noWebFlag {
		srv = server.NewServer(cfg, st, sc, syn)
		go func() {
			if err := srv.Start(activePort); err != nil && err != http.ErrServerClosed {
				log.Fatalf("HTTP 服务异常退出: %v", err)
			}
		}()
	} else {
		log.Printf("[Mode] 正在以纯事件驱动模式运行 (无 Web 端口，0 端口暴露)")
	}

	// 启动文件变动监听器 (自动根据编译标签选择 macOS 原生 FSEvents 或跨平台 kqueue)
	fWatcher, err := watcher.NewWatcher(cfg, sc, onFileChange)
	if err != nil {
		log.Printf("[Watcher] 初始化文件监听失败，将回退至定时增量轮询: %v", err)
	} else {
		if srv != nil {
			srv.SetFolderChangedHook(func() {
				fWatcher.ReloadFolders()
			})
		}
		fWatcher.SetStatePath(filepath.Join(*dataDirFlag, "fsevents.json"))
		fWatcher.Start()
		log.Printf("[Watcher] 原生文件变动监听已启动 (基于 macOS %s，仅对改动文件进行微秒级增量统计)", fWatcher.BackendName())
	}

	// 启动时在后台执行一次基线初始化扫描与初始同步
	go func() {
		time.Sleep(500 * time.Millisecond)
		log.Printf("[Daemon] 正在执行启动基线扫描...")
		stats, err := sc.ScanAll(false)
		if err != nil {
			log.Printf("[Daemon] 初始扫描失败: %v", err)
		} else {
			log.Printf("[Daemon] 初始扫描完成: 总行数 %d, 今日行数 %d, 总文件数 %d",
				stats.TotalLines, stats.TodayLines, stats.TotalFiles)
			if cfg.Get().AutoSync && cfg.Get().SyncToken != "" {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				_ = syn.SyncNow(ctx)
			}
		}
	}()

	// 巡检与健康检查 Ticker (1分钟轻量感知，外置盘重新挂载自动补 stream，24小时兜底全量对账)
	stopChan := make(chan struct{})
	go func() {
		tk := time.NewTicker(time.Minute)
		defer tk.Stop()
		lastFullScan := time.Now()
		for {
			select {
			case <-stopChan:
				return
			case <-tk.C:
				now := time.Now().Round(0)

				if st.RolloverIfNeeded(now) {
					// 跨天后触发一次同步，让服务端拿到新的一天的基线
					go triggerSync()
				}

				if fWatcher != nil {
					fWatcher.ReloadFolders()
				}

				// 全量对账间隔为 24 小时兜底（日常以 FSEvents 实时事件驱动为主）
				if cfg.Get().AutoScan && now.Sub(lastFullScan) > 24*time.Hour {
					_, _ = sc.ScanAll(false)
					lastFullScan = now
				}
			}
		}
	}()


	// 监听退出信号
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	sig := <-sigChan
	log.Printf("收到退出信号 (%v)，正在优雅关闭 Agent 服务...", sig)
	close(stopChan)
	if fWatcher != nil {
		fWatcher.Stop()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if srv != nil {
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("HTTP 服务关闭时出错: %v", err)
		}
	}

	if err := st.Save(); err != nil {
		log.Printf("保存状态数据时出错: %v", err)
	}

	log.Printf("OIBoard Agent 已安全退出。")
}
