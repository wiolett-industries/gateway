package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type State struct {
	NodeID            string   `json:"node_id"`
	ConfigVersionHash string   `json:"config_version_hash"`
	ActiveHostIDs     []string `json:"active_host_ids"`
	Enrolled          bool     `json:"enrolled"`
	CertExpiresAt     int64    `json:"cert_expires_at"` // Unix timestamp

	mu   sync.RWMutex
	path string
}

func Load(stateDir string) (*State, error) {
	if err := os.MkdirAll(stateDir, 0755); err != nil {
		return nil, fmt.Errorf("create state dir: %w", err)
	}

	path := filepath.Join(stateDir, "state.json")
	s := &State{path: path}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read state: %w", err)
	}

	if err := json.Unmarshal(data, s); err != nil {
		return nil, fmt.Errorf("parse state: %w", err)
	}

	return s, nil
}

func (s *State) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}

	tmpPath := s.path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("write state: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename state: %w", err)
	}
	return nil
}

func (s *State) SetConfigVersion(hash string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ConfigVersionHash = hash
}

func (s *State) GetConfigVersion() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ConfigVersionHash
}

func (s *State) SetActiveHosts(ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ActiveHostIDs = ids
}

func (s *State) SetEnrolled(nodeID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.NodeID = nodeID
	s.Enrolled = true
}

func (s *State) SetCertExpiry(expiresAt int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.CertExpiresAt = expiresAt
}

func (s *State) GetCertExpiry() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.CertExpiresAt
}
