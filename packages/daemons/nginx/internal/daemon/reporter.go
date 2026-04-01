package daemon

import (
	"bufio"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wiolett/gateway/nginx-daemon/internal/config"
	pb "github.com/wiolett/gateway/nginx-daemon/internal/gatewayv1"
	"github.com/wiolett/gateway/nginx-daemon/internal/nginx"
	"golang.org/x/sys/unix"
)

type Reporter struct {
	cfg    *config.Config
	mgr    *nginx.Manager
	logger *slog.Logger

	// mu protects delta-based metric state from concurrent CollectHealth calls
	mu             sync.Mutex
	prevIdle       uint64
	prevTotal      uint64
	prevDiskRead   uint64
	prevDiskWrite  uint64
}

func NewReporter(cfg *config.Config, mgr *nginx.Manager, logger *slog.Logger) *Reporter {
	return &Reporter{cfg: cfg, mgr: mgr, logger: logger}
}

func (r *Reporter) CollectHealth() *pb.HealthReport {
	r.mu.Lock()
	defer r.mu.Unlock()

	report := &pb.HealthReport{
		Timestamp: time.Now().Unix(),
	}

	report.NginxRunning = r.mgr.IsRunning()

	valid, _ := r.mgr.TestConfig()
	report.ConfigValid = valid

	if uptime, err := r.mgr.GetUptime(); err == nil {
		report.NginxUptimeSeconds = int64(uptime.Seconds())
	}

	if workers, err := r.mgr.GetWorkerCount(); err == nil {
		report.WorkerCount = int32(workers)
	}

	if version, err := r.mgr.GetVersion(); err == nil {
		report.NginxVersion = version
	}

	report.CpuPercent = r.getCPUPercent()

	// System memory from /proc/meminfo
	mem := getSystemMemory()
	report.SystemMemoryTotalBytes = mem.totalBytes
	report.SystemMemoryUsedBytes = mem.usedBytes
	report.SystemMemoryAvailableBytes = mem.availableBytes
	report.SwapTotalBytes = mem.swapTotalBytes
	report.SwapUsedBytes = mem.swapUsedBytes
	report.MemoryBytes = mem.usedBytes // backward compat

	// Disk (backward compat field)
	report.DiskFreeBytes = getDiskFree("/")

	// Load averages
	la1, la5, la15 := getLoadAverages()
	report.LoadAverage_1M = la1
	report.LoadAverage_5M = la5
	report.LoadAverage_15M = la15

	// System uptime
	report.SystemUptimeSeconds = getSystemUptime()

	// File descriptors
	openFD, maxFD := getFileDescriptors()
	report.OpenFileDescriptors = openFD
	report.MaxFileDescriptors = maxFD

	// Disk mounts
	report.DiskMounts = getDiskMounts()

	// Disk I/O
	report.DiskReadBytes, report.DiskWriteBytes = r.getDiskIO()

	// Network interfaces
	report.NetworkInterfaces = getNetworkInterfaces()

	// Nginx RSS
	report.NginxRssBytes = r.mgr.GetProcessRSS()

	// Error rates
	report.ErrorRate_4Xx, report.ErrorRate_5Xx = r.getErrorRates()

	return report
}

func (r *Reporter) CollectStats() *pb.StatsReport {
	report := &pb.StatsReport{
		Timestamp: time.Now().Unix(),
	}

	status, err := nginx.FetchStubStatus(r.cfg.Nginx.StubStatusURL)
	if err != nil {
		r.logger.Debug("failed to fetch stub_status", "error", err)
		return report
	}

	report.ActiveConnections = status.ActiveConnections
	report.Accepts = status.Accepts
	report.Handled = status.Handled
	report.Requests = status.Requests
	report.Reading = int32(status.Reading)
	report.Writing = int32(status.Writing)
	report.Waiting = int32(status.Waiting)

	return report
}

// getCPUPercent reads /proc/stat and computes CPU usage from deltas.
// Must be called with r.mu held.
func (r *Reporter) getCPUPercent() float64 {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	line := strings.Split(string(data), "\n")[0] // "cpu  ..."
	fields := strings.Fields(line)
	if len(fields) < 5 {
		return 0
	}
	var idle, total uint64
	for i := 1; i < len(fields); i++ {
		val, _ := strconv.ParseUint(fields[i], 10, 64)
		total += val
		if i == 4 { // idle is field index 4
			idle = val
		}
	}
	idleDelta := idle - r.prevIdle
	totalDelta := total - r.prevTotal
	r.prevIdle = idle
	r.prevTotal = total
	if totalDelta == 0 {
		return 0
	}
	return float64(totalDelta-idleDelta) / float64(totalDelta) * 100.0
}

type systemMemory struct {
	totalBytes     int64
	usedBytes      int64
	availableBytes int64
	swapTotalBytes int64
	swapUsedBytes  int64
}

// getSystemMemory reads /proc/meminfo and returns structured memory info.
func getSystemMemory() systemMemory {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return systemMemory{}
	}

	values := make(map[string]int64)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		valStr := strings.TrimSpace(parts[1])
		// Remove " kB" suffix if present
		valStr = strings.TrimSuffix(valStr, " kB")
		val, err := strconv.ParseInt(strings.TrimSpace(valStr), 10, 64)
		if err != nil {
			continue
		}
		values[key] = val
	}

	totalKB := values["MemTotal"]
	availableKB := values["MemAvailable"]
	swapTotalKB := values["SwapTotal"]
	swapFreeKB := values["SwapFree"]

	return systemMemory{
		totalBytes:     totalKB * 1024,
		usedBytes:      (totalKB - availableKB) * 1024,
		availableBytes: availableKB * 1024,
		swapTotalBytes: swapTotalKB * 1024,
		swapUsedBytes:  (swapTotalKB - swapFreeKB) * 1024,
	}
}

// getLoadAverages reads /proc/loadavg and returns 1m, 5m, 15m averages.
func getLoadAverages() (float64, float64, float64) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0
	}
	la1, _ := strconv.ParseFloat(fields[0], 64)
	la5, _ := strconv.ParseFloat(fields[1], 64)
	la15, _ := strconv.ParseFloat(fields[2], 64)
	return la1, la5, la15
}

// getSystemUptime reads /proc/uptime and returns system uptime in seconds.
func getSystemUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0
	}
	val, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return int64(val)
}

// getFileDescriptors returns open FDs for this process and system max.
func getFileDescriptors() (int64, int64) {
	// Open FDs: count entries in /proc/self/fd
	var openFD int64
	entries, err := os.ReadDir("/proc/self/fd")
	if err == nil {
		openFD = int64(len(entries))
	}

	// Max FDs: read /proc/sys/fs/file-max
	var maxFD int64
	data, err := os.ReadFile("/proc/sys/fs/file-max")
	if err == nil {
		maxFD, _ = strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	}

	return openFD, maxFD
}

func getDiskFree(path string) int64 {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0
	}
	return int64(stat.Bavail) * int64(stat.Bsize)
}

// virtualFilesystems is the set of filesystem types to skip when enumerating mounts.
var virtualFilesystems = map[string]bool{
	"proc":         true,
	"sysfs":        true,
	"devtmpfs":     true,
	"devpts":       true,
	"tmpfs":        true,
	"cgroup":       true,
	"cgroup2":      true,
	"securityfs":   true,
	"pstore":       true,
	"debugfs":      true,
	"tracefs":      true,
	"hugetlbfs":    true,
	"mqueue":       true,
	"overlay":      true,
	"autofs":       true,
	"binfmt_misc":  true,
	"fakeowner":    true,
	"fuse":         true,
	"fusectl":      true,
	"nsfs":         true,
	"squashfs":     true,
	"efivarfs":     true,
	"configfs":     true,
	"rpc_pipefs":   true,
	"nfsd":         true,
}

// getDiskMounts reads /proc/mounts, filters virtual filesystems, and returns disk usage info.
func getDiskMounts() []*pb.DiskMount {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return nil
	}

	seen := make(map[string]bool)
	var mounts []*pb.DiskMount

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		device := fields[0]
		mountPoint := fields[1]
		fsType := fields[2]

		if virtualFilesystems[fsType] {
			// Exception: include overlay on "/" as the root filesystem
			if !(fsType == "overlay" && mountPoint == "/") {
				continue
			}
		}

		// Include mounts backed by real block devices OR well-known real filesystem types
		realFS := map[string]bool{
			"ext2": true, "ext3": true, "ext4": true, "xfs": true,
			"btrfs": true, "zfs": true, "ntfs": true, "vfat": true,
			"overlay": true, // root overlay represents the container's disk
		}
		if !strings.HasPrefix(device, "/dev/") && !realFS[fsType] {
			continue
		}

		// Skip individual file bind-mounts (e.g., /etc/resolv.conf)
		if fi, err := os.Stat(mountPoint); err == nil && !fi.IsDir() {
			continue
		}

		// Deduplicate by mount point
		if seen[mountPoint] {
			continue
		}
		seen[mountPoint] = true

		var stat unix.Statfs_t
		if err := unix.Statfs(mountPoint, &stat); err != nil {
			continue
		}

		totalBytes := int64(stat.Blocks) * int64(stat.Bsize)
		freeBytes := int64(stat.Bavail) * int64(stat.Bsize)
		usedBytes := totalBytes - freeBytes

		var usagePercent float64
		if totalBytes > 0 {
			usagePercent = math.Round(float64(usedBytes)/float64(totalBytes)*1000) / 10
		}

		mounts = append(mounts, &pb.DiskMount{
			MountPoint:   mountPoint,
			Filesystem:   fsType,
			Device:       device,
			TotalBytes:   totalBytes,
			UsedBytes:    usedBytes,
			FreeBytes:    freeBytes,
			UsagePercent: usagePercent,
		})
	}

	return mounts
}

// getDiskIO reads /proc/diskstats, sums sectors read/written (×512 for bytes),
// and returns delta-based read/write bytes.
// Must be called with r.mu held.
func (r *Reporter) getDiskIO() (int64, int64) {
	data, err := os.ReadFile("/proc/diskstats")
	if err != nil {
		return 0, 0
	}

	var totalRead, totalWrite uint64

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		// /proc/diskstats has 14+ fields: major minor name rd_ios rd_merges rd_sectors ...
		if len(fields) < 10 {
			continue
		}
		deviceName := fields[2]

		// Skip loop and ram devices
		if strings.HasPrefix(deviceName, "loop") || strings.HasPrefix(deviceName, "ram") {
			continue
		}

		// Field index 5 = sectors read, field index 9 = sectors written
		sectorsRead, _ := strconv.ParseUint(fields[5], 10, 64)
		sectorsWritten, _ := strconv.ParseUint(fields[9], 10, 64)

		totalRead += sectorsRead * 512
		totalWrite += sectorsWritten * 512
	}

	readDelta := totalRead - r.prevDiskRead
	writeDelta := totalWrite - r.prevDiskWrite
	r.prevDiskRead = totalRead
	r.prevDiskWrite = totalWrite

	return int64(readDelta), int64(writeDelta)
}

// getNetworkInterfaces reads /proc/net/dev and returns per-interface stats, skipping lo.
func getNetworkInterfaces() []*pb.NetworkInterface {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil
	}

	var ifaces []*pb.NetworkInterface

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	lineNum := 0
	for scanner.Scan() {
		lineNum++
		// Skip the first two header lines
		if lineNum <= 2 {
			continue
		}
		line := scanner.Text()
		// Format: "  iface: rx_bytes rx_packets rx_errs rx_drop ... tx_bytes tx_packets tx_errs tx_drop ..."
		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			continue
		}
		name := strings.TrimSpace(line[:colonIdx])
		if name == "lo" {
			continue
		}

		rest := strings.TrimSpace(line[colonIdx+1:])
		fields := strings.Fields(rest)
		if len(fields) < 16 {
			continue
		}

		rxBytes, _ := strconv.ParseInt(fields[0], 10, 64)
		rxPackets, _ := strconv.ParseInt(fields[1], 10, 64)
		rxErrors, _ := strconv.ParseInt(fields[2], 10, 64)
		txBytes, _ := strconv.ParseInt(fields[8], 10, 64)
		txPackets, _ := strconv.ParseInt(fields[9], 10, 64)
		txErrors, _ := strconv.ParseInt(fields[10], 10, 64)

		ifaces = append(ifaces, &pb.NetworkInterface{
			Name:      name,
			RxBytes:   rxBytes,
			TxBytes:   txBytes,
			RxPackets: rxPackets,
			TxPackets: txPackets,
			RxErrors:  rxErrors,
			TxErrors:  txErrors,
		})
	}

	return ifaces
}

// getErrorRates scans access log files and calculates 4xx/5xx error rates.
func (r *Reporter) getErrorRates() (float64, float64) {
	logsDir := r.cfg.Nginx.LogsDir
	if logsDir == "" {
		return 0, 0
	}

	matches, err := filepath.Glob(filepath.Join(logsDir, "*.access.log"))
	if err != nil || len(matches) == 0 {
		return 0, 0
	}

	var total, count4xx, count5xx int

	for _, logFile := range matches {
		lines, err := nginx.TailLastN(logFile, 100)
		if err != nil || len(lines) == 0 {
			continue
		}
		for _, line := range lines {
			// Parse status code from combined log format
			// Use the log_tailer's regex-based parser via ParseLogLine
			entry := nginx.ParseLogLine("", line)
			if entry.Status == 0 {
				continue
			}
			total++
			if entry.Status >= 400 && entry.Status < 500 {
				count4xx++
			} else if entry.Status >= 500 && entry.Status < 600 {
				count5xx++
			}
		}
	}

	if total == 0 {
		return 0, 0
	}

	rate4xx := float64(count4xx) / float64(total) * 100.0
	rate5xx := float64(count5xx) / float64(total) * 100.0

	return rate4xx, rate5xx
}
