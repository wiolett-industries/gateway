package lifecycle

import (
	"context"
	"log/slog"

	pb "github.com/wiolett/gateway/daemon-shared/gatewayv1"
)

// DaemonPlugin defines the interface that daemon-specific logic must implement.
// The lifecycle manager calls these methods at appropriate points in the
// enrollment, connection, and session lifecycle.
type DaemonPlugin interface {
	// Type returns the daemon type string (e.g., "nginx", "monitoring").
	Type() string

	// Init is called once at startup to initialize plugin-specific resources.
	Init(cfg *BaseConfig, logger *slog.Logger) error

	// BuildRegisterMessage constructs the registration message sent to the
	// gateway when a new session begins.
	BuildRegisterMessage(nodeID string) *pb.RegisterMessage

	// HandleCommand processes a gateway command and returns a result.
	HandleCommand(cmd *pb.GatewayCommand) *pb.CommandResult

	// CollectHealth enriches a base health report with plugin-specific metrics.
	// The base report already contains system-level metrics.
	CollectHealth(base *pb.HealthReport) *pb.HealthReport

	// CollectStats returns plugin-specific statistics, or nil if not applicable.
	CollectStats() *pb.StatsReport

	// OnSessionStart is called when a new gRPC session is established.
	// Plugins can use this to start background tasks tied to the session.
	OnSessionStart(ctx context.Context) error

	// OnSessionEnd is called when a gRPC session ends (before reconnect).
	// Plugins should clean up session-specific resources.
	OnSessionEnd()
}
