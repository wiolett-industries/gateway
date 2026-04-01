package nginx

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type StubStatus struct {
	ActiveConnections int64
	Accepts           int64
	Handled           int64
	Requests          int64
	Reading           int
	Writing           int
	Waiting           int
}

// FetchStubStatus fetches and parses nginx stub_status.
func FetchStubStatus(url string) (*StubStatus, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("fetch stub_status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stub_status returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read stub_status body: %w", err)
	}

	return parseStubStatus(string(body))
}

// parseStubStatus parses the nginx stub_status output format:
//
//	Active connections: 1
//	server accepts handled requests
//	 10 10 20
//	Reading: 0 Writing: 1 Waiting: 0
func parseStubStatus(body string) (*StubStatus, error) {
	s := &StubStatus{}
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if len(lines) < 4 {
		return nil, fmt.Errorf("unexpected stub_status format: got %d lines", len(lines))
	}

	// Line 0: "Active connections: N"
	if parts := strings.Fields(lines[0]); len(parts) >= 3 {
		s.ActiveConnections, _ = strconv.ParseInt(parts[2], 10, 64)
	}

	// Line 2: " accepts handled requests" values
	if parts := strings.Fields(lines[2]); len(parts) >= 3 {
		s.Accepts, _ = strconv.ParseInt(parts[0], 10, 64)
		s.Handled, _ = strconv.ParseInt(parts[1], 10, 64)
		s.Requests, _ = strconv.ParseInt(parts[2], 10, 64)
	}

	// Line 3: "Reading: 0 Writing: 1 Waiting: 0"
	if parts := strings.Fields(lines[3]); len(parts) >= 6 {
		s.Reading, _ = strconv.Atoi(parts[1])
		s.Writing, _ = strconv.Atoi(parts[3])
		s.Waiting, _ = strconv.Atoi(parts[5])
	}

	return s, nil
}
