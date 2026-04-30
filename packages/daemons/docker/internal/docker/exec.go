package docker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/moby/moby/client"

	pb "github.com/wiolett-industries/gateway/daemon-shared/gatewayv1"
	"github.com/wiolett-industries/gateway/daemon-shared/stream"
)

const maxBufferChunks = 1000

// ExecSession represents a persistent exec session attached to a container.
type ExecSession struct {
	id          string
	containerID string
	conn        client.HijackedResponse
	cancel      context.CancelFunc
	lastActive  time.Time

	// Ring buffer of recent output (always populated)
	outputBuffer [][]byte
	bufMu        sync.Mutex
}

func (s *ExecSession) bufferOutput(data []byte) {
	s.bufMu.Lock()
	defer s.bufMu.Unlock()
	chunk := make([]byte, len(data))
	copy(chunk, data)
	s.outputBuffer = append(s.outputBuffer, chunk)
	if len(s.outputBuffer) > maxBufferChunks {
		s.outputBuffer = s.outputBuffer[len(s.outputBuffer)-maxBufferChunks:]
	}
}

func (s *ExecSession) getBufferBase64() []string {
	s.bufMu.Lock()
	defer s.bufMu.Unlock()
	result := make([]string, 0, len(s.outputBuffer))
	for _, chunk := range s.outputBuffer {
		result = append(result, base64.StdEncoding.EncodeToString(chunk))
	}
	return result
}

// ExecManager manages persistent exec sessions (one per container).
type ExecManager struct {
	client   *Client
	logger   *slog.Logger
	writer   *stream.Writer
	mu       sync.Mutex
	sessions map[string]*ExecSession // keyed by containerID
}

func NewExecManager(c *Client, writer *stream.Writer, logger *slog.Logger) *ExecManager {
	return &ExecManager{
		client:   c,
		writer:   writer,
		logger:   logger,
		sessions: make(map[string]*ExecSession),
	}
}

// CreateOrReuse returns an existing session or creates a new one.
func (em *ExecManager) CreateOrReuse(ctx context.Context, containerID string, cmd []string, tty bool, rows, cols int, user string) (string, bool, error) {
	em.mu.Lock()
	existing, ok := em.sessions[containerID]
	em.mu.Unlock()

	if ok {
		inspResult, err := em.client.cli.ExecInspect(ctx, existing.id, client.ExecInspectOptions{})
		if err == nil && inspResult.Running {
			existing.lastActive = time.Now()
			em.logger.Info("reusing exec session", "exec_id", existing.id, "container", containerID)
			return existing.id, false, nil
		}
		em.mu.Lock()
		delete(em.sessions, containerID)
		em.mu.Unlock()
		existing.cancel()
		existing.conn.Close()
	}

	if len(cmd) == 0 {
		cmd = []string{"/bin/sh"}
	}

	consoleSize := client.ConsoleSize{}
	if tty && rows > 0 && cols > 0 {
		consoleSize = client.ConsoleSize{Height: uint(rows), Width: uint(cols)}
	}

	createResult, err := em.client.cli.ExecCreate(ctx, containerID, client.ExecCreateOptions{
		Cmd:          cmd,
		TTY:          tty,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		ConsoleSize:  consoleSize,
		User:         user,
	})
	if err != nil {
		return "", false, err
	}

	attachResult, err := em.client.cli.ExecAttach(ctx, createResult.ID, client.ExecAttachOptions{
		TTY:         tty,
		ConsoleSize: consoleSize,
	})
	if err != nil {
		return "", false, err
	}

	sessionCtx, sessionCancel := context.WithCancel(ctx)
	session := &ExecSession{
		id:          createResult.ID,
		containerID: containerID,
		conn:        attachResult.HijackedResponse,
		cancel:      sessionCancel,
		lastActive:  time.Now(),
	}

	em.mu.Lock()
	em.sessions[containerID] = session
	em.mu.Unlock()

	go em.readOutput(sessionCtx, session)

	em.logger.Info("exec session created", "exec_id", createResult.ID, "container", containerID)
	return createResult.ID, true, nil
}

// GetBuffer returns the buffered output as base64-encoded chunks (for sending to a new client).
func (em *ExecManager) GetBuffer(containerID string) []string {
	em.mu.Lock()
	session, ok := em.sessions[containerID]
	em.mu.Unlock()
	if !ok {
		return nil
	}
	return session.getBufferBase64()
}

// HandleInput writes data to an exec session's stdin.
func (em *ExecManager) HandleInput(execID string, data []byte) {
	em.mu.Lock()
	var session *ExecSession
	for _, s := range em.sessions {
		if s.id == execID {
			session = s
			break
		}
	}
	em.mu.Unlock()

	if session == nil {
		return
	}

	session.lastActive = time.Now()
	session.conn.Conn.Write(data)
}

// HandleResize resizes the TTY.
func (em *ExecManager) HandleResize(ctx context.Context, execID string, rows, cols int) error {
	em.mu.Lock()
	var found bool
	for _, s := range em.sessions {
		if s.id == execID {
			s.lastActive = time.Now()
			found = true
			break
		}
	}
	em.mu.Unlock()

	if !found {
		return nil
	}

	_, err := em.client.cli.ExecResize(ctx, execID, client.ExecResizeOptions{
		Height: uint(rows),
		Width:  uint(cols),
	})
	return err
}

// CloseAll closes all sessions (daemon shutdown only).
func (em *ExecManager) CloseAll() {
	em.mu.Lock()
	sessions := em.sessions
	em.sessions = make(map[string]*ExecSession)
	em.mu.Unlock()

	for _, s := range sessions {
		s.cancel()
		s.conn.Close()
	}
}

// readOutput ALWAYS forwards output to gRPC AND buffers it.
// The backend decides which WS clients get it.
func (em *ExecManager) readOutput(ctx context.Context, session *ExecSession) {
	buf := make([]byte, 4096)

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, err := session.conn.Reader.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])

			// Always buffer
			session.bufferOutput(data)

			// Always forward to gRPC — backend routes to connected WS clients
			if em.writer != nil {
				em.writer.Send(&pb.DaemonMessage{
					Payload: &pb.DaemonMessage_ExecOutput{
						ExecOutput: &pb.ExecOutput{
							ExecId: session.id,
							Data:   data,
						},
					},
				})
			}
		}

		if err != nil {
			exitCode := int32(0)
			if r, e := em.client.cli.ExecInspect(context.Background(), session.id, client.ExecInspectOptions{}); e == nil {
				exitCode = int32(r.ExitCode)
			}

			if em.writer != nil {
				em.writer.Send(&pb.DaemonMessage{
					Payload: &pb.DaemonMessage_ExecOutput{
						ExecOutput: &pb.ExecOutput{
							ExecId:   session.id,
							Exited:   true,
							ExitCode: exitCode,
						},
					},
				})
			}

			em.mu.Lock()
			delete(em.sessions, session.containerID)
			em.mu.Unlock()

			em.logger.Info("exec session ended", "exec_id", session.id, "exit_code", exitCode)
			return
		}
	}
}

// GetBufferJSON returns the buffer as a JSON detail string for command results.
func (em *ExecManager) GetBufferJSON(containerID string) string {
	buf := em.GetBuffer(containerID)
	if len(buf) == 0 {
		return ""
	}
	data, _ := json.Marshal(map[string]interface{}{"buffer": buf})
	return string(data)
}
