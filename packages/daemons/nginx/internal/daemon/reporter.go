package daemon

import (
	"log/slog"
	"path/filepath"

	pb "github.com/wiolett-industries/gateway/daemon-shared/gatewayv1"
	"github.com/wiolett-industries/gateway/nginx-daemon/internal/config"
	"github.com/wiolett-industries/gateway/nginx-daemon/internal/nginx"
)

// Reporter collects nginx-specific metrics.
// System-level metrics are delegated to sysmetrics.SystemReporter in the shared module.
type Reporter struct {
	cfg    *config.Config
	mgr    *nginx.Manager
	logger *slog.Logger
}

func NewReporter(cfg *config.Config, mgr *nginx.Manager, logger *slog.Logger) *Reporter {
	return &Reporter{cfg: cfg, mgr: mgr, logger: logger}
}

// CollectHealth enriches a base health report with nginx-specific metrics.
// The base report already contains system-level metrics from sysmetrics.SystemReporter.
func (r *Reporter) CollectHealth(base *pb.HealthReport) *pb.HealthReport {
	if base == nil {
		base = &pb.HealthReport{}
	}

	base.NginxRunning = r.mgr.IsRunning()

	valid, _ := r.mgr.TestConfig()
	base.ConfigValid = valid

	if uptime, err := r.mgr.GetUptime(); err == nil {
		base.NginxUptimeSeconds = int64(uptime.Seconds())
	}

	if workers, err := r.mgr.GetWorkerCount(); err == nil {
		base.WorkerCount = int32(workers)
	}

	if version, err := r.mgr.GetVersion(); err == nil {
		base.NginxVersion = version
	}

	// Nginx RSS
	base.NginxRssBytes = r.mgr.GetProcessRSS()

	// Error rates
	base.ErrorRate_4Xx, base.ErrorRate_5Xx = r.getErrorRates()

	return base
}

// CollectStats returns nginx stub_status metrics.
func (r *Reporter) CollectStats() *pb.StatsReport {
	report := &pb.StatsReport{}

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
