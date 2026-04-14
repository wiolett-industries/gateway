package lifecycle

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
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
		logger.Error("self-update failed to resolve executable path", "error", err)
		return fmt.Errorf("resolve executable path: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		logger.Error("self-update failed to resolve executable symlink", "error", err)
		return fmt.Errorf("resolve symlinks: %w", err)
	}

	// Download to temp file in the same directory (for atomic rename)
	tmpFile, err := os.CreateTemp(filepath.Dir(execPath), ".daemon-update-*")
	if err != nil {
		logger.Error("self-update failed to create temp file", "error", err)
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		tmpFile.Close()
		os.Remove(tmpPath) // cleanup on failure; on success we already renamed
	}()

	// Download binary
	client := &http.Client{Timeout: 5 * time.Minute}
	logger.Info("downloading daemon update", "target_version", targetVersion)
	resp, err := client.Get(downloadURL)
	if err != nil {
		logger.Error("self-update download failed", "error", err)
		return fmt.Errorf("download binary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.Error("self-update download returned unexpected status", "status", resp.StatusCode)
		return fmt.Errorf("download returned status %d", resp.StatusCode)
	}

	// Write + compute checksum simultaneously
	hasher := sha256.New()
	writer := io.MultiWriter(tmpFile, hasher)
	if _, err := io.Copy(writer, resp.Body); err != nil {
		logger.Error("self-update failed while writing downloaded binary", "error", err)
		return fmt.Errorf("write binary: %w", err)
	}
	tmpFile.Close()
	logger.Info("daemon update downloaded", "target_version", targetVersion)

	// Verify checksum
	actualChecksum := hex.EncodeToString(hasher.Sum(nil))
	if expectedChecksum != "" && actualChecksum != expectedChecksum {
		logger.Error("self-update checksum mismatch", "expected", expectedChecksum, "actual", actualChecksum)
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedChecksum, actualChecksum)
	}
	if expectedChecksum == "" {
		logger.Warn("self-update proceeding without checksum verification")
	} else {
		logger.Info("self-update checksum verified", "checksum", actualChecksum)
	}

	// Make executable
	if err := os.Chmod(tmpPath, 0755); err != nil {
		logger.Error("self-update failed to chmod new binary", "error", err)
		return fmt.Errorf("chmod: %w", err)
	}

	// Atomic replace: rename temp file over the current binary
	if err := os.Rename(tmpPath, execPath); err != nil {
		logger.Error("self-update failed to replace binary", "error", err, "path", execPath)
		return fmt.Errorf("replace binary: %w", err)
	}

	logger.Info("binary replaced successfully",
		"target_version", targetVersion,
		"path", execPath,
	)

	return nil
}
