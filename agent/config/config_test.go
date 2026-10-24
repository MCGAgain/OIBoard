package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMaskToken(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"", ""},
		{"a", "****a"},
		{"abcd", "****abcd"},
		{"abcdef", "****cdef"},
		{"c0dcd50180292ee7f18202d3051152340e232d0626d0502295ac5ebc1bc5dc98", "****dc98"},
	}

	for _, tc := range cases {
		got := MaskToken(tc.input)
		if got != tc.expected {
			t.Errorf("MaskToken(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

func TestGetSafe(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oiboard_config_test_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cfgPath := filepath.Join(tmpDir, "config.json")
	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatal(err)
	}

	// 1. 无 token 时
	safe1 := cfg.GetSafe()
	if safe1.HasToken || safe1.SyncToken != "" {
		t.Fatalf("expected HasToken=false and empty SyncToken, got %+v", safe1)
	}

	// 2. 有 token 时
	rawToken := "c0dcd50180292ee7f18202d3051152340e232d0626d0502295ac5ebc1bc5dc98"
	_ = cfg.UpdateSettings("http://test-server:2053", rawToken, true, 60, true, 30)

	safe2 := cfg.GetSafe()
	if !safe2.HasToken {
		t.Fatalf("expected HasToken=true")
	}
	if safe2.SyncToken != "****dc98" {
		t.Fatalf("expected masked token '****dc98', got %q", safe2.SyncToken)
	}
	// 确认底层配置依然完整保留明文 token
	if cfg.Get().SyncToken != rawToken {
		t.Fatalf("expected underlying SyncToken to stay untouched")
	}
}
