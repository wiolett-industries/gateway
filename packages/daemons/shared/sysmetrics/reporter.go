package sysmetrics

import (
	"sync"
	"time"

	pb "github.com/wiolett/gateway/daemon-shared/gatewayv1"
)

// SystemReporter collects system-level metrics into a HealthReport.
// It maintains delta-based state for CPU and disk I/O metrics.
type SystemReporter struct {
	mu       sync.Mutex
	cpuState CPUState
	diskIO   DiskIOState
}

// NewSystemReporter creates a new SystemReporter.
func NewSystemReporter() *SystemReporter {
	return &SystemReporter{}
}

// CollectSystemHealth populates system-level fields in a HealthReport.
// It can be called with an existing report (e.g., one that already has
// daemon-specific fields populated) or with a new report.
func (r *SystemReporter) CollectSystemHealth(report *pb.HealthReport) *pb.HealthReport {
	if report == nil {
		report = &pb.HealthReport{}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	report.Timestamp = time.Now().Unix()

	// CPU
	report.CpuPercent = GetCPUPercent(&r.cpuState)

	// System memory from /proc/meminfo
	mem := GetSystemMemory()
	report.SystemMemoryTotalBytes = mem.TotalBytes
	report.SystemMemoryUsedBytes = mem.UsedBytes
	report.SystemMemoryAvailableBytes = mem.AvailableBytes
	report.SwapTotalBytes = mem.SwapTotalBytes
	report.SwapUsedBytes = mem.SwapUsedBytes
	report.MemoryBytes = mem.UsedBytes // backward compat

	// Disk (backward compat field)
	report.DiskFreeBytes = GetDiskFree("/")

	// Load averages
	la1, la5, la15 := GetLoadAverages()
	report.LoadAverage_1M = la1
	report.LoadAverage_5M = la5
	report.LoadAverage_15M = la15

	// System uptime
	report.SystemUptimeSeconds = GetSystemUptime()

	// File descriptors
	openFD, maxFD := GetFileDescriptors()
	report.OpenFileDescriptors = openFD
	report.MaxFileDescriptors = maxFD

	// Disk mounts
	report.DiskMounts = GetDiskMounts()

	// Disk I/O
	report.DiskReadBytes, report.DiskWriteBytes = GetDiskIO(&r.diskIO)

	// Network interfaces
	report.NetworkInterfaces = GetNetworkInterfaces()

	return report
}
