package sysmetrics

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// SystemMemory holds structured memory information from /proc/meminfo.
type SystemMemory struct {
	TotalBytes     int64
	UsedBytes      int64
	AvailableBytes int64
	SwapTotalBytes int64
	SwapUsedBytes  int64
}

// GetSystemMemory reads /proc/meminfo and returns structured memory info.
func GetSystemMemory() SystemMemory {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return SystemMemory{}
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

	return SystemMemory{
		TotalBytes:     totalKB * 1024,
		UsedBytes:      (totalKB - availableKB) * 1024,
		AvailableBytes: availableKB * 1024,
		SwapTotalBytes: swapTotalKB * 1024,
		SwapUsedBytes:  (swapTotalKB - swapFreeKB) * 1024,
	}
}
