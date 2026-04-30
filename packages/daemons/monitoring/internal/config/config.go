package config

import (
	"fmt"
	"os"

	"github.com/wiolett-industries/gateway/daemon-shared/lifecycle"
	"gopkg.in/yaml.v3"
)

// Config embeds the shared BaseConfig for the monitoring daemon.
type Config struct {
	lifecycle.BaseConfig `yaml:",inline"`
}

// Load reads and parses the monitoring daemon config file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := &Config{}
	cfg.StateDir = "/var/lib/monitoring-daemon"
	cfg.LogLevel = "info"
	cfg.LogFormat = "json"

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.Gateway.Address == "" {
		return nil, fmt.Errorf("gateway.address is required")
	}

	return cfg, nil
}
