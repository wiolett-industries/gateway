package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Gateway  GatewayConfig  `yaml:"gateway"`
	TLS      TLSConfig      `yaml:"tls"`
	Nginx    NginxConfig    `yaml:"nginx"`
	StateDir string         `yaml:"state_dir"`
	LogLevel string         `yaml:"log_level"`
	LogFormat string        `yaml:"log_format"`
}

type GatewayConfig struct {
	Address string `yaml:"address"`
	Token   string `yaml:"token"`
}

type TLSConfig struct {
	CACert     string `yaml:"ca_cert"`
	ClientCert string `yaml:"client_cert"`
	ClientKey  string `yaml:"client_key"`
}

type NginxConfig struct {
	ConfigDir        string `yaml:"config_dir"`
	CertsDir         string `yaml:"certs_dir"`
	LogsDir          string `yaml:"logs_dir"`
	GlobalConfig     string `yaml:"global_config"`
	Binary           string `yaml:"binary"`
	StubStatusURL    string `yaml:"stub_status_url"`
	HtpasswdDir      string `yaml:"htpasswd_dir"`
	AcmeChallengeDir string `yaml:"acme_challenge_dir"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := &Config{
		StateDir:  "/var/lib/nginx-daemon",
		LogLevel:  "info",
		LogFormat: "json",
	}
	cfg.Nginx.Binary = "/usr/sbin/nginx"
	cfg.Nginx.ConfigDir = "/etc/nginx/conf.d/sites"
	cfg.Nginx.CertsDir = "/etc/nginx/certs"
	cfg.Nginx.LogsDir = "/var/log/nginx"
	cfg.Nginx.GlobalConfig = "/etc/nginx/nginx.conf"
	cfg.Nginx.StubStatusURL = "http://127.0.0.1/nginx_status"
	cfg.Nginx.HtpasswdDir = "/etc/nginx/htpasswd"
	cfg.Nginx.AcmeChallengeDir = "/var/www/acme-challenge"

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("validate config: %w", err)
	}

	return cfg, nil
}

func (c *Config) validate() error {
	if c.Gateway.Address == "" {
		return fmt.Errorf("gateway.address is required")
	}
	if c.Nginx.Binary == "" {
		return fmt.Errorf("nginx.binary is required")
	}
	if c.Nginx.ConfigDir == "" {
		return fmt.Errorf("nginx.config_dir is required")
	}
	if c.Nginx.CertsDir == "" {
		return fmt.Errorf("nginx.certs_dir is required")
	}
	return nil
}

// ClearTokenFromFile re-reads the config file, removes the token, and writes it back.
func (c *Config) ClearTokenFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	// Parse into a generic map so we don't lose any fields
	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return err
	}

	// Clear the token in the gateway section
	if gw, ok := raw["gateway"].(map[string]interface{}); ok {
		delete(gw, "token")
	}

	out, err := yaml.Marshal(raw)
	if err != nil {
		return err
	}

	return os.WriteFile(path, out, 0600)
}

func (c *Config) IsEnrolled() bool {
	if c.TLS.CACert == "" || c.TLS.ClientCert == "" || c.TLS.ClientKey == "" {
		return false
	}
	// Check that cert files actually exist on disk
	for _, path := range []string{c.TLS.CACert, c.TLS.ClientCert, c.TLS.ClientKey} {
		if _, err := os.Stat(path); err != nil {
			return false
		}
	}
	return true
}
