package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/scanner"
	"oiboard-agent/store"
	"oiboard-agent/syncer"
	"oiboard-agent/web"
)

type Server struct {
	cfg     *config.Config
	st      *store.Store
	sc      *scanner.Scanner
	sync    *syncer.Syncer
	httpSrv *http.Server
}

func NewServer(cfg *config.Config, st *store.Store, sc *scanner.Scanner, syn *syncer.Syncer) *Server {
	return &Server{
		cfg:  cfg,
		st:   st,
		sc:   sc,
		sync: syn,
	}
}

func (s *Server) Start(port int) error {
	mux := http.NewServeMux()

	// 嵌入式静态文件服务
	staticSubFS, err := fs.Sub(web.StaticFS, "static")
	if err == nil {
		fileServer := http.FileServer(http.FS(staticSubFS))
		mux.Handle("/static/", http.StripPrefix("/static/", fileServer))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" || r.URL.Path == "/index.html" {
				indexBytes, err := web.StaticFS.ReadFile("static/index.html")
				if err == nil {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(indexBytes)
					return
				}
			}
			fileServer.ServeHTTP(w, r)
		})
	}

	// REST API 路由注册
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/scan", s.handleScan)
	mux.HandleFunc("/api/folders", s.handleFolders)
	mux.HandleFunc("/api/folders/toggle", s.handleFolderToggle)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/sync", s.handleSync)
	mux.HandleFunc("/api/test-connection", s.handleTestConnection)
	mux.HandleFunc("/api/login", s.handleLogin)
	mux.HandleFunc("/api/files", s.handleFiles)
	mux.HandleFunc("/api/browse-folder", s.handleBrowseFolder)

	addr := fmt.Sprintf(":%d", port)
	s.httpSrv = &http.Server{
		Addr:         addr,
		Handler:      s.corsMiddleware(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	return s.httpSrv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpSrv != nil {
		return s.httpSrv.Shutdown(ctx)
	}
	return nil
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	cfgSnap := s.cfg.Get()
	writeJSON(w, http.StatusOK, map[string]any{
		"stats":       s.st.GetStats(),
		"folders":     cfgSnap.Folders,
		"config":      cfgSnap,
		"is_scanning": s.sc.IsScanning(),
	})
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var req struct {
		Force bool `json:"force"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	stats, err := s.sc.ScanAll(req.Force)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// 自动同步检测
	if s.cfg.Get().AutoSync && s.cfg.Get().SyncToken != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = s.sync.SyncNow(ctx)
		}()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"stats":   stats,
	})
}

func (s *Server) handleFolders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			Path string `json:"path"`
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效请求参数"})
			return
		}
		p := strings.TrimSpace(req.Path)
		if p == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "文件夹路径不能为空"})
			return
		}
		// 展开 ~ 符号 (如果以 ~/ 开头)
		if strings.HasPrefix(p, "~/") {
			home, err := os.UserHomeDir()
			if err == nil {
				p = filepath.Join(home, p[2:])
			}
		}
		p = filepath.Clean(p)
		info, err := os.Stat(p)
		if err != nil || !info.IsDir() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("指定路径不存在或不是文件夹: %s", p)})
			return
		}

		added, err := s.cfg.AddFolder(p, req.Name)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// 添加后立即触发扫描
		go func() {
			_, _ = s.sc.ScanAll(false)
			if s.cfg.Get().AutoSync && s.cfg.Get().SyncToken != "" {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				_ = s.sync.SyncNow(ctx)
			}
		}()

		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"added":   added,
			"path":    p,
		})

	case http.MethodDelete:
		var req struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效请求参数"})
			return
		}
		p := filepath.Clean(strings.TrimSpace(req.Path))
		if err := s.cfg.RemoveFolder(p); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		s.st.DeleteFilesByFolder(p)

		// 重新统计并保存
		go func() {
			_, _ = s.sc.ScanAll(false)
			if s.cfg.Get().AutoSync && s.cfg.Get().SyncToken != "" {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				_ = s.sync.SyncNow(ctx)
			}
		}()

		writeJSON(w, http.StatusOK, map[string]any{"success": true})

	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
	}
}

func (s *Server) handleFolderToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var req struct {
		Path    string `json:"path"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效请求参数"})
		return
	}
	if err := s.cfg.ToggleFolder(req.Path, req.Enabled); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	go func() {
		_, _ = s.sc.ScanAll(false)
	}()

	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var req struct {
		ServerURL   string `json:"server_url"`
		SyncToken   string `json:"sync_token"`
		AutoSync    bool   `json:"auto_sync"`
		AutoSyncSec int    `json:"auto_sync_sec"`
		AutoScan    bool   `json:"auto_scan"`
		AutoScanSec int    `json:"auto_scan_sec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效请求参数"})
		return
	}

	if err := s.cfg.UpdateSettings(req.ServerURL, req.SyncToken, req.AutoSync, req.AutoSyncSec, req.AutoScan, req.AutoScanSec); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"config":  s.cfg.Get(),
	})
}

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	if err := s.sync.SyncNow(ctx); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"stats":   s.st.GetStats(),
	})
}

func (s *Server) handleTestConnection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var req struct {
		ServerURL string `json:"server_url"`
		SyncToken string `json:"sync_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效请求参数"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	username, err := s.sync.TestConnection(ctx, req.ServerURL, req.SyncToken)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"username": username,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	var req struct {
		ServerURL string `json:"server_url"`
		Username  string `json:"username"`
		Password  string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效请求参数"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	token, username, err := s.sync.LoginViaCredentials(ctx, req.ServerURL, req.Username, req.Password)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"token":    token,
		"username": username,
	})
}

func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}
	files := s.st.GetAllFiles()
	writeJSON(w, http.StatusOK, map[string]any{
		"files": files,
		"total": len(files),
	})
}

func (s *Server) handleBrowseFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "osascript", "-e", `POSIX path of (choose folder with prompt "请选择要监控的代码文件夹")`)
	out, err := cmd.Output()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"cancelled": true})
		return
	}

	selectedPath := strings.TrimSpace(string(out))
	if selectedPath == "" {
		writeJSON(w, http.StatusOK, map[string]any{"cancelled": true})
		return
	}

	// 规范化路径并去除末尾斜杠
	selectedPath = filepath.Clean(selectedPath)
	name := filepath.Base(selectedPath)

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"path":    selectedPath,
		"name":    name,
	})
}
