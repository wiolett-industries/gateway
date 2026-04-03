package lifecycle

import (
	"context"
	"io"
	"log/slog"
	"time"

	"github.com/wiolett/gateway/daemon-shared/connector"
	pb "github.com/wiolett/gateway/daemon-shared/gatewayv1"
	"github.com/wiolett/gateway/daemon-shared/stream"
	"github.com/wiolett/gateway/daemon-shared/sysmetrics"
	"google.golang.org/grpc"
)

// runSession connects to the gateway, registers, and runs the command loop.
func runSession(ctx context.Context, conn *grpc.ClientConn, d *DaemonBase) error {
	// Enable log streaming by default — backend can disable via SetDaemonLogStream command
	stream.SetDaemonLogStreaming(true, "info")

	cmdStream, err := connector.OpenCommandStream(ctx, conn)
	if err != nil {
		return err
	}

	// Wrap stream for thread-safe Send calls
	writer := stream.NewWriter(cmdStream)

	// Send registration message
	regMsg := d.plugin.BuildRegisterMessage(d.state.NodeID)
	if err := writer.Send(&pb.DaemonMessage{
		Payload: &pb.DaemonMessage_Register{Register: regMsg},
	}); err != nil {
		return err
	}

	d.logger.Info("connected to gateway", "node_id", d.state.NodeID)

	// Install gRPC log forwarder so daemon logs are streamed to the gateway
	sessionLogger := slog.New(stream.NewGrpcLogHandlerWithWriter(writer, d.baseHandler))
	d.logger = sessionLogger
	// Update plugin's logger so its logs also forward to gRPC
	d.plugin.SetLogger(sessionLogger)

	// Notify plugin of session start
	sessionCtx, sessionCancel := context.WithCancel(ctx)
	defer sessionCancel()

	if err := d.plugin.OnSessionStart(sessionCtx, writer); err != nil {
		d.logger.Warn("plugin session start failed", "error", err)
	}
	defer d.plugin.OnSessionEnd()

	// Start health reporter in background
	go runHealthReporter(sessionCtx, d, writer)

	// Main command loop
	for {
		cmd, err := cmdStream.Recv()
		if err == io.EOF {
			return err
		}
		if err != nil {
			return err
		}

		// Check for registration rejection (fatal — daemon must exit)
		if cmd.CommandId == "__registration_rejected__" {
			if ac, ok := cmd.Payload.(*pb.GatewayCommand_ApplyConfig); ok && ac.ApplyConfig != nil {
				return &FatalError{Message: ac.ApplyConfig.ConfigContent}
			}
			return &FatalError{Message: "registration rejected by gateway"}
		}

		// Handle RequestHealth and RequestStats inline
		switch cmd.Payload.(type) {
		case *pb.GatewayCommand_RequestHealth:
			report := collectFullHealth(d)
			writer.Send(&pb.DaemonMessage{
				Payload: &pb.DaemonMessage_HealthReport{HealthReport: report},
			})
			continue
		case *pb.GatewayCommand_RequestStats:
			report := d.plugin.CollectStats()
			if report != nil {
				writer.Send(&pb.DaemonMessage{
					Payload: &pb.DaemonMessage_StatsReport{StatsReport: report},
				})
			}
			continue
		case *pb.GatewayCommand_ExecInput:
			// Fire-and-forget: route exec input to the plugin without sending a CommandResult
			d.plugin.HandleCommand(cmd)
			continue
		}

		// Process command and send result
		result := d.plugin.HandleCommand(cmd)
		if err := writer.Send(&pb.DaemonMessage{
			Payload: &pb.DaemonMessage_CommandResult{CommandResult: result},
		}); err != nil {
			return err
		}
	}
}

// runHealthReporter periodically sends health reports to the gateway.
func runHealthReporter(ctx context.Context, d *DaemonBase, writer *stream.Writer) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			report := collectFullHealth(d)
			if err := writer.Send(&pb.DaemonMessage{
				Payload: &pb.DaemonMessage_HealthReport{HealthReport: report},
			}); err != nil {
				d.logger.Debug("failed to send health report", "error", err)
				return
			}
		}
	}
}

// collectFullHealth gathers system metrics and enriches them with plugin-specific data.
func collectFullHealth(d *DaemonBase) *pb.HealthReport {
	report := d.sysReporter.CollectSystemHealth(nil)
	return d.plugin.CollectHealth(report)
}

// runCertRenewal checks cert expiry daily and renews when within 7 days.
func runCertRenewal(ctx context.Context, d *DaemonBase) {
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

		if err := d.saveCertificates(nil, resp.ClientCertificate, resp.ClientKey); err != nil {
			d.logger.Warn("cert renewal: save failed", "error", err)
			return
		}

		// Hot-swap the TLS credentials
		if err := d.connector.TLSMgr.LoadCredentials(); err != nil {
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

// newSystemReporter creates a new system metrics reporter.
func newSystemReporter() *sysmetrics.SystemReporter {
	return sysmetrics.NewSystemReporter()
}
