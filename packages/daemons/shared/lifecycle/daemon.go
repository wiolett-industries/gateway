package lifecycle

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"runtime"

	"github.com/wiolett-industries/gateway/daemon-shared/auth"
	"github.com/wiolett-industries/gateway/daemon-shared/connector"
	"github.com/wiolett-industries/gateway/daemon-shared/enrollment"
	"github.com/wiolett-industries/gateway/daemon-shared/state"
	"github.com/wiolett-industries/gateway/daemon-shared/stream"
	"github.com/wiolett-industries/gateway/daemon-shared/sysmetrics"
)

// Version is set via -ldflags at build time; falls back to "dev".
var Version = "dev"

// DaemonBase is the shared daemon lifecycle manager.
// It handles enrollment, mTLS, reconnection, and delegates
// daemon-specific behavior to the DaemonPlugin.
type DaemonBase struct {
	cfg         *BaseConfig
	cfgPath     string
	state       *state.State
	connector   *connector.Connector
	plugin      DaemonPlugin
	sysReporter *sysmetrics.SystemReporter
	logger      *slog.Logger
	baseHandler slog.Handler // original handler, never wrapped
}

// NewDaemonBase creates a new DaemonBase with the given plugin.
func NewDaemonBase(cfg *BaseConfig, cfgPath string, plugin DaemonPlugin, logger *slog.Logger) (*DaemonBase, error) {
	// Wrap logger with startup buffer so pre-session logs can be replayed
	startupLogger := slog.New(stream.NewStartupLogHandler(logger.Handler()))
	if err := plugin.Init(cfg, startupLogger); err != nil {
		return nil, fmt.Errorf("plugin init: %w", err)
	}

	// Load state
	st, err := state.Load(cfg.StateDir)
	if err != nil {
		return nil, fmt.Errorf("load state: %w", err)
	}

	return &DaemonBase{
		cfg:         cfg,
		cfgPath:     cfgPath,
		state:       st,
		plugin:      plugin,
		sysReporter: newSystemReporter(),
		logger:      startupLogger,
		baseHandler: logger.Handler(), // original handler without startup buffer
	}, nil
}

// Run starts the daemon lifecycle: enroll, connect, session loop.
func (d *DaemonBase) Run(ctx context.Context) error {
	// Step 1: Enroll if not yet enrolled
	if !d.cfg.IsEnrolled() {
		if err := d.enroll(); err != nil {
			return fmt.Errorf("enrollment: %w", err)
		}
	}

	// Step 2: Set up mTLS connector
	tlsMgr := auth.NewTLSManager(d.cfg.TLS.CACert, d.cfg.TLS.ClientCert, d.cfg.TLS.ClientKey)
	d.connector = connector.NewConnector(d.cfg.Gateway.Address, tlsMgr, d.logger)

	// Step 3: Start background cert renewal
	go runCertRenewal(ctx, d)

	// Step 4: Connect and run (with reconnection loop)
	for {
		err := d.runSessionCycle(ctx)
		if ctx.Err() != nil {
			d.logger.Info("shutting down")
			return nil
		}
		// Fatal errors: do NOT reconnect, exit immediately
		if fatal, ok := err.(*FatalError); ok {
			d.logger.Error("fatal: "+fatal.Message, "action", "exiting")
			return fmt.Errorf("fatal: %s", fatal.Message)
		}
		if restart, ok := err.(*RestartRequestedError); ok {
			d.logger.Info(restart.Message, "action", "restarting")
			return fmt.Errorf("restart requested: %s", restart.Message)
		}
		d.logger.Warn("session ended, reconnecting", "error", err)
	}
}

func (d *DaemonBase) enroll() error {
	d.logger.Info("enrolling with gateway", "address", d.cfg.Gateway.Address)

	hostname, _ := os.Hostname()
	osInfo := fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)

	resp, err := enrollment.Enroll(
		d.cfg.Gateway.Address,
		d.cfg.Gateway.Token,
		hostname,
		"", // nginxVersion — filled by plugin if applicable
		osInfo,
		Version,
		d.plugin.Type(),
	)
	if err != nil {
		return err
	}

	// Save credentials
	if err := d.saveCertificates(resp.CaCertificate, resp.ClientCertificate, resp.ClientKey); err != nil {
		return fmt.Errorf("save credentials: %w", err)
	}

	d.state.SetEnrolled(resp.NodeId)
	d.state.SetCertExpiry(resp.CertExpiresAt)
	if err := d.state.Save(); err != nil {
		return fmt.Errorf("save state: %w", err)
	}

	// Clear token from config file on disk to prevent re-use
	d.cfg.Gateway.Token = ""
	if err := ClearTokenFromFile(d.cfgPath); err != nil {
		d.logger.Warn("failed to clear token from config file", "error", err)
	}
	d.logger.Info("enrolled successfully", "node_id", resp.NodeId)
	return nil
}

func (d *DaemonBase) runSessionCycle(ctx context.Context) error {
	conn, err := d.connector.ConnectWithRetry(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	return runSession(ctx, conn, d)
}

func (d *DaemonBase) saveCertificates(caCert, clientCert, clientKey []byte) error {
	return auth.SaveCredentials(
		d.cfg.TLS.CACert,
		d.cfg.TLS.ClientCert,
		d.cfg.TLS.ClientKey,
		caCert,
		clientCert,
		clientKey,
	)
}

// GetState returns the daemon's state for use by plugins.
func (d *DaemonBase) GetState() *state.State {
	return d.state
}
