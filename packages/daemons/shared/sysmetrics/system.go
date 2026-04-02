package sysmetrics

import (
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// GetLoadAverages reads /proc/loadavg and returns 1m, 5m, 15m averages.
func GetLoadAverages() (float64, float64, float64) {
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

// GetSystemUptime reads /proc/uptime and returns system uptime in seconds.
func GetSystemUptime() int64 {
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

// GetFileDescriptors returns open FDs for this process and system max.
func GetFileDescriptors() (int64, int64) {
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

// GetArchitecture returns the system architecture (e.g., x86_64, aarch64).
func GetArchitecture() string {
	var uname unix.Utsname
	if err := unix.Uname(&uname); err != nil {
		return ""
	}
	return strings.TrimRight(string(uname.Machine[:]), "\x00")
}

// GetKernelVersion returns the kernel version string.
func GetKernelVersion() string {
	var uname unix.Utsname
	if err := unix.Uname(&uname); err != nil {
		return ""
	}
	return strings.TrimRight(string(uname.Release[:]), "\x00")
}
