package daemon

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	pb "github.com/wiolett-industries/gateway/daemon-shared/gatewayv1"
	sharedstate "github.com/wiolett-industries/gateway/daemon-shared/state"
	"github.com/wiolett-industries/gateway/daemon-shared/stream"
	"github.com/wiolett-industries/gateway/nginx-daemon/internal/config"
	"github.com/wiolett-industries/gateway/nginx-daemon/internal/nginx"
)

// acmeTokenRegex validates ACME challenge tokens (alphanumeric + dash + underscore).
var acmeTokenRegex = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// uuidRegex validates UUID-format strings.
var uuidRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isValidUUID checks if a string is a valid UUID format.
func isValidUUID(s string) bool {
	return uuidRegex.MatchString(s)
}

type Handler struct {
	cfg    *config.Config
	mgr    *nginx.Manager
	state  *sharedstate.State
	logger *slog.Logger
}

func NewHandler(cfg *config.Config, mgr *nginx.Manager, st *sharedstate.State, logger *slog.Logger) *Handler {
	return &Handler{cfg: cfg, mgr: mgr, state: st, logger: logger}
}

// HandleCommand processes a GatewayCommand and returns a CommandResult.
func (h *Handler) HandleCommand(cmd *pb.GatewayCommand) *pb.CommandResult {
	result := &pb.CommandResult{CommandId: cmd.CommandId, Success: true}

	switch payload := cmd.Payload.(type) {
	case *pb.GatewayCommand_ApplyConfig:
		h.handleApplyConfig(payload.ApplyConfig, result)
	case *pb.GatewayCommand_RemoveConfig:
		h.handleRemoveConfig(payload.RemoveConfig, result)
	case *pb.GatewayCommand_DeployCert:
		h.handleDeployCert(payload.DeployCert, result)
	case *pb.GatewayCommand_RemoveCert:
		h.handleRemoveCert(payload.RemoveCert, result)
	case *pb.GatewayCommand_FullSync:
		h.handleFullSync(payload.FullSync, result)
	case *pb.GatewayCommand_UpdateGlobalConfig:
		h.handleUpdateGlobalConfig(payload.UpdateGlobalConfig, result)
	case *pb.GatewayCommand_DeployHtpasswd:
		h.handleDeployHtpasswd(payload.DeployHtpasswd, result)
	case *pb.GatewayCommand_RemoveHtpasswd:
		h.handleRemoveHtpasswd(payload.RemoveHtpasswd, result)
	case *pb.GatewayCommand_TestConfig:
		h.handleTestConfig(result)
	case *pb.GatewayCommand_DeployAcmeChallenge:
		h.handleDeployAcmeChallenge(payload.DeployAcmeChallenge, result)
	case *pb.GatewayCommand_RemoveAcmeChallenge:
		h.handleRemoveAcmeChallenge(payload.RemoveAcmeChallenge, result)
	case *pb.GatewayCommand_SetDaemonLogStream:
		h.handleSetDaemonLogStream(payload.SetDaemonLogStream, result)
	case *pb.GatewayCommand_ReadGlobalConfig:
		h.handleReadGlobalConfig(result)
	case *pb.GatewayCommand_RequestTrafficStats:
		h.handleRequestTrafficStats(payload.RequestTrafficStats, result)
	default:
		result.Success = false
		result.Error = "unknown command type"
	}

	return result
}

func (h *Handler) handleApplyConfig(cmd *pb.ApplyConfigCommand, result *pb.CommandResult) {
	path := h.mgr.ConfigPath(cmd.HostId)

	// Read old config for rollback
	oldConfig, _ := nginx.ReadFile(path)

	if err := nginx.WriteAtomic(path, []byte(cmd.ConfigContent)); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("write config: %v", err)
		return
	}

	valid, output := h.mgr.TestConfig()
	result.Detail = output

	if !valid {
		// Rollback
		if oldConfig != nil {
			nginx.WriteAtomic(path, oldConfig)
		} else {
			nginx.RemoveFile(path)
		}
		result.Success = false
		result.Error = fmt.Sprintf("nginx config test failed: %s", output)
		return
	}

	if cmd.TestOnly {
		// Test passed, don't reload. Restore old config.
		if oldConfig != nil {
			nginx.WriteAtomic(path, oldConfig)
		} else {
			nginx.RemoveFile(path)
		}
		return
	}

	if err := h.mgr.Reload(); err != nil {
		// Config tested OK but reload failed — leave config in place
		result.Success = false
		result.Error = fmt.Sprintf("nginx reload failed: %v", err)
		return
	}

	h.logger.Info("config applied", "host_id", cmd.HostId)
}

func (h *Handler) handleRemoveConfig(cmd *pb.RemoveConfigCommand, result *pb.CommandResult) {
	path := h.mgr.ConfigPath(cmd.HostId)
	if err := nginx.RemoveFile(path); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("remove config: %v", err)
		return
	}

	// Clean up cache directory
	cacheDir := fmt.Sprintf("/tmp/nginx-cache-%s", cmd.HostId)
	nginx.RemoveDir(cacheDir)

	valid, output := h.mgr.TestConfig()
	result.Detail = output
	if !valid {
		result.Success = false
		result.Error = fmt.Sprintf("nginx config test failed after removal: %s", output)
		return
	}

	if err := h.mgr.Reload(); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("nginx reload failed: %v", err)
		return
	}

	h.logger.Info("config removed", "host_id", cmd.HostId)
}

func (h *Handler) handleDeployCert(cmd *pb.DeployCertCommand, result *pb.CommandResult) {
	if err := nginx.DeployCert(h.cfg.Nginx.CertsDir, cmd.CertId, cmd.CertPem, cmd.KeyPem, cmd.ChainPem); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("deploy cert: %v", err)
		return
	}
	h.logger.Info("cert deployed", "cert_id", cmd.CertId)
}

func (h *Handler) handleRemoveCert(cmd *pb.RemoveCertCommand, result *pb.CommandResult) {
	if err := nginx.RemoveCert(h.cfg.Nginx.CertsDir, cmd.CertId); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("remove cert: %v", err)
		return
	}
	h.logger.Info("cert removed", "cert_id", cmd.CertId)
}

func (h *Handler) handleFullSync(cmd *pb.FullSyncCommand, result *pb.CommandResult) {
	h.logger.Info("starting full sync", "hosts", len(cmd.Hosts), "certs", len(cmd.Certs))

	// Snapshot existing configs for rollback
	preExistingConfigs := make(map[string][]byte)
	existingFiles, _ := nginx.ListConfigs(h.cfg.Nginx.ConfigDir)
	for _, name := range existingFiles {
		data, _ := nginx.ReadFile(filepath.Join(h.cfg.Nginx.ConfigDir, name))
		if data != nil {
			preExistingConfigs[name] = data
		}
	}

	// Track deployed items for rollback
	var deployedCerts []string
	var deployedHtpasswd []string
	deletedStaleConfigs := make(map[string][]byte)

	rollback := func() {
		// Restore original configs
		for name, data := range preExistingConfigs {
			nginx.WriteAtomic(filepath.Join(h.cfg.Nginx.ConfigDir, name), data)
		}
		// Restore configs that were deleted as stale in Phase 5
		for name, data := range deletedStaleConfigs {
			nginx.WriteAtomic(filepath.Join(h.cfg.Nginx.ConfigDir, name), data)
		}
		// Remove newly deployed certs
		for _, certId := range deployedCerts {
			nginx.RemoveCert(h.cfg.Nginx.CertsDir, certId)
		}
		// Remove newly deployed htpasswd
		for _, alId := range deployedHtpasswd {
			nginx.RemoveFile(filepath.Join(h.cfg.Nginx.HtpasswdDir, fmt.Sprintf("access-list-%s", alId)))
		}
	}

	// Phase 1: Deploy certs
	for _, cert := range cmd.Certs {
		if err := nginx.DeployCert(h.cfg.Nginx.CertsDir, cert.CertId, cert.CertPem, cert.KeyPem, cert.ChainPem); err != nil {
			rollback()
			result.Success = false
			result.Error = fmt.Sprintf("deploy cert %s: %v", cert.CertId, err)
			return
		}
		deployedCerts = append(deployedCerts, cert.CertId)
	}

	// Phase 2: Deploy htpasswd files
	for _, hp := range cmd.HtpasswdFiles {
		path := filepath.Join(h.cfg.Nginx.HtpasswdDir, fmt.Sprintf("access-list-%s", hp.AccessListId))
		if err := nginx.WriteAtomic(path, []byte(hp.Content)); err != nil {
			rollback()
			result.Success = false
			result.Error = fmt.Sprintf("deploy htpasswd %s: %v", hp.AccessListId, err)
			return
		}
		deployedHtpasswd = append(deployedHtpasswd, hp.AccessListId)
	}

	// Phase 3: Write all host configs
	activeHosts := make(map[string]bool)
	for _, host := range cmd.Hosts {
		path := h.mgr.ConfigPath(host.HostId)
		if err := nginx.WriteAtomic(path, []byte(host.ConfigContent)); err != nil {
			rollback()
			result.Success = false
			result.Error = fmt.Sprintf("write config %s: %v", host.HostId, err)
			return
		}
		activeHosts[fmt.Sprintf("proxy-host-%s.conf", host.HostId)] = true
	}

	// Phase 4: Update global config if provided
	if cmd.GlobalConfig != "" {
		if err := nginx.WriteAtomic(h.cfg.Nginx.GlobalConfig, []byte(cmd.GlobalConfig)); err != nil {
			rollback()
			result.Success = false
			result.Error = fmt.Sprintf("write global config: %v", err)
			return
		}
	}

	// Phase 5: Remove stale configs (save content for potential rollback)
	existing, _ := nginx.ListConfigs(h.cfg.Nginx.ConfigDir)
	for _, name := range existing {
		if !activeHosts[name] && strings.HasPrefix(name, "proxy-host-") {
			if data, ok := preExistingConfigs[name]; ok {
				deletedStaleConfigs[name] = data
			}
			os.Remove(filepath.Join(h.cfg.Nginx.ConfigDir, name))
		}
	}

	// Phase 6: Test and reload
	valid, output := h.mgr.TestConfig()
	result.Detail = output
	if !valid {
		rollback()
		result.Success = false
		result.Error = fmt.Sprintf("nginx config test failed: %s", output)
		return
	}

	if err := h.mgr.Reload(); err != nil {
		rollback()
		result.Success = false
		result.Error = fmt.Sprintf("nginx reload failed: %v", err)
		return
	}

	// Update state
	hostIDs := make([]string, 0, len(cmd.Hosts))
	for _, host := range cmd.Hosts {
		hostIDs = append(hostIDs, host.HostId)
	}
	h.state.SetExtra("active_host_ids", hostIDs)
	h.state.SetExtra("config_version_hash", cmd.VersionHash)
	h.state.Save()

	h.logger.Info("full sync complete", "version_hash", cmd.VersionHash)
}

func (h *Handler) handleUpdateGlobalConfig(cmd *pb.UpdateGlobalConfigCommand, result *pb.CommandResult) {
	// Backup current config
	backup, _ := nginx.ReadFile(h.cfg.Nginx.GlobalConfig)

	if err := nginx.WriteAtomic(h.cfg.Nginx.GlobalConfig, []byte(cmd.Content)); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("write global config: %v", err)
		return
	}

	valid, output := h.mgr.TestConfig()
	result.Detail = output
	if !valid {
		// Rollback
		if backup != nil {
			nginx.WriteAtomic(h.cfg.Nginx.GlobalConfig, backup)
		}
		result.Success = false
		result.Error = fmt.Sprintf("nginx config test failed: %s", output)
		return
	}

	if err := h.mgr.Reload(); err != nil {
		if backup != nil {
			nginx.WriteAtomic(h.cfg.Nginx.GlobalConfig, backup)
		}
		result.Success = false
		result.Error = fmt.Sprintf("nginx reload failed: %v", err)
		return
	}

	h.logger.Info("global config updated")
}

func (h *Handler) handleDeployHtpasswd(cmd *pb.DeployHtpasswdCommand, result *pb.CommandResult) {
	path := filepath.Join(h.cfg.Nginx.HtpasswdDir, fmt.Sprintf("access-list-%s", cmd.AccessListId))
	if err := nginx.WriteAtomic(path, []byte(cmd.Content)); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("deploy htpasswd: %v", err)
		return
	}
	h.logger.Info("htpasswd deployed", "access_list_id", cmd.AccessListId)
}

func (h *Handler) handleRemoveHtpasswd(cmd *pb.RemoveHtpasswdCommand, result *pb.CommandResult) {
	path := filepath.Join(h.cfg.Nginx.HtpasswdDir, fmt.Sprintf("access-list-%s", cmd.AccessListId))
	if err := nginx.RemoveFile(path); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("remove htpasswd: %v", err)
		return
	}
	h.logger.Info("htpasswd removed", "access_list_id", cmd.AccessListId)
}

func (h *Handler) handleTestConfig(result *pb.CommandResult) {
	valid, output := h.mgr.TestConfig()
	result.Detail = output
	if !valid {
		result.Success = false
		result.Error = output
	}
}

func (h *Handler) handleDeployAcmeChallenge(cmd *pb.DeployAcmeChallengeCommand, result *pb.CommandResult) {
	if !acmeTokenRegex.MatchString(cmd.Token) {
		result.Success = false
		result.Error = "invalid ACME token format"
		return
	}
	dir := filepath.Join(h.cfg.Nginx.AcmeChallengeDir, ".well-known", "acme-challenge")
	path := filepath.Join(dir, cmd.Token)
	if err := nginx.WriteAtomic(path, []byte(cmd.Content)); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("deploy ACME challenge: %v", err)
		return
	}
	h.logger.Info("ACME challenge deployed", "token", cmd.Token)
}

func (h *Handler) handleRemoveAcmeChallenge(cmd *pb.RemoveAcmeChallengeCommand, result *pb.CommandResult) {
	if !acmeTokenRegex.MatchString(cmd.Token) {
		result.Success = false
		result.Error = "invalid ACME token format"
		return
	}
	path := filepath.Join(h.cfg.Nginx.AcmeChallengeDir, ".well-known", "acme-challenge", cmd.Token)
	if err := nginx.RemoveFile(path); err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("remove ACME challenge: %v", err)
		return
	}
	h.logger.Info("ACME challenge removed", "token", cmd.Token)
}

func (h *Handler) handleReadGlobalConfig(result *pb.CommandResult) {
	data, err := nginx.ReadFile(h.cfg.Nginx.GlobalConfig)
	if err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("read global config: %v", err)
		return
	}
	if data == nil {
		result.Success = false
		result.Error = "global config file not found"
		return
	}
	result.Detail = string(data)
}

func (h *Handler) handleRequestTrafficStats(cmd *pb.RequestTrafficStatsCommand, result *pb.CommandResult) {
	tailLines := int(cmd.TailLines)
	if tailLines <= 0 {
		tailLines = 200
	}

	// Scan all access logs in the logs directory
	entries, err := os.ReadDir(h.cfg.Nginx.LogsDir)
	if err != nil {
		result.Detail = `{"statusCodes":{"s2xx":0,"s3xx":0,"s4xx":0,"s5xx":0},"avgResponseTime":0,"p95ResponseTime":0,"totalRequests":0}`
		return
	}

	s2xx, s3xx, s4xx, s5xx := 0, 0, 0, 0
	totalRequests := 0

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".access.log") {
			continue
		}
		logPath := filepath.Join(h.cfg.Nginx.LogsDir, entry.Name())
		lines, err := nginx.TailLastN(logPath, tailLines)
		if err != nil {
			continue
		}
		for _, line := range lines {
			parsed := nginx.ParseLogLine("", line)
			if parsed.Status == 0 {
				continue
			}
			totalRequests++
			switch {
			case parsed.Status >= 200 && parsed.Status < 300:
				s2xx++
			case parsed.Status >= 300 && parsed.Status < 400:
				s3xx++
			case parsed.Status >= 400 && parsed.Status < 500:
				s4xx++
			case parsed.Status >= 500:
				s5xx++
			}
		}
	}

	result.Detail = fmt.Sprintf(
		`{"statusCodes":{"s2xx":%d,"s3xx":%d,"s4xx":%d,"s5xx":%d},"avgResponseTime":0,"p95ResponseTime":0,"totalRequests":%d}`,
		s2xx, s3xx, s4xx, s5xx, totalRequests,
	)
}

func (h *Handler) handleSetDaemonLogStream(cmd *pb.SetDaemonLogStreamCommand, result *pb.CommandResult) {
	// Enable BEFORE logging so the forwarder picks up this message
	stream.SetDaemonLogStreaming(cmd.Enabled, cmd.MinLevel)
	h.logger.Info("daemon log stream enabled", "min_level", cmd.MinLevel)
}
