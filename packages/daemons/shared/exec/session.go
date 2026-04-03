package exec

import (
	"encoding/base64"
	"sync"
	"time"
)

const maxBufferChunks = 1000

// Session represents a persistent exec session attached to any process.
type Session struct {
	ID         string
	Key        string // lookup key (e.g. "node-console")
	stdin      writeCloser
	cancel     func()
	lastActive time.Time
	onExit     func() int32 // exit code provider
	resizeFn   func(rows, cols int) error

	// Ring buffer of recent output
	buffer [][]byte
	bufMu  sync.Mutex
}

// writeCloser is a minimal interface for writing to a session's stdin.
type writeCloser interface {
	Write(p []byte) (n int, err error)
	Close() error
}

func (s *Session) bufferOutput(data []byte) {
	s.bufMu.Lock()
	defer s.bufMu.Unlock()
	chunk := make([]byte, len(data))
	copy(chunk, data)
	s.buffer = append(s.buffer, chunk)
	if len(s.buffer) > maxBufferChunks {
		s.buffer = s.buffer[len(s.buffer)-maxBufferChunks:]
	}
}

func (s *Session) getBufferBase64() []string {
	s.bufMu.Lock()
	defer s.bufMu.Unlock()
	result := make([]string, 0, len(s.buffer))
	for _, chunk := range s.buffer {
		result = append(result, base64.StdEncoding.EncodeToString(chunk))
	}
	return result
}

func (s *Session) touch() {
	s.lastActive = time.Now()
}
