package sysmetrics

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// CPUState holds delta-based CPU metric state.
type CPUState struct {
	PrevIdle  uint64
	PrevTotal uint64
}

// GetCPUPercent reads /proc/stat and computes CPU usage from deltas.
// The caller must ensure concurrent access to CPUState is synchronized.
func GetCPUPercent(state *CPUState) float64 {
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
	idleDelta := idle - state.PrevIdle
	totalDelta := total - state.PrevTotal
	state.PrevIdle = idle
	state.PrevTotal = total
	if totalDelta == 0 {
		return 0
	}
	return float64(totalDelta-idleDelta) / float64(totalDelta) * 100.0
}

// GetCPUInfo reads /proc/cpuinfo and returns the CPU model name and core count.
func GetCPUInfo() (model string, cores int) {
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return "", 0
	}
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 && model == "" {
				model = strings.TrimSpace(parts[1])
			}
		}
		if strings.HasPrefix(line, "processor") {
			cores++
		}
	}
	return model, cores
}
