package daemon

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	pb "github.com/wiolett/gateway/nginx-daemon/internal/gatewayv1"
)

// logForwarder captures slog records and sends them as DaemonLogEntry
// messages on the gRPC command stream when log streaming is enabled.
type logForwarder struct {
	stream pb.NodeControl_CommandStreamClient
	mu     sync.Mutex
}

func newLogForwarder(stream pb.NodeControl_CommandStreamClient) *logForwarder {
	return &logForwarder{stream: stream}
}

// forward sends a log entry if daemon log streaming is enabled and the
// level meets the minimum threshold.
func (lf *logForwarder) forward(level, component, message string, fields map[string]string) {
	if !GetDaemonLogEnabled() {
		return
	}

	if !meetsMinLevel(level, GetDaemonLogMinLevel()) {
		return
	}

	entry := &pb.DaemonLogEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Message:   message,
		Component: component,
		Fields:    fields,
	}

	lf.mu.Lock()
	defer lf.mu.Unlock()

	lf.stream.Send(&pb.DaemonMessage{
		Payload: &pb.DaemonMessage_DaemonLog{DaemonLog: entry},
	})
}

// grpcLogHandler is an slog.Handler that forwards logs to the gRPC stream.
type grpcLogHandler struct {
	forwarder *logForwarder
	inner     slog.Handler
	component string
	attrs     []slog.Attr
}

func newGrpcLogHandler(forwarder *logForwarder, inner slog.Handler) *grpcLogHandler {
	return &grpcLogHandler{
		forwarder: forwarder,
		inner:     inner,
	}
}

func (h *grpcLogHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *grpcLogHandler) Handle(ctx context.Context, r slog.Record) error {
	// Forward to gRPC stream
	level := strings.ToLower(r.Level.String())
	component := h.component
	fields := make(map[string]string)

	// Collect record attributes
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "component" {
			component = a.Value.String()
		} else {
			fields[a.Key] = a.Value.String()
		}
		return true
	})

	// Include pre-set attrs
	for _, a := range h.attrs {
		if a.Key == "component" {
			component = a.Value.String()
		} else {
			fields[a.Key] = a.Value.String()
		}
	}

	h.forwarder.forward(level, component, r.Message, fields)

	// Also pass to the inner handler (console/file logging)
	return h.inner.Handle(ctx, r)
}

func (h *grpcLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newAttrs := make([]slog.Attr, len(h.attrs)+len(attrs))
	copy(newAttrs, h.attrs)
	copy(newAttrs[len(h.attrs):], attrs)
	return &grpcLogHandler{
		forwarder: h.forwarder,
		inner:     h.inner.WithAttrs(attrs),
		component: h.component,
		attrs:     newAttrs,
	}
}

func (h *grpcLogHandler) WithGroup(name string) slog.Handler {
	return &grpcLogHandler{
		forwarder: h.forwarder,
		inner:     h.inner.WithGroup(name),
		component: h.component,
		attrs:     h.attrs,
	}
}

func meetsMinLevel(level, minLevel string) bool {
	levelOrder := map[string]int{
		"debug": 0,
		"info":  1,
		"warn":  2,
		"error": 3,
	}
	l, ok1 := levelOrder[strings.ToLower(level)]
	m, ok2 := levelOrder[strings.ToLower(minLevel)]
	if !ok1 || !ok2 {
		return true // forward unknown levels
	}
	return l >= m
}
