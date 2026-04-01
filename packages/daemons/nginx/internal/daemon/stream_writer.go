package daemon

import (
	"sync"

	pb "github.com/wiolett/gateway/nginx-daemon/internal/gatewayv1"
)

// streamWriter serializes concurrent Send calls on a gRPC client stream.
type streamWriter struct {
	stream pb.NodeControl_CommandStreamClient
	mu     sync.Mutex
}

func newStreamWriter(stream pb.NodeControl_CommandStreamClient) *streamWriter {
	return &streamWriter{stream: stream}
}

func (w *streamWriter) Send(msg *pb.DaemonMessage) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stream.Send(msg)
}

// logStreamWriter serializes concurrent Send calls on a LogStream client.
type logStreamWriter struct {
	stream pb.LogStream_StreamLogsClient
	mu     sync.Mutex
}

func newLogStreamWriter(stream pb.LogStream_StreamLogsClient) *logStreamWriter {
	return &logStreamWriter{stream: stream}
}

func (w *logStreamWriter) Send(msg *pb.LogStreamMessage) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.stream.Send(msg)
}

func (w *logStreamWriter) Recv() (*pb.LogStreamControl, error) {
	return w.stream.Recv()
}
