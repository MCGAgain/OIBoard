package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"oiboard-agent/config"
	"oiboard-agent/scanner"
	"oiboard-agent/store"
	"oiboard-agent/syncer"
)

func TestServer_TokenMaskAndPreservation(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_server_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfgPath := filepath.Join(tmpDir, "config.json")
	cfg, _ := config.LoadConfig(cfgPath)
	rawToken := "c0dcd50180292ee7f18202d3051152340e232d0626d0502295ac5ebc1bc5dc98"
	_ = cfg.UpdateSettings("http://test.server:2053", rawToken, true, 60, true, 30)

	st, _ := store.NewStore(filepath.Join(tmpDir, "state.json"))
	sc := scanner.NewScanner(cfg, st)
	syn := syncer.NewSyncer(cfg, st)
	srv := NewServer(cfg, st, sc, syn)

	// 1. 测试 /api/status 不泄露明文 token，返回 has_token 和掩码
	reqStatus := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	rrStatus := httptest.NewRecorder()
	srv.handleStatus(rrStatus, reqStatus)

	if rrStatus.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrStatus.Code)
	}

	bodyStr := rrStatus.Body.String()
	if bytes.Contains([]byte(bodyStr), []byte(rawToken)) {
		t.Fatalf("CRITICAL SECURITY LEAK: /api/status leaked raw token: %s", bodyStr)
	}

	var statusResp struct {
		Config struct {
			SyncToken string `json:"sync_token"`
			HasToken  bool   `json:"has_token"`
		} `json:"config"`
	}
	if err := json.Unmarshal(rrStatus.Body.Bytes(), &statusResp); err != nil {
		t.Fatal(err)
	}
	if !statusResp.Config.HasToken {
		t.Fatalf("expected has_token=true")
	}
	if statusResp.Config.SyncToken != "****dc98" {
		t.Fatalf("expected masked sync_token '****dc98', got %q", statusResp.Config.SyncToken)
	}

	// 2. 测试 /api/config 提交掩码值时，保留原明文 token，不覆盖
	cfgUpdateMasked := map[string]any{
		"server_url": "http://test.server:2053",
		"sync_token": "****dc98",
	}
	reqBody1, _ := json.Marshal(cfgUpdateMasked)
	reqCfg1 := httptest.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(reqBody1))
	rrCfg1 := httptest.NewRecorder()
	srv.handleConfig(rrCfg1, reqCfg1)

	if rrCfg1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrCfg1.Code)
	}
	if cfg.Get().SyncToken != rawToken {
		t.Fatalf("expected token to remain rawToken when submitting mask, got %q", cfg.Get().SyncToken)
	}

	// 3. 测试 /api/config 提交空 token 时，保留原明文 token，不覆盖
	cfgUpdateEmpty := map[string]any{
		"server_url": "http://test.server:2053",
		"sync_token": "",
	}
	reqBody2, _ := json.Marshal(cfgUpdateEmpty)
	reqCfg2 := httptest.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(reqBody2))
	rrCfg2 := httptest.NewRecorder()
	srv.handleConfig(rrCfg2, reqCfg2)

	if rrCfg2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrCfg2.Code)
	}
	if cfg.Get().SyncToken != rawToken {
		t.Fatalf("expected token to remain rawToken when submitting empty, got %q", cfg.Get().SyncToken)
	}

	// 4. 测试 /api/config 提交新有效 token 时，更新为新 token
	newToken := "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"
	cfgUpdateNew := map[string]any{
		"server_url": "http://new.server:2053",
		"sync_token": newToken,
	}
	reqBody3, _ := json.Marshal(cfgUpdateNew)
	reqCfg3 := httptest.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(reqBody3))
	rrCfg3 := httptest.NewRecorder()
	srv.handleConfig(rrCfg3, reqCfg3)

	if rrCfg3.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rrCfg3.Code)
	}
	if cfg.Get().SyncToken != newToken {
		t.Fatalf("expected token to update to newToken, got %q", cfg.Get().SyncToken)
	}
}
