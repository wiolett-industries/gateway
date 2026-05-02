package lifecycle

import (
	"io"
	"log/slog"
	"testing"
)

func TestSelfUpdateRejectsMissingChecksum(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	err := SelfUpdate("https://gitlab.wiolett.net/update", "v9.9.9", "", "manifest", "nginx", logger)
	if err == nil {
		t.Fatal("expected missing checksum to be rejected")
	}
}

func TestSelfUpdateRejectsMissingSignedManifest(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	err := SelfUpdate(
		"https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway/packages/generic/nginx-daemon/v9.9.9-nginx/nginx-daemon-linux-amd64",
		"v9.9.9",
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		"",
		"nginx",
		logger,
	)
	if err == nil {
		t.Fatal("expected missing signed manifest to be rejected")
	}
}
