package docker

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/moby/moby/client"
)

// FileEntry describes a single file or directory inside a container.
type FileEntry struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	Permissions string `json:"permissions"`
	IsDir       bool   `json:"isDir"`
	Modified    string `json:"modified"`
	IsSymlink   bool   `json:"isSymlink,omitempty"`
	LinkTarget  string `json:"linkTarget,omitempty"`
	IsSpecial   bool   `json:"isSpecial,omitempty"` // char/block device, socket, pipe
	IsWritable  bool   `json:"isWritable,omitempty"`
}

// ListDir lists the contents of a directory inside a container.
// The path must be absolute and must not contain "..".
func ListDir(ctx context.Context, c *Client, containerID string, path string) ([]FileEntry, error) {
	if err := validatePath(path); err != nil {
		return nil, err
	}

	// Use plain ls -la (works on GNU, BusyBox, Alpine, etc.)
	stdout, err := execInContainer(ctx, c, containerID, []string{"ls", "-la", path})
	if err != nil {
		return nil, fmt.Errorf("list dir: %w", err)
	}

	return parseLsOutput(stdout), nil
}

// ReadFile reads up to maxBytes of a regular file from inside a container.
// Rejects special files (devices, sockets, pipes, symlinks) that could hang or crash.
func ReadFile(ctx context.Context, c *Client, containerID string, path string, maxBytes int64) ([]byte, error) {
	if err := validatePath(path); err != nil {
		return nil, err
	}

	if maxBytes <= 0 {
		maxBytes = 1024 * 1024 // 1MB default
	}

	// Check that the target is a regular, readable file (not a device, socket, pipe, etc.)
	checkCtx, checkCancel := context.WithTimeout(ctx, 5*time.Second)
	defer checkCancel()
	if _, err := execInContainer(checkCtx, c, containerID, []string{"test", "-f", path}); err != nil {
		return nil, fmt.Errorf("not a regular/readable file: %s", path)
	}
	if _, err := execInContainer(checkCtx, c, containerID, []string{"test", "-r", path}); err != nil {
		return nil, fmt.Errorf("not a regular/readable file: %s", path)
	}

	// Read with a timeout to prevent hangs on special files that slip through
	readCtx, readCancel := context.WithTimeout(ctx, 10*time.Second)
	defer readCancel()
	stdout, err := execInContainer(readCtx, c, containerID, []string{"head", "-c", strconv.FormatInt(maxBytes, 10), path})
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	return []byte(stdout), nil
}

// WriteFile writes content to a regular, writable file inside a container.
// Content is sent on stdin and the target path is passed as argv so it is never interpreted by a shell.
func WriteFile(ctx context.Context, c *Client, containerID string, path string, content []byte) error {
	if err := validatePath(path); err != nil {
		return err
	}

	// Check that the target is a regular, writable file
	checkCtx, checkCancel := context.WithTimeout(ctx, 5*time.Second)
	defer checkCancel()
	if _, err := execInContainer(checkCtx, c, containerID, []string{"test", "-f", path}); err != nil {
		return fmt.Errorf("file is not writable: %s", path)
	}
	if _, err := execInContainer(checkCtx, c, containerID, []string{"test", "-w", path}); err != nil {
		return fmt.Errorf("file is not writable: %s", path)
	}

	writeCtx, writeCancel := context.WithTimeout(ctx, 30*time.Second)
	defer writeCancel()

	if _, err := execInContainerWithInput(writeCtx, c, containerID, dockerWriteFileCommand(path), content); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}

func dockerWriteFileCommand(path string) []string {
	return []string{"dd", "of=" + path, "bs=65536"}
}

// validatePath ensures the path is absolute and does not contain path traversal.
func validatePath(path string) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}
	if !filepath.IsAbs(path) {
		return fmt.Errorf("path must be absolute: %s", path)
	}
	cleaned := filepath.Clean(path)
	if strings.Contains(cleaned, "..") {
		return fmt.Errorf("path must not contain '..': %s", path)
	}
	return nil
}

// execInContainer runs a command inside a container and returns stdout as a string.
// Returns an error if the command exits with a non-zero status.
func execInContainer(ctx context.Context, c *Client, containerID string, cmd []string) (string, error) {
	createResult, err := c.cli.ExecCreate(ctx, containerID, client.ExecCreateOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return "", fmt.Errorf("exec create: %w", err)
	}

	attachResult, err := c.cli.ExecAttach(ctx, createResult.ID, client.ExecAttachOptions{})
	if err != nil {
		return "", fmt.Errorf("exec attach: %w", err)
	}
	defer attachResult.Close()

	// Read all output with size limit to prevent OOM on unexpected large output.
	// The 8-byte Docker multiplex header per frame is stripped below.
	const maxRead = 10 * 1024 * 1024 // 10MB safety limit
	raw, err := io.ReadAll(io.LimitReader(attachResult.Reader, maxRead))
	if err != nil {
		return "", fmt.Errorf("exec read: %w", err)
	}

	// Strip Docker stream headers (8-byte header per frame: [stream_type(1)][padding(3)][size(4)])
	var stdoutBuf, stderrBuf bytes.Buffer
	data := raw
	for len(data) >= 8 {
		streamType := data[0]
		frameSize := int(data[4])<<24 | int(data[5])<<16 | int(data[6])<<8 | int(data[7])
		data = data[8:]
		if frameSize > len(data) {
			frameSize = len(data)
		}
		if streamType == 2 {
			stderrBuf.Write(data[:frameSize])
		} else {
			stdoutBuf.Write(data[:frameSize])
		}
		data = data[frameSize:]
	}

	// Check exit code
	inspResult, inspErr := c.cli.ExecInspect(ctx, createResult.ID, client.ExecInspectOptions{})
	if inspErr == nil && inspResult.ExitCode != 0 {
		errMsg := strings.TrimSpace(stderrBuf.String())
		if errMsg == "" {
			errMsg = strings.TrimSpace(stdoutBuf.String())
		}
		if errMsg == "" {
			errMsg = fmt.Sprintf("command exited with code %d", inspResult.ExitCode)
		}
		return "", fmt.Errorf("%s", errMsg)
	}

	return stdoutBuf.String(), nil
}

func execInContainerWithInput(ctx context.Context, c *Client, containerID string, cmd []string, input []byte) (string, error) {
	createResult, err := c.cli.ExecCreate(ctx, containerID, client.ExecCreateOptions{
		Cmd:          cmd,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
	})
	if err != nil {
		return "", fmt.Errorf("exec create: %w", err)
	}

	attachResult, err := c.cli.ExecAttach(ctx, createResult.ID, client.ExecAttachOptions{})
	if err != nil {
		return "", fmt.Errorf("exec attach: %w", err)
	}
	defer attachResult.Close()

	writeErr := make(chan error, 1)
	go func() {
		_, err := attachResult.Conn.Write(input)
		if closeErr := attachResult.CloseWrite(); err == nil {
			err = closeErr
		}
		writeErr <- err
	}()

	const maxRead = 10 * 1024 * 1024
	raw, readErr := io.ReadAll(io.LimitReader(attachResult.Reader, maxRead))
	if err := <-writeErr; err != nil {
		return "", fmt.Errorf("exec write: %w", err)
	}
	if readErr != nil {
		return "", fmt.Errorf("exec read: %w", readErr)
	}

	stdout, stderr := splitDockerStream(raw)
	inspResult, inspErr := c.cli.ExecInspect(ctx, createResult.ID, client.ExecInspectOptions{})
	if inspErr == nil && inspResult.ExitCode != 0 {
		errMsg := strings.TrimSpace(stderr)
		if errMsg == "" {
			errMsg = strings.TrimSpace(stdout)
		}
		if errMsg == "" {
			errMsg = fmt.Sprintf("command exited with code %d", inspResult.ExitCode)
		}
		return "", fmt.Errorf("%s", errMsg)
	}

	return stdout, nil
}

func splitDockerStream(raw []byte) (string, string) {
	var stdoutBuf, stderrBuf bytes.Buffer
	data := raw
	for len(data) >= 8 {
		streamType := data[0]
		frameSize := int(data[4])<<24 | int(data[5])<<16 | int(data[6])<<8 | int(data[7])
		data = data[8:]
		if frameSize > len(data) {
			frameSize = len(data)
		}
		if streamType == 2 {
			stderrBuf.Write(data[:frameSize])
		} else {
			stdoutBuf.Write(data[:frameSize])
		}
		data = data[frameSize:]
	}
	return stdoutBuf.String(), stderrBuf.String()
}

// parseLsOutput parses the output of `ls -la --time-style=long-iso` into FileEntry structs.
// Example line: "drwxr-xr-x  2 root root 4096 2024-01-15 10:30 dirname"
func parseLsOutput(output string) []FileEntry {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	entries := make([]FileEntry, 0, len(lines))

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Skip the "total N" line
		if strings.HasPrefix(line, "total ") {
			continue
		}

		entry := parseLsLine(line)
		if entry == nil {
			continue
		}
		// Skip "." and ".." entries
		if entry.Name == "." || entry.Name == ".." {
			continue
		}
		entries = append(entries, *entry)
	}

	return entries
}

// parseLsLine parses a single line of ls -la output.
// Handles both GNU and BusyBox formats:
//
//	GNU:     -rw-r--r--  1 root root 12345 2024-01-15 10:30 filename.txt
//	BusyBox: -rw-r--r--  1 root root 12345 Apr  1 01:10 filename.txt
func parseLsLine(line string) *FileEntry {
	fields := strings.Fields(line)
	if len(fields) < 8 {
		return nil
	}

	permissions := fields[0]
	// Skip non-permission lines (e.g. "total 68" already filtered, but guard)
	if len(permissions) < 2 || !strings.ContainsAny(string(permissions[0]), "dlcbps-") {
		return nil
	}
	isDir := permissions[0] == 'd'

	size, _ := strconv.ParseInt(fields[4], 10, 64)

	// Determine where the filename starts.
	// Fields: 0=perms, 1=links, 2=owner, 3=group, 4=size, then date/time, then name.
	// BusyBox: "Apr  1 01:10" = 3 fields (5,6,7) → name starts at 8
	// GNU:     "2024-01-15 10:30" = 2 fields (5,6) → name starts at 7
	// Detect by checking if field[5] looks like a year (YYYY-MM-DD)
	nameStart := 8
	var modified string
	if len(fields[5]) == 10 && fields[5][4] == '-' {
		// GNU format: "2024-01-15 10:30"
		modified = fields[5] + " " + fields[6]
		nameStart = 7
	} else {
		// BusyBox format: "Apr  1 01:10" or "Apr  1  2024"
		if len(fields) < 9 {
			// Might be short — 8 fields with name at [8] doesn't exist
			// Try with nameStart=8 but check bounds
			modified = strings.Join(fields[5:8], " ")
			nameStart = 8
		} else {
			modified = strings.Join(fields[5:8], " ")
			nameStart = 8
		}
	}

	if nameStart >= len(fields) {
		return nil
	}

	// The name is everything from nameStart onwards (may contain spaces)
	name := strings.Join(fields[nameStart:], " ")

	isSymlink := permissions[0] == 'l'
	// Special files: char device (c), block device (b), socket (s), pipe (p)
	isSpecial := permissions[0] == 'c' || permissions[0] == 'b' || permissions[0] == 's' || permissions[0] == 'p'
	// Writable if owner, group, or other has write permission
	isWritable := len(permissions) >= 9 && (permissions[2] == 'w' || permissions[5] == 'w' || permissions[8] == 'w')
	var linkTarget string

	// Handle symlinks: "name -> target"
	if idx := strings.Index(name, " -> "); idx >= 0 {
		linkTarget = name[idx+4:]
		name = name[:idx]
	}

	return &FileEntry{
		Name:        name,
		Size:        size,
		Permissions: permissions,
		IsDir:       isDir,
		Modified:    modified,
		IsSymlink:   isSymlink,
		LinkTarget:  linkTarget,
		IsSpecial:   isSpecial,
		IsWritable:  isWritable && !isDir && !isSpecial && !isSymlink,
	}
}
