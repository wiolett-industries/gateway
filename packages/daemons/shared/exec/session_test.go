package exec

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestSessionBufferOutputCapsBytes(t *testing.T) {
	session := &Session{}
	chunk := bytes.Repeat([]byte("a"), maxBufferBytes/2+1)

	session.bufferOutput(chunk)
	session.bufferOutput(chunk)
	session.bufferOutput(chunk)

	if session.bufferBytes > maxBufferBytes {
		t.Fatalf("buffer bytes = %d, want <= %d", session.bufferBytes, maxBufferBytes)
	}
	if len(session.buffer) == 0 {
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
	if decodedBytes != session.bufferBytes {
		t.Fatalf("decoded bytes = %d, tracked bytes = %d", decodedBytes, session.bufferBytes)
	}
}

func TestSessionBufferOutputCapsChunks(t *testing.T) {
	session := &Session{}

	for i := 0; i < maxBufferChunks+10; i++ {
		session.bufferOutput([]byte("x"))
	}

	if len(session.buffer) != maxBufferChunks {
		t.Fatalf("buffer chunks = %d, want %d", len(session.buffer), maxBufferChunks)
	}
	if session.bufferBytes != maxBufferChunks {
		t.Fatalf("buffer bytes = %d, want %d", session.bufferBytes, maxBufferChunks)
	}
}
