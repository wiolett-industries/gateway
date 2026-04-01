package nginx

import (
	"os"
	"path/filepath"
	"time"
)

// CleanOldLogs removes log files older than maxAge from the logs directory.
func CleanOldLogs(logsDir string, maxAge time.Duration) (int, error) {
	entries, err := os.ReadDir(logsDir)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}

	cutoff := time.Now().Add(-maxAge)
	removed := 0

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		// Only clean .log files and rotated/compressed variants
		ext := filepath.Ext(e.Name())
		if ext != ".log" && ext != ".gz" && ext != ".old" {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(logsDir, e.Name())); err == nil {
				removed++
			}
		}
	}

	return removed, nil
}
