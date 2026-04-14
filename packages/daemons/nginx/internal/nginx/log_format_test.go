package nginx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureLogFormatInjectsIntoHTTPBlock(t *testing.T) {
	dir := t.TempDir()
	confPath := filepath.Join(dir, "nginx.conf")
	original := "events {}\nhttp {\n    server { listen 80; }\n}\n"

	if err := os.WriteFile(confPath, []byte(original), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	modified, err := EnsureLogFormat(confPath)
	if err != nil {
		t.Fatalf("ensure log format: %v", err)
	}
	if !modified {
		t.Fatal("expected config to be modified")
	}

	data, err := os.ReadFile(confPath)
	if err != nil {
		t.Fatalf("read updated config: %v", err)
	}
	content := string(data)

	if !strings.Contains(content, "Gateway daemon log format (auto-injected)") {
		t.Fatal("expected injected marker comment")
	}
	if strings.Count(content, "gateway_combined") != 1 {
		t.Fatalf("expected gateway_combined to appear once, got %d", strings.Count(content, "gateway_combined"))
	}
}

func TestEnsureLogFormatNoopWhenAlreadyPresent(t *testing.T) {
	dir := t.TempDir()
	confPath := filepath.Join(dir, "nginx.conf")
	existing := "events {}\nhttp {\n    log_format gateway_combined '$remote_addr';\n}\n"

	if err := os.WriteFile(confPath, []byte(existing), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	modified, err := EnsureLogFormat(confPath)
	if err != nil {
		t.Fatalf("ensure log format: %v", err)
	}
	if modified {
		t.Fatal("expected config to remain unchanged")
	}

	data, err := os.ReadFile(confPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if string(data) != existing {
		t.Fatal("expected existing config content to remain unchanged")
	}
}
