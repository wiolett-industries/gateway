package lifecycle

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// SelfUpdate downloads a new binary from downloadURL, verifies its checksum,
// replaces the current binary, and triggers a restart via systemd.
func SelfUpdate(downloadURL, targetVersion, expectedChecksum string, logger *slog.Logger) error {
	logger.Info("starting self-update",
		"target_version", targetVersion,
		"download_url", downloadURL,
		"arch", runtime.GOARCH,
	)

	// Get current binary path
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable path: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("resolve symlinks: %w", err)
	}

	// Download to temp file in the same directory (for atomic rename)
	tmpFile, err := os.CreateTemp(filepath.Dir(execPath), ".daemon-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		tmpFile.Close()
		os.Remove(tmpPath) // cleanup on failure; on success we already renamed
	}()

	// Download binary
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned status %d", resp.StatusCode)
	}

	// Write + compute checksum simultaneously
	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)
	if _, err := io.Copy(writer, resp.Body); err != nil {
		return fmt.Errorf("write binary: %w", err)
	}
	tmpFile.Close()

	// Verify checksum
	actualChecksum := hex.EncodeToString(hasher.Sum(nil))
	if expectedChecksum != "" && actualChecksum != expectedChecksum {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedChecksum, actualChecksum)
	}

	// Make executable
	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Atomic replace: rename temp file over the current binary
	if err := os.Rename(tmpPath, execPath); err != nil {
		return fmt.Errorf("replace binary: %w", err)
	}

	logger.Info("binary replaced successfully, restarting",
		"target_version", targetVersion,
		"path", execPath,
	)

	// Trigger restart — daemon exits, systemd restarts it with the new binary
	go func() {
		time.Sleep(1 * time.Second)
		// Try systemd restart first
		if err := exec.Command("systemctl", "restart", filepath.Base(execPath)).Run(); err != nil {
			logger.Warn("systemctl restart failed, exiting for supervisor restart", "error", err)
			os.Exit(0)
		}
	}()

	return nil
}
