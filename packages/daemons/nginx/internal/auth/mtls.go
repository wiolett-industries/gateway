package auth

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"sync"
)

// TLSManager manages mTLS credentials with hot-swap support.
type TLSManager struct {
	caCertPath     string
	clientCertPath string
	clientKeyPath  string

	mu   sync.RWMutex
	cert *tls.Certificate
}

func NewTLSManager(caCertPath, clientCertPath, clientKeyPath string) *TLSManager {
	return &TLSManager{
		caCertPath:     caCertPath,
		clientCertPath: clientCertPath,
		clientKeyPath:  clientKeyPath,
	}
}

// LoadCredentials loads the client certificate and key from disk.
func (t *TLSManager) LoadCredentials() error {
	cert, err := tls.LoadX509KeyPair(t.clientCertPath, t.clientKeyPath)
	if err != nil {
		return fmt.Errorf("load client cert: %w", err)
	}
	t.mu.Lock()
	t.cert = &cert
	t.mu.Unlock()
	return nil
}

// GetClientCertificate is the callback for tls.Config.GetClientCertificate.
// This enables hot-swapping certs without reconnecting.
func (t *TLSManager) GetClientCertificate(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if t.cert == nil {
		return nil, fmt.Errorf("no client certificate loaded")
	}
	return t.cert, nil
}

// ClientTLSConfig builds a tls.Config for mTLS connections.
func (t *TLSManager) ClientTLSConfig() (*tls.Config, error) {
	caCert, err := os.ReadFile(t.caCertPath)
	if err != nil {
		return nil, fmt.Errorf("read CA cert: %w", err)
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caCert) {
		return nil, fmt.Errorf("failed to parse CA certificate")
	}

	if err := t.LoadCredentials(); err != nil {
		return nil, err
	}

	return &tls.Config{
		RootCAs:              caPool,
		GetClientCertificate: t.GetClientCertificate,
	}, nil
}

// SaveCredentials writes CA cert, client cert, and key to disk.
func SaveCredentials(caCertPath, clientCertPath, clientKeyPath string, caCert, clientCert, clientKey []byte) error {
	for _, dir := range []string{
		caCertPath, clientCertPath, clientKeyPath,
	} {
		if err := os.MkdirAll(dirOf(dir), 0700); err != nil {
			return err
		}
	}

	// Validate that cert and key are non-empty to avoid writing broken credentials
	if len(clientCert) == 0 {
		return fmt.Errorf("client certificate is empty")
	}
	if len(clientKey) == 0 {
		return fmt.Errorf("client key is empty")
	}

	if caCert != nil {
		if err := os.WriteFile(caCertPath, caCert, 0644); err != nil {
			return fmt.Errorf("write CA cert: %w", err)
		}
	}
	if err := os.WriteFile(clientCertPath, clientCert, 0644); err != nil {
		return fmt.Errorf("write client cert: %w", err)
	}
	if err := os.WriteFile(clientKeyPath, clientKey, 0600); err != nil {
		return fmt.Errorf("write client key: %w", err)
	}
	return nil
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return "."
}
