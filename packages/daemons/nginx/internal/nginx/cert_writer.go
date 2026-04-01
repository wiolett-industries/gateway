package nginx

import (
	"fmt"
	"os"
	"path/filepath"
)

// DeployCert writes cert, key, and optional chain to the cert directory.
func DeployCert(certsDir, certID string, certPem, keyPem, chainPem []byte) error {
	dir := filepath.Join(certsDir, certID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create cert dir: %w", err)
	}

	if err := WriteAtomic(filepath.Join(dir, "fullchain.pem"), certPem); err != nil {
		return fmt.Errorf("write cert: %w", err)
	}

	if err := WriteAtomic(filepath.Join(dir, "privkey.pem"), keyPem); err != nil {
		return fmt.Errorf("write key: %w", err)
	}

	// Set restrictive permissions on private key
	if err := os.Chmod(filepath.Join(dir, "privkey.pem"), 0600); err != nil {
		return fmt.Errorf("chmod key: %w", err)
	}

	if len(chainPem) > 0 {
		if err := WriteAtomic(filepath.Join(dir, "chain.pem"), chainPem); err != nil {
			return fmt.Errorf("write chain: %w", err)
		}
	}

	return nil
}

// RemoveCert removes a certificate directory.
func RemoveCert(certsDir, certID string) error {
	return RemoveDir(filepath.Join(certsDir, certID))
}
