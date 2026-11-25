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

func TestServer_CaptchaAndLoginFlow(t *testing.T) {
	mockOIBoard := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/captcha":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{
				"captcha_id":    "cid_12345",
				"captcha_image": "data:image/png;base64,iVBORw0KGgo=",
			})
		case "/api/auth/login":
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["captcha_id"] != "cid_12345" || body["captcha_code"] != "ABCD" {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{"detail": "验证码不正确"})
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"token":   "tok_abcdef1234567890",
				"user":    map[string]string{"username": body["username"]},
			})
		case "/api/stats/local-code":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"success":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockOIBoard.Close()

	tmpDir, err := os.MkdirTemp("", "oiboard_captcha_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfg, _ := config.LoadConfig(filepath.Join(tmpDir, "config.json"))
	st, _ := store.NewStore(filepath.Join(tmpDir, "state.json"))
	sc := scanner.NewScanner(cfg, st)
	syn := syncer.NewSyncer(cfg, st)
	srv := NewServer(cfg, st, sc, syn)

	// 1. Fetch captcha via /api/captcha
	reqCap := httptest.NewRequest(http.MethodGet, "/api/captcha?server_url="+mockOIBoard.URL, nil)
	rrCap := httptest.NewRecorder()
	srv.handleCaptcha(rrCap, reqCap)
	if rrCap.Code != http.StatusOK {
		t.Fatalf("expected 200 from /api/captcha, got %d: %s", rrCap.Code, rrCap.Body.String())
	}
	var capResp struct {
		CaptchaID    string `json:"captcha_id"`
		CaptchaImage string `json:"captcha_image"`
	}
	_ = json.Unmarshal(rrCap.Body.Bytes(), &capResp)
	if capResp.CaptchaID != "cid_12345" || capResp.CaptchaImage == "" {
		t.Fatalf("unexpected captcha response: %+v", capResp)
	}

	// 2. Login with wrong captcha fails
	badBody, _ := json.Marshal(map[string]string{
		"server_url":   mockOIBoard.URL,
		"username":     "alice",
		"password":     "secret123",
		"captcha_id":   "cid_12345",
		"captcha_code": "WRONG",
	})
	rrBad := httptest.NewRecorder()
	srv.handleLogin(rrBad, httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(badBody)))
	if rrBad.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on wrong captcha, got %d", rrBad.Code)
	}

	// 3. Login with valid captcha succeeds and persists token
	goodBody, _ := json.Marshal(map[string]string{
		"server_url":   mockOIBoard.URL,
		"username":     "alice",
		"password":     "secret123",
		"captcha_id":   "cid_12345",
		"captcha_code": "ABCD",
	})
	rrGood := httptest.NewRecorder()
	srv.handleLogin(rrGood, httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(goodBody)))
	if rrGood.Code != http.StatusOK {
		t.Fatalf("expected 200 on valid login, got %d: %s", rrGood.Code, rrGood.Body.String())
	}
	if cfg.Get().SyncToken != "tok_abcdef1234567890" {
		t.Fatalf("expected persisted token, got %q", cfg.Get().SyncToken)
	}
	if cfg.Get().ServerURL != mockOIBoard.URL {
		t.Fatalf("expected persisted server_url %q, got %q", mockOIBoard.URL, cfg.Get().ServerURL)
	}
}
