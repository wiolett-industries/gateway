package daemon

import (
	"context"
	"log/slog"

	"github.com/wiolett/gateway/daemon-shared/lifecycle"
	"github.com/wiolett/gateway/nginx-daemon/internal/config"
)

// Version is set via -ldflags at build time; falls back to "dev".
var Version = "dev"

// Daemon wraps the shared DaemonBase with nginx-specific behavior.
type Daemon struct {
	base   *lifecycle.DaemonBase
	plugin *NginxPlugin
}

// New creates a new nginx Daemon.
func New(cfg *config.Config, cfgPath string, logger *slog.Logger) (*Daemon, error) {
	// Set shared lifecycle version
	lifecycle.Version = Version

	// Build base config from the nginx config
	baseCfg := &lifecycle.BaseConfig{
		Gateway: lifecycle.GatewayConfig{
			Address: cfg.Gateway.Address,
			Token:   cfg.Gateway.Token,
		},
		TLS: lifecycle.TLSConfig{
			CACert:     cfg.TLS.CACert,
			ClientCert: cfg.TLS.ClientCert,
			ClientKey:  cfg.TLS.ClientKey,
		},
		StateDir:  cfg.StateDir,
		LogLevel:  cfg.LogLevel,
		LogFormat: cfg.LogFormat,
	}

	plugin := NewNginxPlugin(cfg)

	base, err := lifecycle.NewDaemonBase(baseCfg, cfgPath, plugin, logger)
	if err != nil {
		return nil, err
	}

	// Give the plugin access to the shared state
	plugin.SetState(base.GetState())

	return &Daemon{
		base:   base,
		plugin: plugin,
	}, nil
}

// Run starts the daemon lifecycle.
func (d *Daemon) Run(ctx context.Context) error {
	return d.base.Run(ctx)
}
