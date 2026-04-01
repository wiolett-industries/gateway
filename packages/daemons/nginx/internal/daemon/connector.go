package daemon

import (
	"context"
	"log/slog"
	"math"
	"math/rand/v2"
	"time"

	"github.com/wiolett/gateway/nginx-daemon/internal/auth"
	pb "github.com/wiolett/gateway/nginx-daemon/internal/gatewayv1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/keepalive"
)

const (
	maxBackoff     = 60 * time.Second
	initialBackoff = 1 * time.Second
)

type Connector struct {
	address    string
	tlsMgr     *auth.TLSManager
	logger     *slog.Logger
}

func NewConnector(address string, tlsMgr *auth.TLSManager, logger *slog.Logger) *Connector {
	return &Connector{
		address: address,
		tlsMgr:  tlsMgr,
		logger:  logger,
	}
}

// Connect establishes a gRPC connection with mTLS. Blocks until connected or ctx cancelled.
func (c *Connector) Connect(ctx context.Context) (*grpc.ClientConn, error) {
	tlsCfg, err := c.tlsMgr.ClientTLSConfig()
	if err != nil {
		return nil, err
	}

	conn, err := grpc.NewClient(c.address,
		grpc.WithTransportCredentials(credentials.NewTLS(tlsCfg)),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                30 * time.Second,
			Timeout:             10 * time.Second,
			PermitWithoutStream: true,
		}),
	)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

// ConnectWithRetry retries connection with exponential backoff + jitter.
func (c *Connector) ConnectWithRetry(ctx context.Context) (*grpc.ClientConn, error) {
	backoff := initialBackoff
	for {
		conn, err := c.Connect(ctx)
		if err == nil {
			return conn, nil
		}

		c.logger.Warn("connection failed, retrying",
			"error", err,
			"backoff", backoff,
		)

		// Add jitter: 0.5x to 1.5x
		jitter := time.Duration(float64(backoff) * (0.5 + rand.Float64()))
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(jitter):
		}

		backoff = time.Duration(math.Min(float64(backoff)*2, float64(maxBackoff)))
	}
}

// OpenCommandStream opens the bidirectional CommandStream RPC.
func OpenCommandStream(ctx context.Context, conn *grpc.ClientConn) (pb.NodeControl_CommandStreamClient, error) {
	client := pb.NewNodeControlClient(conn)
	return client.CommandStream(ctx)
}

// OpenLogStream opens the bidirectional LogStream RPC.
func OpenLogStream(ctx context.Context, conn *grpc.ClientConn) (pb.LogStream_StreamLogsClient, error) {
	client := pb.NewLogStreamClient(conn)
	return client.StreamLogs(ctx)
}
