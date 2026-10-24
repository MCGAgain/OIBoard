package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type FolderConfig struct {
	Path      string    `json:"path"`
	Name      string    `json:"name"`
	Enabled   bool      `json:"enabled"`
	AddedAt   time.Time `json:"added_at"`
	FileCount int       `json:"file_count"`
	LineCount int       `json:"line_count"`
	LastScan  time.Time `json:"last_scan"`
}

type ConfigData struct {
	ServerURL           string         `json:"server_url"`
	SyncToken           string         `json:"sync_token"`
	Port                int            `json:"port"`
	AutoSync            bool           `json:"auto_sync"`
	AutoSyncIntervalSec int            `json:"auto_sync_interval_sec"`
	AutoScan            bool           `json:"auto_scan"`
	AutoScanIntervalSec int            `json:"auto_scan_interval_sec"`
	Folders             []FolderConfig `json:"folders"`
}

type Config struct {
	ConfigData
	filePath string
	mu       sync.RWMutex
}

func DefaultConfig(filePath string) *Config {
	return &Config{
		ConfigData: ConfigData{
			ServerURL:           "http://198.44.63.140:2053",
			SyncToken:           "",
			Port:                2054,
			AutoSync:            true,
			AutoSyncIntervalSec: 60,
			AutoScan:            true,
			AutoScanIntervalSec: 30,
			Folders:             []FolderConfig{},
		},
		filePath: filePath,
	}
}

func LoadConfig(filePath string) (*Config, error) {
	cfg := DefaultConfig(filePath)

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			_ = cfg.Save()
			return cfg, nil
		}
		return nil, err
	}

	cfg.mu.Lock()
	defer cfg.mu.Unlock()

	if err := json.Unmarshal(data, &cfg.ConfigData); err != nil {
		return nil, err
	}
	cfg.filePath = filePath
	if cfg.Port <= 0 {
		cfg.Port = 2054
	}
	if cfg.AutoScanIntervalSec <= 0 {
		cfg.AutoScanIntervalSec = 30
	}
	if cfg.AutoSyncIntervalSec <= 0 {
		cfg.AutoSyncIntervalSec = 60
	}
	return cfg, nil
}

func (c *Config) Save() error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	dir := filepath.Dir(c.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(c.ConfigData, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := c.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, c.filePath)
}

// MaskToken 返回掩码后的 token（仅保留末 4 位）
func MaskToken(token string) string {
	if token == "" {
		return ""
	}
	if len(token) <= 4 {
		return "****" + token
	}
	return "****" + token[len(token)-4:]
}

type SafeConfigData struct {
	ServerURL           string         `json:"server_url"`
	SyncToken           string         `json:"sync_token"`
	HasToken            bool           `json:"has_token"`
	Port                int            `json:"port"`
	AutoSync            bool           `json:"auto_sync"`
	AutoSyncIntervalSec int            `json:"auto_sync_interval_sec"`
	AutoScan            bool           `json:"auto_scan"`
	AutoScanIntervalSec int            `json:"auto_scan_interval_sec"`
	Folders             []FolderConfig `json:"folders"`
}

func (c *Config) GetSafe() SafeConfigData {
	raw := c.Get()
	return SafeConfigData{
		ServerURL:           raw.ServerURL,
		SyncToken:           MaskToken(raw.SyncToken),
		HasToken:            raw.SyncToken != "",
		Port:                raw.Port,
		AutoSync:            raw.AutoSync,
		AutoSyncIntervalSec: raw.AutoSyncIntervalSec,
		AutoScan:            raw.AutoScan,
		AutoScanIntervalSec: raw.AutoScanIntervalSec,
		Folders:             raw.Folders,
	}
}

func (c *Config) Get() ConfigData {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return ConfigData{
		ServerURL:           c.ServerURL,
		SyncToken:           c.SyncToken,
		Port:                c.Port,
		AutoSync:            c.AutoSync,
		AutoSyncIntervalSec: c.AutoSyncIntervalSec,
		AutoScan:            c.AutoScan,
		AutoScanIntervalSec: c.AutoScanIntervalSec,
		Folders:             append([]FolderConfig(nil), c.Folders...),
	}
}

func (c *Config) UpdateSettings(serverURL, syncToken string, autoSync bool, autoSyncSec int, autoScan bool, autoScanSec int) error {
	c.mu.Lock()
	if serverURL != "" {
		c.ServerURL = serverURL
	}
	c.SyncToken = syncToken
	c.AutoSync = autoSync
	if autoSyncSec > 0 {
		c.AutoSyncIntervalSec = autoSyncSec
	}
	c.AutoScan = autoScan
	if autoScanSec > 0 {
		c.AutoScanIntervalSec = autoScanSec
	}
	c.mu.Unlock()
	return c.Save()
}

func (c *Config) SetPort(port int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Port = port
}

func (c *Config) AddFolder(folderPath, name string) (bool, error) {
	c.mu.Lock()
	cleanPath := filepath.Clean(folderPath)
	for _, f := range c.Folders {
		if filepath.Clean(f.Path) == cleanPath {
			c.mu.Unlock()
			return false, nil // already exists
		}
	}
	if name == "" {
		name = filepath.Base(cleanPath)
	}
	c.Folders = append(c.Folders, FolderConfig{
		Path:     cleanPath,
		Name:     name,
		Enabled:  true,
		AddedAt:  time.Now(),
		LastScan: time.Time{},
	})
	c.mu.Unlock()
	return true, c.Save()
}

func (c *Config) RemoveFolder(folderPath string) error {
	c.mu.Lock()
	cleanPath := filepath.Clean(folderPath)
	var newFolders []FolderConfig
	for _, f := range c.Folders {
		if filepath.Clean(f.Path) != cleanPath {
			newFolders = append(newFolders, f)
		}
	}
	c.Folders = newFolders
	c.mu.Unlock()
	return c.Save()
}

func (c *Config) ToggleFolder(folderPath string, enabled bool) error {
	c.mu.Lock()
	cleanPath := filepath.Clean(folderPath)
	for i := range c.Folders {
		if filepath.Clean(c.Folders[i].Path) == cleanPath {
			c.Folders[i].Enabled = enabled
			break
		}
	}
	c.mu.Unlock()
	return c.Save()
}

func (c *Config) UpdateFolderStats(folderPath string, fileCount, lineCount int, scanTime time.Time) {
	c.mu.Lock()
	cleanPath := filepath.Clean(folderPath)
	changed := false
	for i := range c.Folders {
		if filepath.Clean(c.Folders[i].Path) == cleanPath {
			if c.Folders[i].FileCount != fileCount || c.Folders[i].LineCount != lineCount {
				c.Folders[i].FileCount = fileCount
				c.Folders[i].LineCount = lineCount
				changed = true
			}
			c.Folders[i].LastScan = scanTime
			break
		}
	}
	c.mu.Unlock()
	if changed {
		_ = c.Save()
	}
}
