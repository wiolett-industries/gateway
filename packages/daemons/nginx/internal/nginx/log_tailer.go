package nginx

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type LogEntryParsed struct {
	HostID               string
	Timestamp            string
	RemoteAddr           string
	Method               string
	Path                 string
	Status               int
	BodyBytesSent        int64
	Referer              string
	UserAgent            string
	UpstreamResponseTime string
	Raw                  string
}

// combined log format regex
var logLineRegex = regexp.MustCompile(
	`^(\S+) - \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d+) (\d+) "([^"]*)" "([^"]*)"`,
)

// ParseLogLine parses a single nginx combined-format log line.
func ParseLogLine(hostID, line string) *LogEntryParsed {
	entry := &LogEntryParsed{
		HostID: hostID,
		Raw:    line,
	}

	matches := logLineRegex.FindStringSubmatch(line)
	if matches == nil {
		return entry
	}

	entry.RemoteAddr = matches[1]
	entry.Timestamp = matches[2]
	entry.Method = matches[3]
	entry.Path = matches[4]
	entry.Status, _ = strconv.Atoi(matches[5])
	entry.BodyBytesSent, _ = strconv.ParseInt(matches[6], 10, 64)
	entry.Referer = matches[7]
	entry.UserAgent = matches[8]

	// Try to extract upstream_response_time if present (custom format)
	if idx := strings.Index(line, "upstream_response_time="); idx >= 0 {
		rest := line[idx+len("upstream_response_time="):]
		if spIdx := strings.IndexAny(rest, " \t\n"); spIdx >= 0 {
			entry.UpstreamResponseTime = rest[:spIdx]
		} else {
			entry.UpstreamResponseTime = rest
		}
	}

	return entry
}

// TailFile tails a file and sends lines to the channel. Blocks until ctx is cancelled.
func TailFile(ctx context.Context, path string, lines chan<- string) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	defer f.Close()

	// Seek to end
	if _, err := f.Seek(0, 2); err != nil {
		return fmt.Errorf("seek to end: %w", err)
	}

	scanner := bufio.NewScanner(f)
	for {
		for scanner.Scan() {
			select {
			case <-ctx.Done():
				return nil
			case lines <- scanner.Text():
			}
		}
		// No more data — poll
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// TailLastN reads the last N lines of a file.
func TailLastN(path string, n int) ([]string, error) {
	if n <= 0 {
		return nil, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	allLines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(allLines) <= n {
		return allLines, nil
	}
	return allLines[len(allLines)-n:], nil
}

// ParseErrorLevel extracts the severity level from an nginx error log line.
// Format: "2024/01/15 10:30:45 [error] 1234#0: ..."
var errorLevelRe = regexp.MustCompile(`\[(emerg|alert|crit|error|warn|notice|info|debug)\]`)

func ParseErrorLevel(line string) string {
	m := errorLevelRe.FindStringSubmatch(line)
	if len(m) >= 2 {
		return m[1]
	}
	return "error"
}
