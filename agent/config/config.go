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

type Config struct {
	ServerURL           string         `json:"server_url"`
	SyncToken           string         `json:"sync_token"`
	Port                int            `json:"port"`
	AutoSync            bool           `json:"auto_sync"`
	AutoSyncIntervalSec int            `json:"auto_sync_interval_sec"`
	AutoScan            bool           `json:"auto_scan"`
	AutoScanIntervalSec int            `json:"auto_scan_interval_sec"`
	Folders             []FolderConfig `json:"folders"`

	filePath string
	mu       sync.RWMutex
}

func DefaultConfig(filePath string) *Config {
	return &Config{
		ServerURL:           "http://198.44.63.140:2053",
		SyncToken:           "",
		Port:                2054,
		AutoSync:            true,
		AutoSyncIntervalSec: 60,
		AutoScan:            true,
		AutoScanIntervalSec: 30,
		Folders:             []FolderConfig{},
		filePath:            filePath,
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

	if err := json.Unmarshal(data, cfg); err != nil {
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

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := c.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, c.filePath)
}

func (c *Config) Get() Config {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return Config{
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
	for i := range c.Folders {
		if filepath.Clean(c.Folders[i].Path) == cleanPath {
			c.Folders[i].FileCount = fileCount
			c.Folders[i].LineCount = lineCount
			c.Folders[i].LastScan = scanTime
			break
		}
	}
	c.mu.Unlock()
	_ = c.Save()
}
