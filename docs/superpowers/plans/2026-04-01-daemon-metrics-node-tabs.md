# Enhanced Daemon Metrics + Node Detail Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand daemon metrics collection (system memory, load, disk mounts, network I/O, nginx RSS, error rates) and restructure the node detail page with Details/Logs/Monitoring tabs.

**Architecture:** Proto messages are extended with new metric fields. Go daemon collectors read from `/proc/*` and `statfs`. Backend exposes a node-specific monitoring SSE endpoint with adaptive polling (5s active / 30s idle). Frontend uses a tabbed layout with CodeMirror for logs and sparkline charts for monitoring.

**Tech Stack:** Protobuf + protoc, Go (`/proc` parsing), TypeScript/Hono (SSE), React + CodeMirror + custom Sparkline component

**User preferences:** No intermediate commits — commit everything together at end. No TDD (tests after implementation). Biome for linting (not eslint).

---

## File Map

### Proto
- **Modify:** `proto/gateway/v1/nginx-daemon.proto` — add DiskMount, NetworkInterface messages; extend HealthReport with ~20 new fields

### Go Daemon
- **Modify:** `packages/daemons/nginx/internal/daemon/reporter.go` — replace stub collectors with full `/proc` readers
- **Create:** `packages/daemons/nginx/internal/nginx/log_format.go` — inject `$upstream_response_time` into nginx log format
- **Modify:** `packages/daemons/nginx/internal/nginx/manager.go` — add `GetNginxRSS()` method
- **Regenerate:** `packages/daemons/nginx/internal/gatewayv1/*.pb.go` — via `make proto`

### Backend TypeScript
- **Modify:** `packages/backend/src/db/schema/nodes.ts` — extend NodeHealthReport interface
- **Modify:** `packages/backend/src/grpc/generated/types.ts` — extend HealthReport interface
- **Modify:** `packages/backend/src/grpc/services/control.ts` — pass new fields in health report handling
- **Create:** `packages/backend/src/modules/nodes/node-monitoring.service.ts` — SSE monitoring service with adaptive polling
- **Modify:** `packages/backend/src/modules/nodes/nodes.routes.ts` — add `/api/nodes/:id/monitoring/stream` SSE endpoint
- **Modify:** `packages/backend/src/bootstrap.ts` — register NodeMonitoringService

### Frontend
- **Modify:** `packages/frontend/src/pages/AdminNodeDetail.tsx` — tabbed layout (Details, Logs, Monitoring)
- **Create:** `packages/frontend/src/pages/node-detail/NodeDetailsTab.tsx` — overview cards + assigned hosts
- **Create:** `packages/frontend/src/pages/node-detail/NodeLogsTab.tsx` — CodeEditor readonly with SSE
- **Create:** `packages/frontend/src/pages/node-detail/NodeMonitoringTab.tsx` — real-time charts via SSE
- **Modify:** `packages/frontend/src/types/index.ts` — extend NodeHealthReport type
- **Modify:** `packages/frontend/src/services/api.ts` — add node monitoring SSE method

---

## Task 1: Extend Proto Messages

**Files:**
- Modify: `proto/gateway/v1/nginx-daemon.proto`
- Regenerate: `packages/daemons/nginx/internal/gatewayv1/*.pb.go`

- [ ] **Step 1: Add DiskMount and NetworkInterface messages, extend HealthReport**

In `proto/gateway/v1/nginx-daemon.proto`, add after the existing `HealthReport` message:

```protobuf
message DiskMount {
  string mount_point = 1;
  string filesystem = 2;
  string device = 3;
  int64 total_bytes = 4;
  int64 used_bytes = 5;
  int64 free_bytes = 6;
  double usage_percent = 7;
}

message NetworkInterface {
  string name = 1;
  int64 rx_bytes = 2;
  int64 tx_bytes = 3;
  int64 rx_packets = 4;
  int64 tx_packets = 5;
  int64 rx_errors = 6;
  int64 tx_errors = 7;
}
```

Extend `HealthReport` with new fields (add after field 9 `timestamp`):

```protobuf
  // System
  double load_average_1m = 10;
  double load_average_5m = 11;
  double load_average_15m = 12;
  int64 system_memory_total_bytes = 13;
  int64 system_memory_used_bytes = 14;
  int64 system_memory_available_bytes = 15;
  int64 swap_total_bytes = 16;
  int64 swap_used_bytes = 17;
  int64 system_uptime_seconds = 18;
  int64 open_file_descriptors = 19;
  int64 max_file_descriptors = 20;
  // Disk
  repeated DiskMount disk_mounts = 21;
  int64 disk_read_bytes = 22;
  int64 disk_write_bytes = 23;
  // Network
  repeated NetworkInterface network_interfaces = 24;
  // Nginx
  int64 nginx_rss_bytes = 25;
  double error_rate_4xx = 26;
  double error_rate_5xx = 27;
```

- [ ] **Step 2: Regenerate Go stubs**

```bash
cd packages/daemons/nginx && make proto
```

Verify: `go build ./...` succeeds.

---

## Task 2: Implement Go Daemon Collectors

**Files:**
- Modify: `packages/daemons/nginx/internal/daemon/reporter.go`

- [ ] **Step 1: Replace `getMemoryUsage()` with system memory from `/proc/meminfo`**

```go
type systemMemory struct {
	totalBytes     int64
	usedBytes      int64
	availableBytes int64
	swapTotalBytes int64
	swapUsedBytes  int64
}

func getSystemMemory() systemMemory {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return systemMemory{}
	}
	fields := make(map[string]int64)
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) >= 2 {
			key := strings.TrimSuffix(parts[0], ":")
			val, _ := strconv.ParseInt(parts[1], 10, 64)
			fields[key] = val * 1024 // convert kB to bytes
		}
	}
	total := fields["MemTotal"]
	available := fields["MemAvailable"]
	swapTotal := fields["SwapTotal"]
	swapFree := fields["SwapFree"]
	return systemMemory{
		totalBytes:     total,
		usedBytes:      total - available,
		availableBytes: available,
		swapTotalBytes: swapTotal,
		swapUsedBytes:  swapTotal - swapFree,
	}
}
```

- [ ] **Step 2: Add load averages from `/proc/loadavg`**

```go
type loadAverages struct {
	load1m, load5m, load15m float64
}

func getLoadAverages() loadAverages {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return loadAverages{}
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return loadAverages{}
	}
	l1, _ := strconv.ParseFloat(fields[0], 64)
	l5, _ := strconv.ParseFloat(fields[1], 64)
	l15, _ := strconv.ParseFloat(fields[2], 64)
	return loadAverages{l1, l5, l15}
}
```

- [ ] **Step 3: Add system uptime from `/proc/uptime`**

```go
func getSystemUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0
	}
	val, _ := strconv.ParseFloat(fields[0], 64)
	return int64(val)
}
```

- [ ] **Step 4: Add file descriptor count**

```go
func getFileDescriptors() (open int64, max int64) {
	entries, err := os.ReadDir("/proc/self/fd")
	if err == nil {
		open = int64(len(entries))
	}
	data, err := os.ReadFile("/proc/sys/fs/file-max")
	if err == nil {
		max, _ = strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	}
	return
}
```

- [ ] **Step 5: Add disk mount scanner**

```go
func getDiskMounts() []*pb.DiskMount {
	data, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return nil
	}
	skipFS := map[string]bool{
		"proc": true, "sysfs": true, "devtmpfs": true, "devpts": true,
		"tmpfs": true, "cgroup": true, "cgroup2": true, "securityfs": true,
		"pstore": true, "debugfs": true, "tracefs": true, "hugetlbfs": true,
		"mqueue": true, "overlay": true, "autofs": true, "binfmt_misc": true,
	}
	seen := make(map[string]bool)
	var mounts []*pb.DiskMount
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		device, mountPoint, fsType := fields[0], fields[1], fields[2]
		if skipFS[fsType] || seen[mountPoint] {
			continue
		}
		seen[mountPoint] = true
		var stat unix.Statfs_t
		if err := unix.Statfs(mountPoint, &stat); err != nil {
			continue
		}
		total := int64(stat.Blocks) * int64(stat.Bsize)
		free := int64(stat.Bavail) * int64(stat.Bsize)
		used := total - free
		var pct float64
		if total > 0 {
			pct = float64(used) / float64(total) * 100
		}
		mounts = append(mounts, &pb.DiskMount{
			MountPoint:   mountPoint,
			Filesystem:   fsType,
			Device:       device,
			TotalBytes:   total,
			UsedBytes:    used,
			FreeBytes:    free,
			UsagePercent: math.Round(pct*100) / 100,
		})
	}
	return mounts
}
```

Import `math` at the top.

- [ ] **Step 6: Add disk I/O from `/proc/diskstats`**

```go
var prevDiskRead, prevDiskWrite uint64

func getDiskIO() (readBytes, writeBytes int64) {
	data, err := os.ReadFile("/proc/diskstats")
	if err != nil {
		return 0, 0
	}
	var totalRead, totalWrite uint64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 14 {
			continue
		}
		// Only count whole-disk devices (e.g., sda, vda, nvme0n1), skip partitions
		name := fields[2]
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") {
			continue
		}
		// fields[5] = sectors read, fields[9] = sectors written (512 bytes/sector)
		r, _ := strconv.ParseUint(fields[5], 10, 64)
		w, _ := strconv.ParseUint(fields[9], 10, 64)
		totalRead += r * 512
		totalWrite += w * 512
	}
	// Delta-based
	dr := int64(totalRead - prevDiskRead)
	dw := int64(totalWrite - prevDiskWrite)
	prevDiskRead = totalRead
	prevDiskWrite = totalWrite
	if dr < 0 { dr = 0 }
	if dw < 0 { dw = 0 }
	return dr, dw
}
```

- [ ] **Step 7: Add network I/O from `/proc/net/dev`**

```go
func getNetworkInterfaces() []*pb.NetworkInterface {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil
	}
	var ifaces []*pb.NetworkInterface
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, ":") || strings.HasPrefix(line, "Inter") || strings.HasPrefix(line, " face") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		name := strings.TrimSpace(parts[0])
		if name == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
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
```

- [ ] **Step 8: Add nginx RSS measurement**

In `packages/daemons/nginx/internal/nginx/manager.go`, add:

```go
// GetProcessRSS returns the total RSS in bytes for all nginx processes (master + workers).
func (m *Manager) GetProcessRSS() int64 {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0
	}
	var totalRSS int64
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 {
			continue
		}
		cmdline, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
		if err != nil {
			continue
		}
		if !strings.Contains(string(cmdline), "nginx") {
			continue
		}
		status, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(status), "\n") {
			if strings.HasPrefix(line, "VmRSS:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					kb, _ := strconv.ParseInt(fields[1], 10, 64)
					totalRSS += kb * 1024
				}
				break
			}
		}
	}
	return totalRSS
}
```

Import `strconv` and `strings` in manager.go if not already present.

- [ ] **Step 9: Add error rate calculation from access logs**

In `reporter.go`, add:

```go
type errorRates struct {
	rate4xx float64
	rate5xx float64
}

func (r *Reporter) getErrorRates() errorRates {
	entries, err := os.ReadDir(r.cfg.Nginx.LogsDir)
	if err != nil {
		return errorRates{}
	}
	count4xx, count5xx, total := 0, 0, 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".access.log") {
			continue
		}
		logPath := filepath.Join(r.cfg.Nginx.LogsDir, entry.Name())
		lines, err := nginx.TailLastN(logPath, 100)
		if err != nil {
			continue
		}
		for _, line := range lines {
			parsed := nginx.ParseLogLine("", line)
			if parsed.Status == 0 {
				continue
			}
			total++
			if parsed.Status >= 400 && parsed.Status < 500 {
				count4xx++
			} else if parsed.Status >= 500 {
				count5xx++
			}
		}
	}
	if total == 0 {
		return errorRates{}
	}
	return errorRates{
		rate4xx: float64(count4xx) / float64(total) * 100,
		rate5xx: float64(count5xx) / float64(total) * 100,
	}
}
```

Import `path/filepath` at the top.

- [ ] **Step 10: Wire all collectors into `CollectHealth()`**

Replace the body of `CollectHealth()`:

```go
func (r *Reporter) CollectHealth() *pb.HealthReport {
	report := &pb.HealthReport{
		Timestamp: time.Now().Unix(),
	}

	// Nginx status
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
	report.NginxRssBytes = r.mgr.GetProcessRSS()

	// CPU
	report.CpuPercent = getCPUPercent()

	// Load averages
	la := getLoadAverages()
	report.LoadAverage_1M = la.load1m
	report.LoadAverage_5M = la.load5m
	report.LoadAverage_15M = la.load15m

	// System memory
	mem := getSystemMemory()
	report.MemoryBytes = mem.usedBytes // backward compat: used bytes
	report.SystemMemoryTotalBytes = mem.totalBytes
	report.SystemMemoryUsedBytes = mem.usedBytes
	report.SystemMemoryAvailableBytes = mem.availableBytes
	report.SwapTotalBytes = mem.swapTotalBytes
	report.SwapUsedBytes = mem.swapUsedBytes

	// Disk
	report.DiskFreeBytes = getDiskFree("/") // backward compat
	report.DiskMounts = getDiskMounts()
	dr, dw := getDiskIO()
	report.DiskReadBytes = dr
	report.DiskWriteBytes = dw

	// Network
	report.NetworkInterfaces = getNetworkInterfaces()

	// System
	report.SystemUptimeSeconds = getSystemUptime()
	fdOpen, fdMax := getFileDescriptors()
	report.OpenFileDescriptors = fdOpen
	report.MaxFileDescriptors = fdMax

	// Error rates
	rates := r.getErrorRates()
	report.ErrorRate_4Xx = rates.rate4xx
	report.ErrorRate_5Xx = rates.rate5xx

	return report
}
```

Note: Proto field names like `load_average_1m` become `LoadAverage_1M` in Go. Verify the exact generated field names after proto regen in step 1.

- [ ] **Step 11: Build and verify**

```bash
cd packages/daemons/nginx && CGO_ENABLED=0 go build ./...
```

---

## Task 3: Nginx Log Format Injection

**Files:**
- Create: `packages/daemons/nginx/internal/nginx/log_format.go`
- Modify: `packages/daemons/nginx/internal/daemon/daemon.go`

- [ ] **Step 1: Create log format injector**

`packages/daemons/nginx/internal/nginx/log_format.go`:

```go
package nginx

import (
	"os"
	"strings"
)

const gatewayLogFormat = `log_format gateway_combined '$remote_addr - $remote_user [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$http_referer" "$http_user_agent" '
    '$upstream_response_time $request_time';`

// EnsureLogFormat checks if the gateway log format is present in nginx.conf.
// If not, injects it into the http block. Returns true if modified.
func EnsureLogFormat(nginxConfPath string) (bool, error) {
	data, err := os.ReadFile(nginxConfPath)
	if err != nil {
		return false, err
	}

	content := string(data)
	if strings.Contains(content, "gateway_combined") {
		return false, nil // already present
	}

	// Find the http { block and inject after it
	httpIdx := strings.Index(content, "http {")
	if httpIdx == -1 {
		httpIdx = strings.Index(content, "http{")
	}
	if httpIdx == -1 {
		return false, nil // can't find http block
	}

	// Find the opening brace
	braceIdx := strings.Index(content[httpIdx:], "{")
	if braceIdx == -1 {
		return false, nil
	}
	insertAt := httpIdx + braceIdx + 1

	injection := "\n    # Gateway daemon log format (auto-injected)\n    " + gatewayLogFormat + "\n"
	newContent := content[:insertAt] + injection + content[insertAt:]

	return true, WriteAtomic(nginxConfPath, []byte(newContent))
}
```

- [ ] **Step 2: Call on daemon startup**

In `daemon.go`, in the `New()` function after nginx is detected, add:

```go
	// Ensure gateway log format is present in nginx.conf
	if modified, err := nginx.EnsureLogFormat(cfg.Nginx.GlobalConfig); err != nil {
		logger.Warn("failed to inject log format", "error", err)
	} else if modified {
		logger.Info("injected gateway_combined log format into nginx.conf")
		mgr.Reload()
	}
```

---

## Task 4: Backend Type Updates

**Files:**
- Modify: `packages/backend/src/db/schema/nodes.ts`
- Modify: `packages/backend/src/grpc/generated/types.ts`
- Modify: `packages/backend/src/grpc/services/control.ts`
- Modify: `packages/frontend/src/types/index.ts`

- [ ] **Step 1: Extend NodeHealthReport in nodes.ts**

Add new fields to `NodeHealthReport` interface:

```typescript
export interface NodeHealthReport {
  // Existing
  nginxRunning: boolean;
  configValid: boolean;
  nginxUptimeSeconds: number;
  workerCount: number;
  nginxVersion: string;
  cpuPercent: number;
  memoryBytes: number;
  diskFreeBytes: number;
  timestamp: number;
  // New — system
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  systemMemoryTotalBytes: number;
  systemMemoryUsedBytes: number;
  systemMemoryAvailableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  systemUptimeSeconds: number;
  openFileDescriptors: number;
  maxFileDescriptors: number;
  // New — disk
  diskMounts: Array<{
    mountPoint: string;
    filesystem: string;
    device: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  }>;
  diskReadBytes: number;
  diskWriteBytes: number;
  // New — network
  networkInterfaces: Array<{
    name: string;
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
  }>;
  // New — nginx
  nginxRssBytes: number;
  errorRate4xx: number;
  errorRate5xx: number;
}
```

- [ ] **Step 2: Extend gRPC generated types**

In `packages/backend/src/grpc/generated/types.ts`, extend `HealthReport`:

```typescript
export interface HealthReport {
  // Existing fields...
  nginxRunning: boolean;
  configValid: boolean;
  nginxUptimeSeconds: string;
  workerCount: number;
  nginxVersion: string;
  cpuPercent: number;
  memoryBytes: string;
  diskFreeBytes: string;
  timestamp: string;
  // New fields (int64 as string via proto-loader)
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  systemMemoryTotalBytes: string;
  systemMemoryUsedBytes: string;
  systemMemoryAvailableBytes: string;
  swapTotalBytes: string;
  swapUsedBytes: string;
  systemUptimeSeconds: string;
  openFileDescriptors: string;
  maxFileDescriptors: string;
  diskMounts: Array<{
    mountPoint: string;
    filesystem: string;
    device: string;
    totalBytes: string;
    usedBytes: string;
    freeBytes: string;
    usagePercent: number;
  }>;
  diskReadBytes: string;
  diskWriteBytes: string;
  networkInterfaces: Array<{
    name: string;
    rxBytes: string;
    txBytes: string;
    rxPackets: string;
    txPackets: string;
    rxErrors: string;
    txErrors: string;
  }>;
  nginxRssBytes: string;
  errorRate4xx: number;
  errorRate5xx: number;
}
```

- [ ] **Step 3: Update control.ts health report handler**

In the `msg.healthReport` handler in `control.ts`, add the new fields to the object passed to `deps.registry.updateHealthReport()` and to the DB persist:

```typescript
const healthData = {
  // existing...
  nginxRunning: msg.healthReport.nginxRunning,
  configValid: msg.healthReport.configValid,
  nginxUptimeSeconds: Number(msg.healthReport.nginxUptimeSeconds),
  workerCount: msg.healthReport.workerCount,
  nginxVersion: msg.healthReport.nginxVersion,
  cpuPercent: msg.healthReport.cpuPercent,
  memoryBytes: Number(msg.healthReport.memoryBytes),
  diskFreeBytes: Number(msg.healthReport.diskFreeBytes),
  timestamp: Number(msg.healthReport.timestamp),
  // new...
  loadAverage1m: msg.healthReport.loadAverage1m ?? 0,
  loadAverage5m: msg.healthReport.loadAverage5m ?? 0,
  loadAverage15m: msg.healthReport.loadAverage15m ?? 0,
  systemMemoryTotalBytes: Number(msg.healthReport.systemMemoryTotalBytes ?? 0),
  systemMemoryUsedBytes: Number(msg.healthReport.systemMemoryUsedBytes ?? 0),
  systemMemoryAvailableBytes: Number(msg.healthReport.systemMemoryAvailableBytes ?? 0),
  swapTotalBytes: Number(msg.healthReport.swapTotalBytes ?? 0),
  swapUsedBytes: Number(msg.healthReport.swapUsedBytes ?? 0),
  systemUptimeSeconds: Number(msg.healthReport.systemUptimeSeconds ?? 0),
  openFileDescriptors: Number(msg.healthReport.openFileDescriptors ?? 0),
  maxFileDescriptors: Number(msg.healthReport.maxFileDescriptors ?? 0),
  diskMounts: (msg.healthReport.diskMounts ?? []).map((m: any) => ({
    mountPoint: m.mountPoint,
    filesystem: m.filesystem,
    device: m.device,
    totalBytes: Number(m.totalBytes ?? 0),
    usedBytes: Number(m.usedBytes ?? 0),
    freeBytes: Number(m.freeBytes ?? 0),
    usagePercent: m.usagePercent ?? 0,
  })),
  diskReadBytes: Number(msg.healthReport.diskReadBytes ?? 0),
  diskWriteBytes: Number(msg.healthReport.diskWriteBytes ?? 0),
  networkInterfaces: (msg.healthReport.networkInterfaces ?? []).map((n: any) => ({
    name: n.name,
    rxBytes: Number(n.rxBytes ?? 0),
    txBytes: Number(n.txBytes ?? 0),
    rxPackets: Number(n.rxPackets ?? 0),
    txPackets: Number(n.txPackets ?? 0),
    rxErrors: Number(n.rxErrors ?? 0),
    txErrors: Number(n.txErrors ?? 0),
  })),
  nginxRssBytes: Number(msg.healthReport.nginxRssBytes ?? 0),
  errorRate4xx: msg.healthReport.errorRate4xx ?? 0,
  errorRate5xx: msg.healthReport.errorRate5xx ?? 0,
};
```

Use `healthData` for both `deps.registry.updateHealthReport()` and the DB persist.

- [ ] **Step 4: Extend frontend NodeHealthReport**

In `packages/frontend/src/types/index.ts`, extend `NodeHealthReport` with the same new fields (all `number`):

```typescript
export interface NodeHealthReport {
  // existing...
  nginxRunning: boolean;
  configValid: boolean;
  nginxUptimeSeconds: number;
  workerCount: number;
  nginxVersion: string;
  cpuPercent: number;
  memoryBytes: number;
  diskFreeBytes: number;
  timestamp: number;
  // new...
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  systemMemoryTotalBytes: number;
  systemMemoryUsedBytes: number;
  systemMemoryAvailableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  systemUptimeSeconds: number;
  openFileDescriptors: number;
  maxFileDescriptors: number;
  diskMounts: Array<{
    mountPoint: string;
    filesystem: string;
    device: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  }>;
  diskReadBytes: number;
  diskWriteBytes: number;
  networkInterfaces: Array<{
    name: string;
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
    rxErrors: number;
    txErrors: number;
  }>;
  nginxRssBytes: number;
  errorRate4xx: number;
  errorRate5xx: number;
}
```

---

## Task 5: Backend Node Monitoring SSE

**Files:**
- Create: `packages/backend/src/modules/nodes/node-monitoring.service.ts`
- Modify: `packages/backend/src/modules/nodes/nodes.routes.ts`
- Modify: `packages/backend/src/bootstrap.ts`

- [ ] **Step 1: Create NodeMonitoringService**

`packages/backend/src/modules/nodes/node-monitoring.service.ts`:

Service that:
- Maintains a history ring buffer (60 snapshots) per node
- Tracks SSE client count per node
- When clients > 0, sends `RequestHealth` + `RequestStats` commands at 5s intervals to the daemon
- When clients == 0, relies on the daemon's default 30s health reports
- Exposes `getHistory(nodeId)`, `registerClient(nodeId)`, `unregisterClient(nodeId)`
- Listens to registry health/stats updates and pushes to history

Follow the same pattern as `NginxStatsService` but per-node.

- [ ] **Step 2: Add SSE monitoring endpoint to nodes.routes.ts**

Add `GET /api/nodes/:id/monitoring/stream` (scope: `nodes:view`):

```typescript
nodesRoutes.get('/:id/monitoring/stream', requireScope('nodes:view'), async (c) => {
  const nodeId = c.req.param('id');
  // UUID validation...
  const monitoringService = container.resolve(NodeMonitoringService);

  return streamSSE(c, async (stream) => {
    monitoringService.registerClient(nodeId);

    const history = monitoringService.getHistory(nodeId);
    await stream.writeSSE({
      data: JSON.stringify({ connected: true, nodeId, history }),
      event: 'connected',
    });
    await stream.sleep(0);

    let running = true;
    stream.onAbort(() => {
      running = false;
      monitoringService.unregisterClient(nodeId);
    });

    // Listen for new snapshots
    const onSnapshot = (data: { nodeId: string; snapshot: any }) => {
      if (data.nodeId === nodeId) {
        stream.writeSSE({ data: JSON.stringify(data.snapshot), event: 'snapshot' }).catch(() => {});
      }
    };
    monitoringService.on('snapshot', onSnapshot);

    stream.onAbort(() => {
      monitoringService.off('snapshot', onSnapshot);
    });

    while (running) {
      await stream.sleep(5000);
      if (!running) break;
      // Request fresh data from daemon
      try {
        await monitoringService.requestSnapshot(nodeId);
      } catch {
        // Node may be offline
      }
    }
  });
});
```

- [ ] **Step 3: Register in bootstrap.ts**

```typescript
const nodeMonitoringService = new NodeMonitoringService(nodeRegistry, nodeDispatch);
container.registerInstance(NodeMonitoringService, nodeMonitoringService);
```

- [ ] **Step 4: Add API method in frontend api.ts**

```typescript
createNodeMonitoringStream(nodeId: string): EventSource {
  const sessionId = useAuthStore.getState().sessionId;
  const params = new URLSearchParams();
  if (sessionId) params.set("token", sessionId);
  return new EventSource(`${API_BASE}/nodes/${nodeId}/monitoring/stream?${params}`);
}
```

---

## Task 6: Frontend — Tab Layout + Details Tab

**Files:**
- Modify: `packages/frontend/src/pages/AdminNodeDetail.tsx` — slim down to tab container
- Create: `packages/frontend/src/pages/node-detail/NodeDetailsTab.tsx`

- [ ] **Step 1: Extract Details tab content**

Move the existing health/system/traffic cards, assigned proxy hosts, and metadata sections into `NodeDetailsTab.tsx` as a standalone component.

Props: `{ node: NodeDetail; proxyHosts: ProxyHost[]; health; stats; capabilities }`

- [ ] **Step 2: Restructure AdminNodeDetail with Tabs**

Use the existing `Tabs` component from `@/components/ui/tabs`. Three tabs: Details, Logs, Monitoring.

```tsx
<Tabs defaultValue="details" className="w-full">
  <TabsList>
    <TabsTrigger value="details">Details</TabsTrigger>
    <TabsTrigger value="logs">Logs</TabsTrigger>
    <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
  </TabsList>
  <TabsContent value="details">
    <NodeDetailsTab node={node} proxyHosts={proxyHosts} />
  </TabsContent>
  <TabsContent value="logs">
    <NodeLogsTab nodeId={node.id} nodeStatus={node.status} />
  </TabsContent>
  <TabsContent value="monitoring">
    <NodeMonitoringTab nodeId={node.id} nodeStatus={node.status} />
  </TabsContent>
</Tabs>
```

Header (name, edit, status badge, delete button) stays above the tabs.

---

## Task 7: Frontend — Logs Tab

**Files:**
- Create: `packages/frontend/src/pages/node-detail/NodeLogsTab.tsx`

- [ ] **Step 1: Implement logs tab with CodeEditor**

Use the existing `CodeEditor` component in readonly mode. Connect via SSE to `/api/nodes/:id/logs`. Accumulate log entries as text lines. Auto-scroll to bottom.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { CodeEditor } from "@/components/ui/code-editor";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/stores/auth";

export function NodeLogsTab({ nodeId, nodeStatus }: { nodeId: string; nodeStatus: string }) {
  const [logText, setLogText] = useState("");
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (nodeStatus !== "online") return;
    const sessionId = useAuthStore.getState().sessionId;
    const params = new URLSearchParams();
    if (sessionId) params.set("token", sessionId);
    const es = new EventSource(`/api/nodes/${nodeId}/logs?${params}`);
    esRef.current = es;

    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse(e.data);
        const line = `${entry.timestamp} [${entry.level.toUpperCase().padEnd(5)}] [${entry.component || "daemon"}] ${entry.message}`;
        setLogText((prev) => prev + (prev ? "\n" : "") + line);
      } catch {}
    });
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [nodeId, nodeStatus]);

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Daemon Logs</h3>
        <Badge variant={connected ? "success" : "secondary"}>
          {connected ? "Live" : nodeStatus === "online" ? "Connecting..." : "Offline"}
        </Badge>
      </div>
      <CodeEditor
        value={logText || "Waiting for daemon logs..."}
        onChange={() => {}}
        readOnly
        height="500px"
      />
    </div>
  );
}
```

---

## Task 8: Frontend — Monitoring Tab

**Files:**
- Create: `packages/frontend/src/pages/node-detail/NodeMonitoringTab.tsx`

- [ ] **Step 1: Implement monitoring tab**

Model after `NginxManagement.tsx` patterns. Connect to `/api/nodes/:id/monitoring/stream` via SSE. Display sections:

1. **CPU & Load** — CPU % sparkline, load averages (1m/5m/15m)
2. **Memory** — total/used/available bar + sparkline, swap usage
3. **Disk** — per-mount usage bars with % + sparkline for I/O
4. **Network** — per-interface RX/TX sparklines
5. **Nginx Process** — running status, workers, RSS, uptime, config valid
6. **Connections** — active/reading/writing/waiting sparklines (from StatsReport)
7. **Error Rates** — 4xx/5xx % sparklines

Use the existing `Sparkline` component from `@/components/ui/sparkline` (used in NginxManagement).

Key state:
```typescript
const [connected, setConnected] = useState(false);
const [snapshot, setSnapshot] = useState<any>(null);
const [history, setHistory] = useState<any[]>([]);
```

Each sparkline reads from `history.map(h => h.someMetric)`.

Helper functions: `formatBytes()`, `formatUptime()`, `formatPercent()` — reuse patterns from NginxManagement.

The component auto-connects on mount and disconnects on unmount. The SSE endpoint handles adaptive polling (5s when connected).

- [ ] **Step 2: Verify build**

```bash
cd packages/frontend && npx tsc --noEmit
cd packages/backend && npx tsc --noEmit
cd packages/daemons/nginx && CGO_ENABLED=0 go build ./...
```

---

## Verification

After all tasks:
1. Restart backend → verify gRPC server starts with TLS
2. Restart daemon → verify it connects and sends extended health reports
3. Open node detail → Details tab shows current info
4. Open Logs tab → CodeEditor shows buffered + live daemon logs
5. Open Monitoring tab → real-time charts updating at 5s intervals
6. Close Monitoring tab → daemon polling drops to 30s
