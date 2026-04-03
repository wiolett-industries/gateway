package config

import (
	"fmt"
	"os"

	"github.com/wiolett/gateway/daemon-shared/lifecycle"
	"gopkg.in/yaml.v3"
)

// DockerConfig holds Docker-specific configuration.
type DockerConfig struct {
	Socket    string   `yaml:"socket"`
	Allowlist []string `yaml:"allowlist"`
}

// Config embeds the shared BaseConfig for the docker daemon.
type Config struct {
	lifecycle.BaseConfig `yaml:",inline"`
	Docker               DockerConfig `yaml:"docker"`
}

// Load reads and parses the docker daemon config file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := &Config{}
	cfg.StateDir = "/var/lib/docker-daemon"
	cfg.LogLevel = "info"
	cfg.LogFormat = "json"
	cfg.Docker.Socket = "unix:///var/run/docker.sock"
	cfg.Docker.Allowlist = []string{"*"}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.Gateway.Address == "" {
		return nil, fmt.Errorf("gateway.address is required")
	}

	return cfg, nil
}
