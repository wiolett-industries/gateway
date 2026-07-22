package docker

import (
	"bytes"
	"context"
	"encoding/base64"
	"testing"
	"time"
)

func TestExecSessionBufferOutputCapsBytes(t *testing.T) {
	session := &ExecSession{}
	chunk := bytes.Repeat([]byte("a"), maxBufferBytes/2+1)

	session.bufferOutput(chunk)
	session.bufferOutput(chunk)
	session.bufferOutput(chunk)

	if session.outputBufferBytes > maxBufferBytes {
		t.Fatalf("buffer bytes = %d, want <= %d", session.outputBufferBytes, maxBufferBytes)
	}
	if len(session.outputBuffer) == 0 {
		t.Fatal("buffer unexpectedly empty")
	}

	var decodedBytes int
	for _, encoded := range session.getBufferBase64() {
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			t.Fatalf("decode buffer chunk: %v", err)
		}
		decodedBytes += len(decoded)
	}
	if decodedBytes != session.outputBufferBytes {
		t.Fatalf("decoded bytes = %d, tracked bytes = %d", decodedBytes, session.outputBufferBytes)
	}
}

func TestExecSessionBufferOutputCapsChunks(t *testing.T) {
	session := &ExecSession{}

	for i := 0; i < maxBufferChunks+10; i++ {
		session.bufferOutput([]byte("x"))
	}

	if len(session.outputBuffer) != maxBufferChunks {
		t.Fatalf("buffer chunks = %d, want %d", len(session.outputBuffer), maxBufferChunks)
	}
	if session.outputBufferBytes != maxBufferChunks {
		t.Fatalf("buffer bytes = %d, want %d", session.outputBufferBytes, maxBufferChunks)
	}
}

func TestExecSessionWaitForFirstOutputReturnsAfterBufferedData(t *testing.T) {
	session := &ExecSession{firstOutput: make(chan struct{})}
	session.bufferOutput([]byte("/ # "))

	started := time.Now()
	session.waitForFirstOutput(context.Background())
	if elapsed := time.Since(started); elapsed >= initialOutputWait {
		t.Fatalf("waitForFirstOutput took %s after output was already buffered", elapsed)
	}
}

func TestExecManagerBuffersAreScopedByGatewayUser(t *testing.T) {
	containerID := "container-1"
	userOne := &ExecSession{}
	userOne.bufferOutput([]byte("user-one"))
	userTwo := &ExecSession{}
	userTwo.bufferOutput([]byte("user-two"))

	manager := &ExecManager{sessions: map[string]*ExecSession{
		dockerExecSessionKey(containerID, "user-1"): userOne,
		dockerExecSessionKey(containerID, "user-2"): userTwo,
	}}

	first := manager.GetBuffer(containerID, "user-1")
	second := manager.GetBuffer(containerID, "user-2")
	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("unexpected buffer lengths: first=%d second=%d", len(first), len(second))
	}
	if first[0] == second[0] {
		t.Fatal("different Gateway users resolved to the same Docker exec buffer")
	}
}

func TestDockerExecSessionKeyKeepsLegacyFallback(t *testing.T) {
	if got := dockerExecSessionKey("container-1", ""); got != "container-1" {
		t.Fatalf("legacy session key = %q, want container-1", got)
	}
}
