package syncer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"oiboard-agent/config"
	"oiboard-agent/store"
)

type Syncer struct {
	cfg    *config.Config
	st     *store.Store
	client *http.Client
}

func NewSyncer(cfg *config.Config, st *store.Store) *Syncer {
	return &Syncer{
		cfg: cfg,
		st:  st,
		client: &http.Client{
			Timeout: 12 * time.Second,
		},
	}
}

type SyncPayload struct {
	TotalLines int      `json:"total_lines"`
	TodayLines int      `json:"today_lines"`
	TotalFiles int      `json:"total_files"`
	TodayFiles int      `json:"today_files"`
	CLines     int      `json:"c_lines"`
	CFiles     int      `json:"c_files"`
	CPPLines   int      `json:"cpp_lines"`
	CPPFiles   int      `json:"cpp_files"`
	JavaLines  int      `json:"java_lines"`
	JavaFiles  int      `json:"java_files"`
	Folders    []string `json:"folders"`
	SyncedAt   string   `json:"synced_at"`
}

func normalizeServerURL(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSuffix(raw, "/")
	if raw == "" {
		return "http://127.0.0.1:2053"
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		return "http://" + raw
	}
	return raw
}

// SyncNow 执行立即同步至 OIBoard 服务器
func (s *Syncer) SyncNow(ctx context.Context) error {
	cfgSnap := s.cfg.Get()
	serverURL := normalizeServerURL(cfgSnap.ServerURL)
	token := strings.TrimSpace(cfgSnap.SyncToken)

	if token == "" {
		err := errors.New("尚未配置同步 Token，请在设置中填入 OIBoard 凭据")
		s.st.SetSyncStatus(s.st.GetStats().LastSyncAt, err.Error())
		return err
	}

	stats := s.st.GetStats()
	var folders []string
	for _, f := range cfgSnap.Folders {
		if f.Enabled {
			folders = append(folders, f.Path)
		}
	}

	payload := SyncPayload{
		TotalLines: stats.TotalLines,
		TodayLines: stats.TodayLines,
		TotalFiles: stats.TotalFiles,
		TodayFiles: stats.TodayFiles,
		CLines:     stats.CLines,
		CFiles:     stats.CFiles,
		CPPLines:   stats.CPPLines,
		CPPFiles:   stats.CPPFiles,
		JavaLines:  stats.JavaLines,
		JavaFiles:  stats.JavaFiles,
		Folders:    folders,
		SyncedAt:   time.Now().Format("2006-01-02 15:04:05"),
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		s.st.SetSyncStatus(stats.LastSyncAt, err.Error())
		return err
	}

	reqURL := fmt.Sprintf("%s/api/stats/local-code", serverURL)
	req, err := http.NewRequestWithContext(ctx, "POST", reqURL, bytes.NewReader(bodyBytes))
	if err != nil {
		s.st.SetSyncStatus(stats.LastSyncAt, err.Error())
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := s.client.Do(req)
	if err != nil {
		s.st.SetSyncStatus(stats.LastSyncAt, "连接服务器失败: "+err.Error())
		return err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Detail string `json:"detail"`
		}
		_ = json.Unmarshal(respBytes, &errResp)
		msg := errResp.Detail
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBytes))
		}
		s.st.SetSyncStatus(stats.LastSyncAt, "服务器返回错误: "+msg)
		return errors.New(msg)
	}

	s.st.SetSyncStatus(time.Now(), "")
	return nil
}

// TestConnection 测试与 OIBoard 服务器连通性并校验 Token
func (s *Syncer) TestConnection(ctx context.Context, serverURL, token string) (string, error) {
	serverURL = normalizeServerURL(serverURL)
	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("Token 不能为空")
	}

	reqURL := fmt.Sprintf("%s/api/auth/me", serverURL)
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("无法连接到 OIBoard 服务 (%s): %w", serverURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return "", errors.New("Token 无效或已过期，请重新登录获取最新 Token")
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("服务器响应异常 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var data struct {
		User struct {
			Username string `json:"username"`
		} `json:"user"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&data)
	return data.User.Username, nil
}

// LoginViaCredentials 通过用户名密码一键向 OIBoard 获取登录 Token
func (s *Syncer) LoginViaCredentials(ctx context.Context, serverURL, username, password string) (string, string, error) {
	serverURL = normalizeServerURL(serverURL)
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)

	if username == "" || password == "" {
		return "", "", errors.New("用户名和密码不能为空")
	}

	loginPayload := map[string]string{
		"username": username,
		"password": password,
	}
	b, _ := json.Marshal(loginPayload)

	reqURL := fmt.Sprintf("%s/api/auth/login", serverURL)
	req, err := http.NewRequestWithContext(ctx, "POST", reqURL, bytes.NewReader(b))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("连接失败: %w", err)
	}
	defer resp.Body.Close()

	var res struct {
		Success bool   `json:"success"`
		Token   string `json:"token"`
		Detail  string `json:"detail"`
		Message string `json:"message"`
		User    struct {
			Username string `json:"username"`
		} `json:"user"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&res)

	if resp.StatusCode != http.StatusOK || !res.Success || res.Token == "" {
		msg := res.Detail
		if msg == "" {
			msg = res.Message
		}
		if msg == "" {
			msg = "登录失败，请检查账号密码"
		}
		return "", "", errors.New(msg)
	}

	return res.Token, res.User.Username, nil
}
