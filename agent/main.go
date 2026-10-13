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
	"syscall"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/scanner"
	"oiboard-agent/server"
	"oiboard-agent/store"
	"oiboard-agent/syncer"
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

	portFlag := flag.Int("port", 0, "本地后台管理网页端口 (默认 2054)")
	dataDirFlag := flag.String("data", defaultDataDir, "数据与配置文件存储目录")
	scanNowFlag := flag.Bool("scan-now", false, "立即执行一次扫描并退出")
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

	// 启动时在后台执行一次扫描与同步
	go func() {
		time.Sleep(1 * time.Second)
		log.Printf("[Daemon] 正在执行启动初始化扫描...")
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

	// 定时扫描 Ticker
	stopChan := make(chan struct{})
	go func() {
		scanSec := cfg.Get().AutoScanIntervalSec
		if scanSec < 5 {
			scanSec = 30
		}
		scanTicker := time.NewTicker(time.Duration(scanSec) * time.Second)
		defer scanTicker.Stop()

		for {
			select {
			case <-stopChan:
				return
			case <-scanTicker.C:
				cfgSnap := cfg.Get()
				if !cfgSnap.AutoScan {
					continue
				}
				curSec := cfgSnap.AutoScanIntervalSec
				if curSec < 5 {
					curSec = 30
				}
				if curSec != scanSec {
					scanSec = curSec
					scanTicker.Reset(time.Duration(scanSec) * time.Second)
				}

				stats, err := sc.ScanAll(false)
				if err != nil {
					log.Printf("[AutoScan] 扫描失败: %v", err)
				} else {
					if cfgSnap.AutoSync && cfgSnap.SyncToken != "" {
						ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
						_ = syn.SyncNow(ctx)
						cancel()
					}
					_ = stats
				}
			}
		}
	}()

	// 定时同步 Ticker
	go func() {
		syncSec := cfg.Get().AutoSyncIntervalSec
		if syncSec < 10 {
			syncSec = 60
		}
		syncTicker := time.NewTicker(time.Duration(syncSec) * time.Second)
		defer syncTicker.Stop()

		for {
			select {
			case <-stopChan:
				return
			case <-syncTicker.C:
				cfgSnap := cfg.Get()
				if !cfgSnap.AutoSync || cfgSnap.SyncToken == "" {
					continue
				}
				curSec := cfgSnap.AutoSyncIntervalSec
				if curSec < 10 {
					curSec = 60
				}
				if curSec != syncSec {
					syncSec = curSec
					syncTicker.Reset(time.Duration(syncSec) * time.Second)
				}

				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				if err := syn.SyncNow(ctx); err != nil {
					log.Printf("[AutoSync] 定时同步失败: %v", err)
				}
				cancel()
			}
		}
	}()

	// 启动 HTTP 服务器
	srv := server.NewServer(cfg, st, sc, syn)
	go func() {
		if err := srv.Start(activePort); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务异常退出: %v", err)
		}
	}()

	// 监听退出信号
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	sig := <-sigChan
	log.Printf("收到退出信号 (%v)，正在优雅关闭 Agent 服务...", sig)
	close(stopChan)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP 服务关闭时出错: %v", err)
	}

	if err := st.Save(); err != nil {
		log.Printf("保存状态数据时出错: %v", err)
	}

	log.Printf("OIBoard Agent 已安全退出。")
}
