package daemon

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"runtime"
	"time"

	"github.com/wiolett/gateway/nginx-daemon/internal/auth"
	"github.com/wiolett/gateway/nginx-daemon/internal/config"
	pb "github.com/wiolett/gateway/nginx-daemon/internal/gatewayv1"
	"github.com/wiolett/gateway/nginx-daemon/internal/nginx"
	"github.com/wiolett/gateway/nginx-daemon/internal/state"
	"google.golang.org/grpc"
)

const Version = "0.1.0"

type Daemon struct {
	cfg         *config.Config
	cfgPath     string
	mgr         *nginx.Manager
	state       *state.State
	handler     *Handler
	reporter    *Reporter
	connector   *Connector
	logger      *slog.Logger
	baseHandler slog.Handler // original handler, never wrapped
}

func New(cfg *config.Config, cfgPath string, logger *slog.Logger) (*Daemon, error) {
	// Verify nginx is available
	mgr := nginx.NewManager(cfg.Nginx.Binary, cfg.Nginx.ConfigDir, cfg.Nginx.CertsDir, cfg.Nginx.GlobalConfig)
	version, err := mgr.GetVersion()
	if err != nil {
		return nil, fmt.Errorf("nginx not found at %s: %w", cfg.Nginx.Binary, err)
	}
	logger.Info("nginx detected", "version", version)

	// Load state
	st, err := state.Load(cfg.StateDir)
	if err != nil {
		return nil, fmt.Errorf("load state: %w", err)
	}

	// Clean up leftover .tmp files from potential crashes
	nginx.CleanTmpFiles(cfg.Nginx.ConfigDir)
	nginx.CleanTmpFiles(cfg.Nginx.CertsDir)

	// Ensure gateway log format is present in nginx.conf
	if modified, err := nginx.EnsureLogFormat(cfg.Nginx.GlobalConfig); err != nil {
		logger.Warn("failed to inject log format", "error", err)
	} else if modified {
		logger.Info("injected gateway_combined log format into nginx.conf")
		mgr.Reload()
	}

	handler := NewHandler(cfg, mgr, st, logger)
	reporter := NewReporter(cfg, mgr, logger)

	return &Daemon{
		cfg:         cfg,
		cfgPath:     cfgPath,
		mgr:         mgr,
		state:       st,
		handler:     handler,
		reporter:    reporter,
		logger:      logger,
		baseHandler: logger.Handler(),
	}, nil
}

func (d *Daemon) Run(ctx context.Context) error {
	// Step 1: Enroll if not yet enrolled
	if !d.cfg.IsEnrolled() {
		if err := d.enroll(); err != nil {
			return fmt.Errorf("enrollment: %w", err)
		}
	}

	// Step 2: Set up mTLS connector
	tlsMgr := auth.NewTLSManager(d.cfg.TLS.CACert, d.cfg.TLS.ClientCert, d.cfg.TLS.ClientKey)
	d.connector = NewConnector(d.cfg.Gateway.Address, tlsMgr, d.logger)

	// Step 3: Start background maintenance
	go d.runLogCleanup(ctx)
	go d.runCertRenewal(ctx, tlsMgr)

	// Step 4: Connect and run (with reconnection loop)
	for {
		err := d.runSession(ctx)
		if ctx.Err() != nil {
			d.logger.Info("shutting down")
			return nil
		}
		d.logger.Warn("session ended, reconnecting", "error", err)
		// Backoff is handled inside ConnectWithRetry
	}
}

func (d *Daemon) enroll() error {
	d.logger.Info("enrolling with gateway", "address", d.cfg.Gateway.Address)

	hostname, _ := os.Hostname()
	nginxVersion, _ := d.mgr.GetVersion()
	osInfo := fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)

	resp, err := auth.Enroll(
		d.cfg.Gateway.Address,
		d.cfg.Gateway.Token,
		hostname,
		nginxVersion,
		osInfo,
		Version,
	)
	if err != nil {
		return err
	}

	// Save credentials
	if err := auth.SaveCredentials(
		d.cfg.TLS.CACert,
		d.cfg.TLS.ClientCert,
		d.cfg.TLS.ClientKey,
		resp.CaCertificate,
		resp.ClientCertificate,
		resp.ClientKey,
	); err != nil {
		return fmt.Errorf("save credentials: %w", err)
	}

	d.state.SetEnrolled(resp.NodeId)
	d.state.SetCertExpiry(resp.CertExpiresAt)
	if err := d.state.Save(); err != nil {
		return fmt.Errorf("save state: %w", err)
	}

	// Clear token from config file on disk to prevent re-use
	d.cfg.Gateway.Token = ""
	if err := d.cfg.ClearTokenFromFile(d.cfgPath); err != nil {
		d.logger.Warn("failed to clear token from config file", "error", err)
	}
	d.logger.Info("enrolled successfully", "node_id", resp.NodeId)
	return nil
}

func (d *Daemon) runSession(ctx context.Context) error {
	conn, err := d.connector.ConnectWithRetry(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	// Reset log streaming state from any previous session
	SetDaemonLogStreaming(false, "info")

	stream, err := OpenCommandStream(ctx, conn)
	if err != nil {
		return fmt.Errorf("open command stream: %w", err)
	}

	// Wrap stream for thread-safe Send calls
	writer := newStreamWriter(stream)

	// Send registration message
	hostname, _ := os.Hostname()
	nginxVersion, _ := d.mgr.GetVersion()
	uptime, _ := d.mgr.GetUptime()

	if err := writer.Send(&pb.DaemonMessage{
		Payload: &pb.DaemonMessage_Register{
			Register: &pb.RegisterMessage{
				NodeId:            d.state.NodeID,
				Hostname:          hostname,
				NginxVersion:      nginxVersion,
				ConfigVersionHash: d.state.GetConfigVersion(),
				DaemonVersion:     Version,
				NginxUptimeSeconds: int64(uptime.Seconds()),
				NginxRunning:      d.mgr.IsRunning(),
			},
		},
	}); err != nil {
		return fmt.Errorf("send register: %w", err)
	}

	d.logger.Info("connected to gateway", "node_id", d.state.NodeID)

	// Install gRPC log forwarder so daemon logs are streamed to the gateway
	logFwd := newLogForwarder(stream)
	sessionLogger := slog.New(newGrpcLogHandler(logFwd, d.baseHandler))
	d.logger = sessionLogger
	d.handler.logger = sessionLogger
	d.reporter.logger = sessionLogger

	// Start health reporter in background
	healthCtx, healthCancel := context.WithCancel(ctx)
	defer healthCancel()
	go d.runHealthReporter(healthCtx, writer)

	// Open log stream in background
	go d.runLogStream(healthCtx, conn)

	// Main command loop
	for {
		cmd, err := stream.Recv()
		if err == io.EOF {
			return fmt.Errorf("stream closed by gateway")
		}
		if err != nil {
			return fmt.Errorf("receive command: %w", err)
		}

		// Handle RequestHealth and RequestStats inline
		switch cmd.Payload.(type) {
		case *pb.GatewayCommand_RequestHealth:
			report := d.reporter.CollectHealth()
			writer.Send(&pb.DaemonMessage{
				Payload: &pb.DaemonMessage_HealthReport{HealthReport: report},
			})
			continue
		case *pb.GatewayCommand_RequestStats:
			report := d.reporter.CollectStats()
			writer.Send(&pb.DaemonMessage{
				Payload: &pb.DaemonMessage_StatsReport{StatsReport: report},
			})
			continue
		}

		// Process command and send result
		result := d.handler.HandleCommand(cmd)
		if err := writer.Send(&pb.DaemonMessage{
			Payload: &pb.DaemonMessage_CommandResult{CommandResult: result},
		}); err != nil {
			return fmt.Errorf("send result: %w", err)
		}
	}
}

func (d *Daemon) runHealthReporter(ctx context.Context, writer *streamWriter) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			report := d.reporter.CollectHealth()
			if err := writer.Send(&pb.DaemonMessage{
				Payload: &pb.DaemonMessage_HealthReport{HealthReport: report},
			}); err != nil {
				d.logger.Debug("failed to send health report", "error", err)
				return
			}
		}
	}
}

// runLogStream opens the LogStream bidi RPC and tails nginx logs on demand
func (d *Daemon) runLogStream(ctx context.Context, conn *grpc.ClientConn) {
	rawStream, err := OpenLogStream(ctx, conn)
	if err != nil {
		d.logger.Debug("failed to open log stream", "error", err)
		return
	}

	// Wrap for thread-safe concurrent Send from multiple goroutines
	logStream := newLogStreamWriter(rawStream)

	// Track active tailers per hostId
	tailers := make(map[string]context.CancelFunc)

	for {
		ctrl, err := logStream.Recv()
		if err != nil {
			d.logger.Debug("log stream recv error", "error", err)
			break
		}

		if ctrl.GetSubscribe() != nil {
			sub := ctrl.GetSubscribe()
			hostId := sub.HostId
			tailLines := int(sub.TailLines)

			// Validate hostId to prevent path traversal
			if !isValidUUID(hostId) {
				d.logger.Warn("invalid hostId in log subscribe", "hostId", hostId)
				continue
			}

			// Cancel existing tailer for this host if any
			if cancel, ok := tailers[hostId]; ok {
				cancel()
			}

			tailCtx, cancel := context.WithCancel(ctx)
			tailers[hostId] = cancel

			accessLogPath := fmt.Sprintf("%s/proxy-%s.access.log", d.cfg.Nginx.LogsDir, hostId)
			errorLogPath := fmt.Sprintf("%s/proxy-%s.error.log", d.cfg.Nginx.LogsDir, hostId)

			// Tail access logs
			go func(hid string, lp string, tl int) {
				if tl > 0 {
					lines, _ := nginx.TailLastN(lp, tl)
					for _, line := range lines {
						parsed := nginx.ParseLogLine(hid, line)
						logStream.Send(&pb.LogStreamMessage{
							Payload: &pb.LogStreamMessage_Entry{
								Entry: &pb.LogEntry{
									HostId:        hid,
									Timestamp:     parsed.Timestamp,
									RemoteAddr:    parsed.RemoteAddr,
									Method:        parsed.Method,
									Path:          parsed.Path,
									Status:        int32(parsed.Status),
									BodyBytesSent: parsed.BodyBytesSent,
									Raw:           parsed.Raw,
									LogType:       "access",
								},
							},
						})
					}
				}
				lines := make(chan string, 100)
				go nginx.TailFile(tailCtx, lp, lines)
				for line := range lines {
					parsed := nginx.ParseLogLine(hid, line)
					logStream.Send(&pb.LogStreamMessage{
						Payload: &pb.LogStreamMessage_Entry{
							Entry: &pb.LogEntry{
								HostId:        hid,
								Timestamp:     parsed.Timestamp,
								RemoteAddr:    parsed.RemoteAddr,
								Method:        parsed.Method,
								Path:          parsed.Path,
								Status:        int32(parsed.Status),
								BodyBytesSent: parsed.BodyBytesSent,
								Raw:           parsed.Raw,
								LogType:       "access",
							},
						},
					})
				}
			}(hostId, accessLogPath, tailLines)

			// Tail error logs
			go func(hid string, lp string) {
				lines := make(chan string, 100)
				go nginx.TailFile(tailCtx, lp, lines)
				for line := range lines {
					logStream.Send(&pb.LogStreamMessage{
						Payload: &pb.LogStreamMessage_Entry{
							Entry: &pb.LogEntry{
								HostId:  hid,
								Raw:     line,
								LogType: "error",
								Level:   nginx.ParseErrorLevel(line),
							},
						},
					})
				}
			}(hostId, errorLogPath)

			logStream.Send(&pb.LogStreamMessage{
				Payload: &pb.LogStreamMessage_SubscribeAck{
					SubscribeAck: &pb.LogSubscribeAck{HostId: hostId},
				},
			})

		} else if ctrl.GetUnsubscribe() != nil {
			hostId := ctrl.GetUnsubscribe().HostId
			if cancel, ok := tailers[hostId]; ok {
				cancel()
				delete(tailers, hostId)
			}
		}
	}

	// Cleanup all tailers
	for _, cancel := range tailers {
		cancel()
	}
}

// runCertRenewal checks cert expiry daily and renews when within 7 days
func (d *Daemon) runCertRenewal(ctx context.Context, tlsMgr *auth.TLSManager) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	check := func() {
		expiresAt := d.state.GetCertExpiry()
		if expiresAt == 0 {
			return
		}
		remaining := time.Until(time.Unix(expiresAt, 0))
		if remaining > 7*24*time.Hour {
			return
		}

		d.logger.Info("mTLS cert expiring soon, renewing", "remaining", remaining)

		conn, err := d.connector.Connect(ctx)
		if err != nil {
			d.logger.Warn("cert renewal: failed to connect", "error", err)
			return
		}
		defer conn.Close()

		client := pb.NewNodeEnrollmentClient(conn)
		renewCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()

		resp, err := client.RenewCertificate(renewCtx, &pb.RenewCertRequest{
			NodeId: d.state.NodeID,
		})
		if err != nil {
			d.logger.Warn("cert renewal failed", "error", err)
			return
		}

		if err := auth.SaveCredentials(
			d.cfg.TLS.CACert, d.cfg.TLS.ClientCert, d.cfg.TLS.ClientKey,
			nil, resp.ClientCertificate, resp.ClientKey,
		); err != nil {
			d.logger.Warn("cert renewal: save failed", "error", err)
			return
		}

		// Hot-swap the TLS credentials
		if err := tlsMgr.LoadCredentials(); err != nil {
			d.logger.Warn("cert renewal: hot-swap failed", "error", err)
			return
		}

		d.state.SetCertExpiry(resp.CertExpiresAt)
		d.state.Save()
		d.logger.Info("mTLS cert renewed successfully")
	}

	check() // Run immediately
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			check()
		}
	}
}

// runLogCleanup periodically removes nginx logs older than 7 days
func (d *Daemon) runLogCleanup(ctx context.Context) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	// Run immediately on start
	if removed, err := nginx.CleanOldLogs(d.cfg.Nginx.LogsDir, 7*24*time.Hour); err != nil {
		d.logger.Warn("log cleanup failed", "error", err)
	} else if removed > 0 {
		d.logger.Info("cleaned old nginx logs", "removed", removed)
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if removed, err := nginx.CleanOldLogs(d.cfg.Nginx.LogsDir, 7*24*time.Hour); err != nil {
				d.logger.Warn("log cleanup failed", "error", err)
			} else if removed > 0 {
				d.logger.Info("cleaned old nginx logs", "removed", removed)
			}
		}
	}
}
