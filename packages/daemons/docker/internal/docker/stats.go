package docker

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"

	pb "github.com/wiolett/gateway/daemon-shared/gatewayv1"
)

// StatsCollector periodically collects per-container resource usage from the
// Docker stats API. Stats are stored in a map keyed by container ID and can
// be retrieved via GetStats for inclusion in health reports.
type StatsCollector struct {
	client    *Client
	allowlist *AllowlistChecker
	logger    *slog.Logger
	mu        sync.RWMutex
	stats     map[string]*pb.ContainerStats // keyed by container ID
}

// NewStatsCollector creates a new StatsCollector.
func NewStatsCollector(client *Client, allowlist *AllowlistChecker, logger *slog.Logger) *StatsCollector {
	return &StatsCollector{
		client:    client,
		allowlist: allowlist,
		logger:    logger,
		stats:     make(map[string]*pb.ContainerStats),
	}
}

// Run polls Docker stats every 10 seconds until the context is cancelled.
func (sc *StatsCollector) Run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	// Collect once immediately
	sc.collect(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sc.collect(ctx)
		}
	}
}

// GetStats returns the current stats snapshot, thread-safe.
func (sc *StatsCollector) GetStats() []*pb.ContainerStats {
	sc.mu.RLock()
	defer sc.mu.RUnlock()

	result := make([]*pb.ContainerStats, 0, len(sc.stats))
	for _, s := range sc.stats {
		result = append(result, s)
	}
	return result
}

// collect gathers stats from all running containers filtered by the allowlist.
func (sc *StatsCollector) collect(ctx context.Context) {
	containers, err := sc.client.ListContainers(ctx)
	if err != nil {
		sc.logger.Debug("stats: list containers failed", "error", err)
		return
	}

	// Filter by allowlist and only collect stats for running containers
	containers = sc.allowlist.Filter(containers)

	newStats := make(map[string]*pb.ContainerStats, len(containers))

	for _, ctr := range containers {
		if ctr.State != "running" {
			continue
		}

		stat, err := sc.collectOne(ctx, ctr.ID)
		if err != nil {
			sc.logger.Debug("stats: collect failed", "container", ctr.Name, "error", err)
			continue
		}

		stat.ContainerId = ctr.ID
		stat.Name = ctr.Name
		stat.Image = ctr.Image
		stat.State = ctr.State
		newStats[ctr.ID] = stat
	}

	sc.mu.Lock()
	sc.stats = newStats
	sc.mu.Unlock()
}

// collectOne fetches a one-shot stats sample for a single container and
// returns a proto ContainerStats.
func (sc *StatsCollector) collectOne(ctx context.Context, containerID string) (*pb.ContainerStats, error) {
	result, err := sc.client.cli.ContainerStats(ctx, containerID, client.ContainerStatsOptions{
		Stream:                false,
		IncludePreviousSample: true,
	})
	if err != nil {
		return nil, err
	}
	defer result.Body.Close()

	body, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, err
	}

	var stats container.StatsResponse
	if err := json.Unmarshal(body, &stats); err != nil {
		return nil, err
	}

	return statsResponseToProto(&stats), nil
}

// statsResponseToProto converts a Docker StatsResponse to the protobuf ContainerStats.
func statsResponseToProto(stats *container.StatsResponse) *pb.ContainerStats {
	cs := &pb.ContainerStats{}

	// CPU percent calculation
	cs.CpuPercent = calculateCPUPercent(stats)

	// Memory
	cs.MemoryUsageBytes = int64(stats.MemoryStats.Usage)
	cs.MemoryLimitBytes = int64(stats.MemoryStats.Limit)

	// Network: aggregate all interfaces
	var rxBytes, txBytes uint64
	for _, netStats := range stats.Networks {
		rxBytes += netStats.RxBytes
		txBytes += netStats.TxBytes
	}
	cs.NetworkRxBytes = int64(rxBytes)
	cs.NetworkTxBytes = int64(txBytes)

	// Block IO
	var readBytes, writeBytes uint64
	for _, entry := range stats.BlkioStats.IoServiceBytesRecursive {
		switch strings.ToLower(entry.Op) {
		case "read":
			readBytes += entry.Value
		case "write":
			writeBytes += entry.Value
		}
	}
	cs.BlockReadBytes = int64(readBytes)
	cs.BlockWriteBytes = int64(writeBytes)

	// PIDs
	cs.Pids = int64(stats.PidsStats.Current)

	return cs
}

// calculateCPUPercent computes the CPU usage percentage from a Docker stats response.
// Formula: (cpuDelta / systemDelta) * numCPUs * 100.0
func calculateCPUPercent(stats *container.StatsResponse) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage) - float64(stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage) - float64(stats.PreCPUStats.SystemUsage)

	if systemDelta <= 0 || cpuDelta < 0 {
		return 0.0
	}

	numCPUs := float64(stats.CPUStats.OnlineCPUs)
	if numCPUs == 0 {
		// Fallback: count per-CPU entries
		numCPUs = float64(len(stats.CPUStats.CPUUsage.PercpuUsage))
	}
	if numCPUs == 0 {
		numCPUs = 1
	}

	return (cpuDelta / systemDelta) * numCPUs * 100.0
}
