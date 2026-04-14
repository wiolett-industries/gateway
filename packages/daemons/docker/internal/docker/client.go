package docker

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/distribution/reference"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/api/types/volume"
	"github.com/moby/moby/client"
)

// Client wraps the Docker SDK client with convenience methods.
type Client struct {
	cli    *client.Client
	logger *slog.Logger
}

// ContainerInfo holds summary information about a container.
type ContainerInfo struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Image   string            `json:"image"`
	State   string            `json:"state"`
	Status  string            `json:"status"`
	Created int64             `json:"created"`
	Ports   []PortInfo        `json:"ports"`
	Labels  map[string]string `json:"labels,omitempty"`
}

// PortInfo describes a port mapping on a container.
type PortInfo struct {
	PrivatePort uint16 `json:"privatePort"`
	PublicPort  uint16 `json:"publicPort,omitempty"`
	Type        string `json:"type"`
	IP          string `json:"ip,omitempty"`
}

// NewClient creates a Docker SDK client connected to the given socket path.
func NewClient(socketPath string, logger *slog.Logger) (*Client, error) {
	cli, err := client.NewClientWithOpts(
		client.WithHost(socketPath),
		client.WithAPIVersionNegotiation(),
	)
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}
	return &Client{cli: cli, logger: logger}, nil
}

// Close releases the underlying Docker client resources.
func (c *Client) Close() error {
	return c.cli.Close()
}

// Ping checks connectivity to the Docker daemon.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.cli.Ping(ctx, client.PingOptions{})
	if err != nil {
		return fmt.Errorf("docker ping: %w", err)
	}
	return nil
}

// GetVersion returns the Docker engine version string.
func (c *Client) GetVersion(ctx context.Context) (string, error) {
	ver, err := c.cli.ServerVersion(ctx, client.ServerVersionOptions{})
	if err != nil {
		return "", fmt.Errorf("docker version: %w", err)
	}
	return ver.Version, nil
}

// CountContainers returns the number of running, stopped, and total containers.
func (c *Client) CountContainers(ctx context.Context) (running, stopped, total int, err error) {
	result, err := c.cli.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return 0, 0, 0, fmt.Errorf("container list: %w", err)
	}
	total = len(result.Items)
	for _, ctr := range result.Items {
		if string(ctr.State) == "running" {
			running++
		} else {
			stopped++
		}
	}
	return running, stopped, total, nil
}

// ListContainers returns summary info for all containers (running and stopped).
func (c *Client) ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	result, err := c.cli.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("container list: %w", err)
	}

	containers := make([]ContainerInfo, 0, len(result.Items))
	for _, ctr := range result.Items {
		name := ""
		if len(ctr.Names) > 0 {
			name = strings.TrimPrefix(ctr.Names[0], "/")
		}

		ports := make([]PortInfo, 0, len(ctr.Ports))
		for _, p := range ctr.Ports {
			pi := PortInfo{
				PrivatePort: p.PrivatePort,
				PublicPort:  p.PublicPort,
				Type:        p.Type,
			}
			if p.IP.IsValid() {
				pi.IP = p.IP.String()
			}
			ports = append(ports, pi)
		}

		containers = append(containers, ContainerInfo{
			ID:      ctr.ID,
			Name:    name,
			Image:   ctr.Image,
			State:   string(ctr.State),
			Status:  ctr.Status,
			Created: ctr.Created,
			Ports:   ports,
			Labels:  ctr.Labels,
		})
	}
	return containers, nil
}

// InspectContainer returns the full inspect JSON for a container.
func (c *Client) InspectContainer(ctx context.Context, id string) (json.RawMessage, error) {
	result, err := c.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return nil, fmt.Errorf("container inspect: %w", err)
	}
	data, err := json.Marshal(result.Container)
	if err != nil {
		return nil, fmt.Errorf("marshal inspect: %w", err)
	}
	return data, nil
}

// StartContainer starts a stopped container.
func (c *Client) StartContainer(ctx context.Context, id string) error {
	if _, err := c.cli.ContainerStart(ctx, id, client.ContainerStartOptions{}); err != nil {
		return fmt.Errorf("container start: %w", err)
	}
	return nil
}

// StopContainer stops a running container with a timeout in seconds.
func (c *Client) StopContainer(ctx context.Context, id string, timeoutSec int) error {
	if _, err := c.cli.ContainerStop(ctx, id, client.ContainerStopOptions{Timeout: &timeoutSec}); err != nil {
		return fmt.Errorf("container stop: %w", err)
	}
	return nil
}

// RestartContainer restarts a container with a timeout in seconds.
func (c *Client) RestartContainer(ctx context.Context, id string, timeoutSec int) error {
	if _, err := c.cli.ContainerRestart(ctx, id, client.ContainerRestartOptions{Timeout: &timeoutSec}); err != nil {
		return fmt.Errorf("container restart: %w", err)
	}
	return nil
}

// KillContainer sends a signal to a container.
func (c *Client) KillContainer(ctx context.Context, id string, signal string) error {
	if _, err := c.cli.ContainerKill(ctx, id, client.ContainerKillOptions{Signal: signal}); err != nil {
		return fmt.Errorf("container kill: %w", err)
	}
	return nil
}

// RemoveContainer removes a container, optionally with force.
func (c *Client) RemoveContainer(ctx context.Context, id string, force bool) error {
	if _, err := c.cli.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: force}); err != nil {
		return fmt.Errorf("container remove: %w", err)
	}
	return nil
}

// RenameContainer renames a container.
func (c *Client) RenameContainer(ctx context.Context, id string, newName string) error {
	if _, err := c.cli.ContainerRename(ctx, id, client.ContainerRenameOptions{NewName: newName}); err != nil {
		return fmt.Errorf("container rename: %w", err)
	}
	return nil
}

// ContainerStatsOnce fetches a one-shot stats snapshot for a container.
func (c *Client) ContainerStatsOnce(ctx context.Context, id string) (json.RawMessage, error) {
	result, err := c.cli.ContainerStats(ctx, id, client.ContainerStatsOptions{
		Stream:                false,
		IncludePreviousSample: true,
	})
	if err != nil {
		return nil, fmt.Errorf("container stats: %w", err)
	}
	defer result.Body.Close()
	body, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, fmt.Errorf("read stats body: %w", err)
	}
	return json.RawMessage(body), nil
}

// ContainerTop returns the running processes inside a container (like docker top).
func (c *Client) ContainerTop(ctx context.Context, id string) (json.RawMessage, error) {
	top, err := c.cli.ContainerTop(ctx, id, client.ContainerTopOptions{
		Arguments: []string{"-eo", "pid,user,%cpu,%mem,vsz,rss,tty,stat,start,time,comm"},
	})
	if err != nil {
		return nil, fmt.Errorf("container top: %w", err)
	}
	data, err := json.Marshal(top)
	if err != nil {
		return nil, fmt.Errorf("marshal top: %w", err)
	}
	return data, nil
}

// ContainerLogs retrieves the last `tail` lines of logs from a container.
// It strips the 8-byte Docker multiplexed log header from each frame.
// Optional since/until parameters filter by RFC3339 timestamp range.
func (c *Client) ContainerLogs(ctx context.Context, id string, tail int, timestamps bool, since string, until string) ([]string, error) {
	// Docker quirk: --tail + --until don't work together correctly.
	// When until is set, use expanding time windows to find enough lines efficiently.
	if until != "" && tail > 0 {
		return c.containerLogsWithUntil(ctx, id, tail, timestamps, since, until)
	}

	tailStr := "all"
	if tail > 0 {
		tailStr = strconv.Itoa(tail)
	}

	opts := client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       tailStr,
		Timestamps: timestamps,
	}
	if since != "" {
		opts.Since = since
	}
	if until != "" {
		opts.Until = until
	}

	reader, err := c.cli.ContainerLogs(ctx, id, opts)
	if err != nil {
		return nil, fmt.Errorf("container logs: %w", err)
	}
	defer reader.Close()

	return parseDockerLogs(reader)
}

// containerLogsWithUntil fetches the last `tail` lines before `until` using expanding time windows.
// Docker's --tail + --until don't work together, so we use --since + --until in expanding windows.
func (c *Client) containerLogsWithUntil(ctx context.Context, id string, tail int, timestamps bool, since string, until string) ([]string, error) {
	untilTime, err := time.Parse(time.RFC3339Nano, until)
	if err != nil {
		// Fallback: fetch without tail
		return c.ContainerLogs(ctx, id, 0, timestamps, since, until)
	}

	// Try expanding time windows: 1h, 6h, 24h, 7d, then all
	windows := []time.Duration{1 * time.Hour, 6 * time.Hour, 24 * time.Hour, 7 * 24 * time.Hour}

	for _, window := range windows {
		windowSince := untilTime.Add(-window).Format(time.RFC3339Nano)
		if since != "" {
			// Don't go before the explicit since
			sinceTime, _ := time.Parse(time.RFC3339Nano, since)
			if untilTime.Add(-window).Before(sinceTime) {
				windowSince = since
			}
		}

		opts := client.ContainerLogsOptions{
			ShowStdout: true,
			ShowStderr: true,
			Tail:       "all",
			Timestamps: timestamps,
			Since:      windowSince,
			Until:      until,
		}

		reader, err := c.cli.ContainerLogs(ctx, id, opts)
		if err != nil {
			return nil, fmt.Errorf("container logs: %w", err)
		}

		lines, err := parseDockerLogs(reader)
		reader.Close()
		if err != nil {
			return nil, err
		}

		if len(lines) >= tail {
			// Got enough — return the last `tail` lines
			return lines[len(lines)-tail:], nil
		}

		// If we got some lines but not enough, and since was limiting us, return what we have
		if since != "" && windowSince == since {
			return lines, nil
		}
	}

	// Final fallback: fetch all lines up to until (no since)
	opts := client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       "all",
		Timestamps: timestamps,
		Until:      until,
	}
	reader, err := c.cli.ContainerLogs(ctx, id, opts)
	if err != nil {
		return nil, fmt.Errorf("container logs: %w", err)
	}
	defer reader.Close()

	lines, err := parseDockerLogs(reader)
	if err != nil {
		return nil, err
	}

	if len(lines) > tail {
		return lines[len(lines)-tail:], nil
	}
	return lines, nil
}

// ContainerLogsFollow opens a follow-mode log stream for a container.
// It returns the io.ReadCloser and the caller is responsible for closing it.
// The stream will continue until the context is cancelled or the container stops.
// Optional since parameter starts streaming from the given RFC3339 timestamp.
func (c *Client) ContainerLogsFollow(ctx context.Context, id string, tail int, timestamps bool, since string) (io.ReadCloser, error) {
	tailStr := "all"
	if tail >= 0 && since != "" {
		// When following with since, use tail=0 to only get new lines
		tailStr = "0"
	} else if tail > 0 {
		tailStr = strconv.Itoa(tail)
	}

	opts := client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Tail:       tailStr,
		Timestamps: timestamps,
	}
	if since != "" {
		opts.Since = since
	}

	reader, err := c.cli.ContainerLogs(ctx, id, opts)
	if err != nil {
		return nil, fmt.Errorf("container logs follow: %w", err)
	}

	return reader, nil
}

// ── Container Create / Duplicate / Update ─────────────────────────

// ContainerCreateConfig is the JSON structure accepted by CreateContainer.
// It maps closely to the Docker API container creation parameters.
type ContainerCreateConfig struct {
	Name       string            `json:"name"`
	Image      string            `json:"image"`
	Cmd        []string          `json:"cmd,omitempty"`
	Entrypoint []string          `json:"entrypoint,omitempty"`
	Env        []string          `json:"env,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
	WorkingDir string            `json:"working_dir,omitempty"`
	User       string            `json:"user,omitempty"`
	Hostname   string            `json:"hostname,omitempty"`
	Tty        bool              `json:"tty,omitempty"`
	OpenStdin  bool              `json:"open_stdin,omitempty"`

	// Host config
	Binds         []string          `json:"binds,omitempty"`
	PortBindings  map[string]string `json:"port_bindings,omitempty"` // "80/tcp": "8080"
	NetworkMode   string            `json:"network_mode,omitempty"`
	RestartPolicy string            `json:"restart_policy,omitempty"` // "no", "always", "unless-stopped", "on-failure"
	Privileged    bool              `json:"privileged,omitempty"`
	CapAdd        []string          `json:"cap_add,omitempty"`
	CapDrop       []string          `json:"cap_drop,omitempty"`
	ExtraHosts    []string          `json:"extra_hosts,omitempty"`
}

// CreateContainer parses configJSON into a container config and creates the container.
// Returns the container ID and name.
func (c *Client) CreateContainer(ctx context.Context, configJSON string) (string, string, error) {
	var cfg ContainerCreateConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return "", "", fmt.Errorf("parse container config: %w", err)
	}

	if cfg.Image == "" {
		return "", "", fmt.Errorf("image is required")
	}

	containerCfg := &container.Config{
		Image:      cfg.Image,
		Cmd:        cfg.Cmd,
		Entrypoint: cfg.Entrypoint,
		Env:        cfg.Env,
		Labels:     cfg.Labels,
		WorkingDir: cfg.WorkingDir,
		User:       cfg.User,
		Hostname:   cfg.Hostname,
		Tty:        cfg.Tty,
		OpenStdin:  cfg.OpenStdin,
	}

	hostCfg := &container.HostConfig{
		Binds:       cfg.Binds,
		NetworkMode: container.NetworkMode(cfg.NetworkMode),
		Privileged:  cfg.Privileged,
		CapAdd:      cfg.CapAdd,
		CapDrop:     cfg.CapDrop,
		ExtraHosts:  cfg.ExtraHosts,
	}

	// Parse port bindings: "80/tcp" -> "8080"
	if len(cfg.PortBindings) > 0 {
		portMap := make(network.PortMap)
		for containerPort, hostPort := range cfg.PortBindings {
			port, err := network.ParsePort(containerPort)
			if err != nil {
				return "", "", fmt.Errorf("parse port %q: %w", containerPort, err)
			}
			portMap[port] = []network.PortBinding{
				{HostIP: netip.MustParseAddr("0.0.0.0"), HostPort: hostPort},
			}
		}
		hostCfg.PortBindings = portMap
	}

	// Parse restart policy
	if cfg.RestartPolicy != "" {
		hostCfg.RestartPolicy = container.RestartPolicy{Name: container.RestartPolicyMode(cfg.RestartPolicy)}
	}

	result, err := c.cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config:     containerCfg,
		HostConfig: hostCfg,
		Name:       cfg.Name,
	})
	if err != nil {
		return "", "", fmt.Errorf("create container: %w", err)
	}

	return result.ID, cfg.Name, nil
}

// DuplicateContainer inspects a source container and creates a new one with the
// same config and a different name.
func (c *Client) DuplicateContainer(ctx context.Context, id string, newName string) (string, error) {
	inspResult, err := c.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return "", fmt.Errorf("inspect source container: %w", err)
	}
	insp := inspResult.Container

	// Clone config, clear runtime fields
	cfg := insp.Config
	cfg.Hostname = ""

	result, err := c.cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config:     cfg,
		HostConfig: insp.HostConfig,
		Name:       newName,
	})
	if err != nil {
		return "", fmt.Errorf("create duplicate container: %w", err)
	}

	return result.ID, nil
}

// UpdateContainer performs an update of the container configuration.
// If newTag is set, it pulls that image first, then recreates the container.
// For env-only/config-preserving updates, it recreates directly without talking
// to the registry. envOverrides are merged on top; envRemovals are stripped.
func (c *Client) UpdateContainer(ctx context.Context, id string, newTag string, envOverrides map[string]string, envRemovals []string, registryAuth string) error {
	inspResult, err := c.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return fmt.Errorf("inspect container: %w", err)
	}
	insp := inspResult.Container

	imageRef := insp.Config.Image
	if imageRef == "" {
		imageRef = insp.Image
	}
	if imageRef == "" {
		return fmt.Errorf("could not determine image for container")
	}
	if !strings.Contains(imageRef, ":") {
		imageRef += ":latest"
	}

	// Only talk to the registry when the requested image tag changes.
	if newTag != "" {
		named, err := reference.ParseNormalizedNamed(imageRef)
		if err != nil {
			return fmt.Errorf("parse image reference: %w", err)
		}
		named = reference.TrimNamed(named)
		newRef, err := reference.WithTag(named, newTag)
		if err != nil {
			return fmt.Errorf("apply tag %q: %w", newTag, err)
		}
		imageRef = newRef.String()

		pullOpts := client.ImagePullOptions{}
		if registryAuth != "" {
			pullOpts.RegistryAuth = registryAuth
		}

		pullResp, err := c.cli.ImagePull(ctx, imageRef, pullOpts)
		if err != nil {
			return fmt.Errorf("pull image: %w", err)
		}
		// Drain the pull response to complete the pull.
		_, _ = io.Copy(io.Discard, pullResp)
		pullResp.Close()
	}

	return c.recreateContainer(ctx, &insp, imageRef, envOverrides, envRemovals)
}

// LiveUpdateContainer applies resource limits and restart policy to a running container
// without recreating it. This uses Docker's ContainerUpdate API.
func (c *Client) LiveUpdateContainer(ctx context.Context, id string, configJSON string) error {
	var params struct {
		RestartPolicy *string `json:"restartPolicy"`
		MaxRetries    *int    `json:"maxRetries"`
		MemoryLimit   *int64  `json:"memoryLimit"` // bytes
		MemorySwap    *int64  `json:"memorySwap"`  // bytes, -1 = unlimited
		NanoCPUs      *int64  `json:"nanoCPUs"`    // 1e9 = 1 CPU
		CpuShares     *int64  `json:"cpuShares"`
		PidsLimit     *int64  `json:"pidsLimit"` // 0 = unlimited
	}
	if err := json.Unmarshal([]byte(configJSON), &params); err != nil {
		return fmt.Errorf("parse live update params: %w", err)
	}

	opts := client.ContainerUpdateOptions{}

	// Restart policy
	if params.RestartPolicy != nil {
		policy := container.RestartPolicy{Name: container.RestartPolicyMode(*params.RestartPolicy)}
		if *params.RestartPolicy == "on-failure" && params.MaxRetries != nil {
			policy.MaximumRetryCount = *params.MaxRetries
		}
		opts.RestartPolicy = &policy
	}

	// Resource limits
	resources := container.Resources{}
	hasResources := false
	if params.MemoryLimit != nil {
		resources.Memory = *params.MemoryLimit
		hasResources = true
	}
	if params.MemorySwap != nil {
		resources.MemorySwap = *params.MemorySwap
		hasResources = true
	}
	if params.NanoCPUs != nil {
		resources.NanoCPUs = *params.NanoCPUs
		hasResources = true
	}
	if params.CpuShares != nil {
		resources.CPUShares = *params.CpuShares
		hasResources = true
	}
	if params.PidsLimit != nil {
		pids := *params.PidsLimit
		resources.PidsLimit = &pids
		hasResources = true
	}
	if hasResources {
		opts.Resources = &resources
	}

	_, err := c.cli.ContainerUpdate(ctx, id, opts)
	if err != nil {
		return fmt.Errorf("live update container: %w", err)
	}
	return nil
}

// RecreateWithConfig stops, removes, and recreates a container with new configuration
// overrides for ports, mounts, entrypoint, command, working directory, user, hostname, and labels.
func (c *Client) RecreateWithConfig(ctx context.Context, id string, configJSON string) error {
	var params struct {
		Image string `json:"image"`
		Ports []struct {
			HostPort      uint16 `json:"hostPort"`
			ContainerPort uint16 `json:"containerPort"`
			Protocol      string `json:"protocol"`
		} `json:"ports"`
		Mounts []struct {
			HostPath      string `json:"hostPath"`
			ContainerPath string `json:"containerPath"`
			Name          string `json:"name"`
			ReadOnly      bool   `json:"readOnly"`
		} `json:"mounts"`
		Entrypoint    []string          `json:"entrypoint"`
		Command       []string          `json:"command"`
		WorkingDir    string            `json:"workingDir"`
		User          string            `json:"user"`
		Hostname      string            `json:"hostname"`
		Labels        map[string]string `json:"labels"`
		RestartPolicy *string           `json:"restartPolicy"`
		MaxRetries    *int              `json:"maxRetries"`
		MemoryLimit   *int64            `json:"memoryLimit"`
		MemorySwap    *int64            `json:"memorySwap"`
		NanoCPUs      *int64            `json:"nanoCPUs"`
		CpuShares     *int64            `json:"cpuShares"`
		PidsLimit     *int64            `json:"pidsLimit"`
	}
	if err := json.Unmarshal([]byte(configJSON), &params); err != nil {
		return fmt.Errorf("parse recreate config: %w", err)
	}

	inspResult, err := c.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return fmt.Errorf("inspect container: %w", err)
	}
	insp := inspResult.Container

	// Apply port binding overrides
	if params.Ports != nil {
		portBindings := make(network.PortMap)
		exposedPorts := make(network.PortSet)
		for _, p := range params.Ports {
			proto := p.Protocol
			if proto == "" {
				proto = "tcp"
			}
			containerPort, parseErr := network.ParsePort(fmt.Sprintf("%d/%s", p.ContainerPort, proto))
			if parseErr != nil {
				return fmt.Errorf("parse port %d/%s: %w", p.ContainerPort, proto, parseErr)
			}
			exposedPorts[containerPort] = struct{}{}
			portBindings[containerPort] = append(portBindings[containerPort], network.PortBinding{
				HostIP:   netip.MustParseAddr("0.0.0.0"),
				HostPort: fmt.Sprintf("%d", p.HostPort),
			})
		}
		insp.HostConfig.PortBindings = portBindings
		insp.Config.ExposedPorts = exposedPorts
	}

	// Apply mount overrides
	if params.Mounts != nil {
		var binds []string
		for _, m := range params.Mounts {
			if m.HostPath != "" {
				bind := m.HostPath + ":" + m.ContainerPath
				if m.ReadOnly {
					bind += ":ro"
				}
				binds = append(binds, bind)
			} else if m.Name != "" {
				bind := m.Name + ":" + m.ContainerPath
				if m.ReadOnly {
					bind += ":ro"
				}
				binds = append(binds, bind)
			}
		}
		insp.HostConfig.Binds = binds
		// Clear Mounts field since we're using Binds
		insp.Mounts = nil
	}

	// Apply entrypoint override
	if params.Entrypoint != nil {
		insp.Config.Entrypoint = params.Entrypoint
	}

	// Apply command override
	if params.Command != nil {
		insp.Config.Cmd = params.Command
	}

	// Apply working directory override
	if params.WorkingDir != "" {
		insp.Config.WorkingDir = params.WorkingDir
	}

	// Apply user override
	if params.User != "" {
		insp.Config.User = params.User
	}

	// Apply hostname override
	if params.Hostname != "" {
		insp.Config.Hostname = params.Hostname
	}

	// Apply labels override
	if params.Labels != nil {
		insp.Config.Labels = params.Labels
	}

	// Apply runtime overrides to HostConfig so they persist after recreation.
	if params.RestartPolicy != nil {
		policy := container.RestartPolicy{Name: container.RestartPolicyMode(*params.RestartPolicy)}
		if *params.RestartPolicy == "on-failure" && params.MaxRetries != nil {
			policy.MaximumRetryCount = *params.MaxRetries
		}
		insp.HostConfig.RestartPolicy = policy
	} else if params.MaxRetries != nil && insp.HostConfig.RestartPolicy.Name == "on-failure" {
		insp.HostConfig.RestartPolicy.MaximumRetryCount = *params.MaxRetries
	}
	if params.MemoryLimit != nil {
		insp.HostConfig.Memory = *params.MemoryLimit
	}
	if params.MemorySwap != nil {
		insp.HostConfig.MemorySwap = *params.MemorySwap
	}
	if params.NanoCPUs != nil {
		insp.HostConfig.NanoCPUs = *params.NanoCPUs
	}
	if params.CpuShares != nil {
		insp.HostConfig.CPUShares = *params.CpuShares
	}
	if params.PidsLimit != nil {
		pids := *params.PidsLimit
		insp.HostConfig.PidsLimit = &pids
	}

	imageRef := params.Image
	if imageRef == "" {
		imageRef = insp.Config.Image
	}
	if imageRef == "" {
		imageRef = insp.Image
	}

	return c.recreateContainer(ctx, &insp, imageRef, nil, nil)
}

// recreateContainer stops, removes, and recreates a container with the given
// imageRef, preserving all network connections. envOverrides are merged on top
// of the existing env; envRemovals are stripped.
func (c *Client) recreateContainer(ctx context.Context, insp *container.InspectResponse, imageRef string, envOverrides map[string]string, envRemovals []string) error {
	name := strings.TrimPrefix(insp.Name, "/")
	if name == "" {
		name = insp.ID[:12]
	}

	wasRunning := insp.State != nil && insp.State.Running

	if wasRunning {
		// Stop the container (10s grace period, then SIGKILL)
		timeoutSec := 10
		if _, err := c.cli.ContainerStop(ctx, insp.ID, client.ContainerStopOptions{Timeout: &timeoutSec}); err != nil {
			return fmt.Errorf("stop container: %w", err)
		}
	}

	// Remove the container
	if _, err := c.cli.ContainerRemove(ctx, insp.ID, client.ContainerRemoveOptions{Force: true}); err != nil {
		return fmt.Errorf("remove container: %w", err)
	}

	// Build new config
	createConfig := *insp.Config
	createConfig.Image = imageRef
	createConfig.Env = applyEnvChanges(insp.Config.Env, envOverrides, envRemovals)

	// Preserve all networks the container was connected to.
	// Docker only allows one network at creation time; the rest are connected after.
	netNames := make([]string, 0, len(insp.NetworkSettings.Networks))
	for netName := range insp.NetworkSettings.Networks {
		netNames = append(netNames, netName)
	}
	var netCfg *network.NetworkingConfig
	if len(netNames) > 0 {
		ep := insp.NetworkSettings.Networks[netNames[0]]
		netCfg = &network.NetworkingConfig{
			EndpointsConfig: map[string]*network.EndpointSettings{netNames[0]: ep},
		}
	}

	createResult, err := c.cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Config:           &createConfig,
		HostConfig:       insp.HostConfig,
		NetworkingConfig: netCfg,
		Name:             name,
	})
	if err != nil {
		return fmt.Errorf("create container: %w", err)
	}

	// Connect to additional networks
	for _, netName := range netNames[1:] {
		ep := insp.NetworkSettings.Networks[netName]
		if _, err := c.cli.NetworkConnect(ctx, netName, client.NetworkConnectOptions{
			Container:      createResult.ID,
			EndpointConfig: ep,
		}); err != nil {
			c.logger.Warn("reconnect container to network failed", "container", name, "network", netName, "error", err)
		}
	}

	// Preserve the original running state. A stopped container should stay stopped.
	if wasRunning {
		if _, err := c.cli.ContainerStart(ctx, createResult.ID, client.ContainerStartOptions{}); err != nil {
			return fmt.Errorf("start container: %w", err)
		}
	}

	return nil
}

// applyEnvChanges builds the final env slice by:
//  1. Stripping keys listed in removals
//  2. Applying overrides on top (overrides win on conflict; new keys are appended)
func applyEnvChanges(containerEnv []string, overrides map[string]string, removals []string) []string {
	removeSet := make(map[string]bool, len(removals))
	for _, k := range removals {
		removeSet[k] = true
	}
	seen := make(map[string]bool, len(containerEnv))
	filtered := make([]string, 0, len(containerEnv))
	for _, kv := range containerEnv {
		key := kv
		if idx := strings.IndexByte(kv, '='); idx >= 0 {
			key = kv[:idx]
		}
		if removeSet[key] {
			continue
		}
		seen[key] = true
		if val, ok := overrides[key]; ok {
			filtered = append(filtered, key+"="+val)
		} else {
			filtered = append(filtered, kv)
		}
	}
	for k, v := range overrides {
		if !seen[k] {
			filtered = append(filtered, k+"="+v)
		}
	}
	return filtered
}

// ── Image Operations ──────────────────────────────────────────────

// ListImages returns the list of images as raw JSON.
func (c *Client) ListImages(ctx context.Context) (json.RawMessage, error) {
	result, err := c.cli.ImageList(ctx, client.ImageListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("image list: %w", err)
	}
	data, err := json.Marshal(result.Items)
	if err != nil {
		return nil, fmt.Errorf("marshal images: %w", err)
	}
	return data, nil
}

// PullImage pulls an image from a registry. registryAuth is base64-encoded
// JSON credentials (may be empty for public images).
func (c *Client) PullImage(ctx context.Context, imageRef string, registryAuth string) error {
	opts := client.ImagePullOptions{}
	if registryAuth != "" {
		opts.RegistryAuth = registryAuth
	}

	resp, err := c.cli.ImagePull(ctx, imageRef, opts)
	if err != nil {
		return fmt.Errorf("image pull: %w", err)
	}
	defer resp.Close()

	// Docker streams JSON progress; errors are embedded in the stream.
	// Read and check each message for error fields.
	decoder := json.NewDecoder(resp)
	var lastErr string
	for {
		var msg struct {
			Error       string `json:"error"`
			ErrorDetail struct {
				Message string `json:"message"`
			} `json:"errorDetail"`
		}
		if err := decoder.Decode(&msg); err != nil {
			break // EOF or parse error — done reading
		}
		if msg.Error != "" {
			lastErr = msg.Error
		}
	}
	if lastErr != "" {
		return fmt.Errorf("image pull: %s", lastErr)
	}
	return nil
}

// RemoveImage removes an image by ID or reference.
func (c *Client) RemoveImage(ctx context.Context, id string, force bool) error {
	_, err := c.cli.ImageRemove(ctx, id, client.ImageRemoveOptions{
		Force:         force,
		PruneChildren: true,
	})
	if err != nil {
		return fmt.Errorf("image remove: %w", err)
	}
	return nil
}

// PruneImages removes unused images and returns bytes reclaimed.
func (c *Client) PruneImages(ctx context.Context) (int64, error) {
	result, err := c.cli.ImagePrune(ctx, client.ImagePruneOptions{})
	if err != nil {
		return 0, fmt.Errorf("image prune: %w", err)
	}
	return int64(result.Report.SpaceReclaimed), nil
}

// ── Volume Operations ─────────────────────────────────────────────

// ListVolumes returns the list of volumes as raw JSON, enriched with usage info.
func (c *Client) ListVolumes(ctx context.Context) (json.RawMessage, error) {
	result, err := c.cli.VolumeList(ctx, client.VolumeListOptions{})
	if err != nil {
		return nil, fmt.Errorf("volume list: %w", err)
	}

	// Build a map of volume name → container names that use it
	volumeUsers := make(map[string][]string)
	ctrResult, err := c.cli.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err == nil {
		for _, ctr := range ctrResult.Items {
			name := strings.TrimPrefix(ctr.Names[0], "/")
			for _, m := range ctr.Mounts {
				if m.Type == "volume" {
					volumeUsers[m.Name] = append(volumeUsers[m.Name], name)
				}
			}
		}
	}

	type volumeWithUsage struct {
		volume.Volume
		UsedBy []string `json:"UsedBy"`
	}
	enriched := make([]volumeWithUsage, 0, len(result.Items))
	for _, v := range result.Items {
		vwu := volumeWithUsage{Volume: v}
		if users, ok := volumeUsers[v.Name]; ok {
			vwu.UsedBy = users
		}
		enriched = append(enriched, vwu)
	}

	data, err := json.Marshal(enriched)
	if err != nil {
		return nil, fmt.Errorf("marshal volumes: %w", err)
	}
	return data, nil
}

// CreateVolume creates a named volume with the given driver and labels.
func (c *Client) CreateVolume(ctx context.Context, name string, driver string, labels map[string]string) error {
	opts := client.VolumeCreateOptions{
		Name:   name,
		Labels: labels,
	}
	if driver != "" {
		opts.Driver = driver
	}
	_, err := c.cli.VolumeCreate(ctx, opts)
	if err != nil {
		return fmt.Errorf("volume create: %w", err)
	}
	return nil
}

// RemoveVolume removes a volume by name.
func (c *Client) RemoveVolume(ctx context.Context, name string, force bool) error {
	_, err := c.cli.VolumeRemove(ctx, name, client.VolumeRemoveOptions{Force: force})
	if err != nil {
		return fmt.Errorf("volume remove: %w", err)
	}
	return nil
}

// ── Network Operations ────────────────────────────────────────────

// ListNetworks returns the list of networks as raw JSON, with Containers populated.
func (c *Client) ListNetworks(ctx context.Context) (json.RawMessage, error) {
	result, err := c.cli.NetworkList(ctx, client.NetworkListOptions{})
	if err != nil {
		return nil, fmt.Errorf("network list: %w", err)
	}
	// NetworkList doesn't populate Containers — inspect each to get them.
	type netWithContainers struct {
		network.Summary
		Containers map[string]network.EndpointResource `json:"Containers"`
	}
	// Build map of network ID/name → containers (including stopped) from container configs
	networkUsers := make(map[string]map[string]network.EndpointResource)
	ctrResult, err := c.cli.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err == nil {
		for _, ctr := range ctrResult.Items {
			ctrName := ""
			if len(ctr.Names) > 0 {
				ctrName = strings.TrimPrefix(ctr.Names[0], "/")
			}
			for netName, netSettings := range ctr.NetworkSettings.Networks {
				if networkUsers[netName] == nil {
					networkUsers[netName] = make(map[string]network.EndpointResource)
				}
				networkUsers[netName][ctr.ID] = network.EndpointResource{
					Name: ctrName,
				}
				_ = netSettings
			}
		}
	}

	// Skip Docker built-in default networks
	hiddenNetworks := map[string]bool{"host": true, "none": true, "bridge": true}
	enriched := make([]netWithContainers, 0, len(result.Items))
	for _, n := range result.Items {
		if hiddenNetworks[n.Name] {
			continue
		}
		nwc := netWithContainers{Summary: n}
		// Merge: running containers from inspect + stopped containers from list
		inspected, inspErr := c.cli.NetworkInspect(ctx, n.ID, client.NetworkInspectOptions{})
		if inspErr == nil {
			nwc.Containers = inspected.Network.Containers
		} else {
			nwc.Containers = make(map[string]network.EndpointResource)
		}
		// Add stopped containers that aren't in the inspect result
		if users, ok := networkUsers[n.Name]; ok {
			for cid, ep := range users {
				if _, exists := nwc.Containers[cid]; !exists {
					nwc.Containers[cid] = ep
				}
			}
		}
		enriched = append(enriched, nwc)
	}
	data, err := json.Marshal(enriched)
	if err != nil {
		return nil, fmt.Errorf("marshal networks: %w", err)
	}
	return data, nil
}

// CreateNetwork creates a network with the given parameters. Returns the network ID.
func (c *Client) CreateNetwork(ctx context.Context, name string, driver string, subnet string, gatewayAddr string) (string, error) {
	opts := client.NetworkCreateOptions{
		Driver: driver,
	}

	if subnet != "" {
		ipamCfg := network.IPAMConfig{}
		prefix, err := netip.ParsePrefix(subnet)
		if err != nil {
			return "", fmt.Errorf("parse subnet %q: %w", subnet, err)
		}
		ipamCfg.Subnet = prefix

		if gatewayAddr != "" {
			gw, err := netip.ParseAddr(gatewayAddr)
			if err != nil {
				return "", fmt.Errorf("parse gateway %q: %w", gatewayAddr, err)
			}
			ipamCfg.Gateway = gw
		}

		opts.IPAM = &network.IPAM{
			Config: []network.IPAMConfig{ipamCfg},
		}
	}

	result, err := c.cli.NetworkCreate(ctx, name, opts)
	if err != nil {
		return "", fmt.Errorf("network create: %w", err)
	}
	return result.ID, nil
}

// RemoveNetwork removes a network by ID.
func (c *Client) RemoveNetwork(ctx context.Context, id string) error {
	_, err := c.cli.NetworkRemove(ctx, id, client.NetworkRemoveOptions{})
	if err != nil {
		return fmt.Errorf("network remove: %w", err)
	}
	return nil
}

// ConnectContainerToNetwork connects a container to a network.
func (c *Client) ConnectContainerToNetwork(ctx context.Context, networkID, containerID string) error {
	_, err := c.cli.NetworkConnect(ctx, networkID, client.NetworkConnectOptions{
		Container: containerID,
	})
	if err != nil {
		return fmt.Errorf("network connect: %w", err)
	}
	return nil
}

// DisconnectContainerFromNetwork disconnects a container from a network.
func (c *Client) DisconnectContainerFromNetwork(ctx context.Context, networkID, containerID string) error {
	_, err := c.cli.NetworkDisconnect(ctx, networkID, client.NetworkDisconnectOptions{
		Container: containerID,
	})
	if err != nil {
		return fmt.Errorf("network disconnect: %w", err)
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────

// ContainerName returns the canonical name of a container (without leading "/").
func (c *Client) ContainerName(ctx context.Context, containerID string) (string, error) {
	result, err := c.cli.ContainerInspect(ctx, containerID, client.ContainerInspectOptions{})
	if err != nil {
		return "", fmt.Errorf("inspect container: %w", err)
	}
	name := strings.TrimPrefix(result.Container.Name, "/")
	if name == "" {
		name = result.Container.ID[:12]
	}
	return name, nil
}

// resolveRegistryAuth determines the registry auth string for the given image
// reference using the provided credentials map (registry URL -> base64 auth).
func resolveRegistryAuth(imageRef string, registryCreds map[string]string) string {
	if len(registryCreds) == 0 {
		return ""
	}
	named, err := reference.ParseNormalizedNamed(imageRef)
	if err != nil {
		return ""
	}
	domain := reference.Domain(named)
	if auth, ok := registryCreds[domain]; ok {
		return auth
	}
	return ""
}

// parseDockerLogs reads Docker multiplexed log output and strips the
// 8-byte header from each frame. Each frame has:
//
//	[1 byte stream type][3 bytes padding][4 bytes big-endian size][payload]
func parseDockerLogs(reader io.Reader) ([]string, error) {
	var lines []string
	header := make([]byte, 8)

	for {
		_, err := io.ReadFull(reader, header)
		if err == io.EOF {
			break
		}
		if err != nil {
			// If we get unexpected EOF, the stream might be from a TTY container
			// which doesn't use multiplexed format. Fall back to line-based reading.
			break
		}

		size := binary.BigEndian.Uint32(header[4:8])
		if size == 0 {
			continue
		}

		payload := make([]byte, size)
		_, err = io.ReadFull(reader, payload)
		if err != nil {
			break
		}

		// Split payload into lines (a frame may contain multiple lines)
		scanner := bufio.NewScanner(strings.NewReader(string(payload)))
		for scanner.Scan() {
			line := scanner.Text()
			if line != "" {
				lines = append(lines, line)
			}
		}
	}

	return lines, nil
}
