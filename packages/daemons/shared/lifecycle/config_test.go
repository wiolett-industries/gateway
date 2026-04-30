package lifecycle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadBaseConfigAppliesDefaults(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	content := "gateway:\n  address: gateway.example:9443\n  cert_sha256: sha256:abc\n"

	if err := os.WriteFile(configPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := LoadBaseConfig(configPath)
	if err != nil {
		t.Fatalf("load base config: %v", err)
	}
	if cfg.Gateway.Address != "gateway.example:9443" {
		t.Fatalf("unexpected gateway address: %q", cfg.Gateway.Address)
	}
	if cfg.Gateway.CertSHA256 != "sha256:abc" {
		t.Fatalf("unexpected gateway cert fingerprint: %q", cfg.Gateway.CertSHA256)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("expected default log level info, got %q", cfg.LogLevel)
	}
	if cfg.LogFormat != "json" {
		t.Fatalf("expected default log format json, got %q", cfg.LogFormat)
	}
}

func TestClearTokenFromFileRemovesOnlyGatewayToken(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	content := "gateway:\n  address: gateway.example:9443\n  token: secret-token\nlog_level: debug\n"

	if err := os.WriteFile(configPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if err := ClearTokenFromFile(configPath); err != nil {
		t.Fatalf("clear token from file: %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	updated := string(data)

	if strings.Contains(updated, "secret-token") {
		t.Fatal("expected gateway token to be removed")
	}
	if !strings.Contains(updated, "address: gateway.example:9443") {
		t.Fatal("expected gateway address to remain in file")
	}
	if !strings.Contains(updated, "log_level: debug") {
		t.Fatal("expected unrelated fields to remain in file")
	}
}

func TestBaseConfigIsEnrolledRequiresCredentialFiles(t *testing.T) {
	dir := t.TempDir()
	caPath := filepath.Join(dir, "ca.pem")
	certPath := filepath.Join(dir, "client.pem")
	keyPath := filepath.Join(dir, "client.key")

	cfg := &BaseConfig{
		TLS: TLSConfig{
			CACert:     caPath,
			ClientCert: certPath,
			ClientKey:  keyPath,
		},
	}

	if cfg.IsEnrolled() {
		t.Fatal("expected unenrolled state when files do not exist")
	}

	for _, path := range []string{caPath, certPath, keyPath} {
		if err := os.WriteFile(path, []byte("test"), 0o600); err != nil {
			t.Fatalf("write credential file %s: %v", path, err)
		}
	}

	if !cfg.IsEnrolled() {
		t.Fatal("expected enrolled state when all credential files exist")
	}
}
