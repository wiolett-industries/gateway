package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"

	"github.com/wiolett-industries/gateway/daemon-shared/lifecycle"
	"github.com/wiolett-industries/gateway/docker-daemon/internal/config"
	"github.com/wiolett-industries/gateway/docker-daemon/internal/docker"
)

// Version is set via -ldflags at build time; falls back to "dev".
var Version = "dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version":
			fmt.Printf("docker-daemon %s\n", Version)
			return
		case "install":
			runInstall()
			return
		case "run":
			// explicit run, continue below
		default:
			fmt.Fprintf(os.Stderr, "Usage: docker-daemon [run|install|version]\n")
			os.Exit(1)
		}
	}

	// Default: run the daemon
	configPath := os.Getenv("DOCKER_DAEMON_CONFIG")
	if configPath == "" {
		configPath = "/etc/docker-daemon/config.yaml"
	}

	logger := setupLogger("info", "json")

	cfg, err := config.Load(configPath)
	if err != nil {
		logger.Error("failed to load config", "path", configPath, "error", err)
		os.Exit(1)
	}

	logger = setupLogger(cfg.LogLevel, cfg.LogFormat)
	logger.Info("starting docker-daemon", "version", Version, "config", configPath)

	// Set shared lifecycle version
	lifecycle.Version = Version

	plugin := docker.NewDockerPlugin(cfg)

	d, err := lifecycle.NewDaemonBase(&cfg.BaseConfig, configPath, plugin, logger)
	if err != nil {
		logger.Error("failed to initialize daemon", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		sig := <-sigCh
		logger.Info("received signal, shutting down", "signal", sig)
		cancel()
	}()

	if err := d.Run(ctx); err != nil {
		logger.Error("daemon exited with error", "error", err)
		os.Exit(1)
	}
}

func setupLogger(level, format string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{Level: lvl}

	var handler slog.Handler
	if format == "text" {
		handler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	}

	return slog.New(handler)
}

func runInstall() {
	if len(os.Args) < 4 {
		fmt.Fprintf(os.Stderr, "Usage: docker-daemon install --gateway <address> --token <token> [--docker-socket <host>]\n")
		os.Exit(1)
	}

	var address, token, dockerSocket string
	for i := 2; i < len(os.Args)-1; i++ {
		switch os.Args[i] {
		case "--gateway":
			address = os.Args[i+1]
		case "--token":
			token = os.Args[i+1]
		case "--docker-socket":
			dockerSocket = os.Args[i+1]
		}
	}

	if address == "" || token == "" {
		fmt.Fprintf(os.Stderr, "Both --gateway and --token are required\n")
		os.Exit(1)
	}

	configDir := "/etc/docker-daemon"
	configPath := configDir + "/config.yaml"
	if dockerSocket == "" {
		dockerSocket = detectDockerSocket()
	}

	if err := os.MkdirAll(configDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create config dir: %v\n", err)
		os.Exit(1)
	}

	configContent := fmt.Sprintf(`gateway:
  address: "%s"
  token: "%s"

tls:
  ca_cert: "/etc/docker-daemon/certs/ca.pem"
  client_cert: "/etc/docker-daemon/certs/node.pem"
  client_key: "/etc/docker-daemon/certs/node-key.pem"

state_dir: "/var/lib/docker-daemon"
log_level: "info"
log_format: "json"

docker:
  socket: %q
  allowlist: ["*"]
`, address, token, dockerSocket)

	if err := os.WriteFile(configPath, []byte(configContent), 0600); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write config: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Config written to %s\n", configPath)

	// Create systemd service unit
	serviceContent := dockerDaemonSystemdUnit()
	servicePath := "/etc/systemd/system/docker-daemon.service"
	if err := os.WriteFile(servicePath, []byte(serviceContent), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to write systemd unit: %v\n", err)
		fmt.Println("You can start the daemon manually: docker-daemon run")
	} else {
		fmt.Printf("Systemd service written to %s\n", servicePath)
		fmt.Println("Enable and start: systemctl enable --now docker-daemon")
	}
}

func detectDockerSocket() string {
	out, err := exec.Command("docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").Output()
	if err == nil {
		host := strings.TrimSpace(string(out))
		if host != "" && host != "<no value>" {
			return host
		}
	}
	return "unix:///var/run/docker.sock"
}

func dockerDaemonSystemdUnit() string {
	return dockerDaemonSystemdUnitForDockerUnit(detectDockerSystemdUnit())
}

func dockerDaemonSystemdUnitForDockerUnit(unit string) string {
	after := "network-online.target"
	wants := "network-online.target"
	if unit != "" {
		after += " " + unit
		wants += " " + unit
	}
	return fmt.Sprintf(`[Unit]
Description=Gateway Docker Daemon
After=%s
Wants=%s

[Service]
Type=simple
ExecStart=/usr/local/bin/docker-daemon run
Restart=always
RestartSec=5
Environment=DOCKER_DAEMON_CONFIG=/etc/docker-daemon/config.yaml

[Install]
WantedBy=multi-user.target
`, after, wants)
}

func detectDockerSystemdUnit() string {
	for _, unit := range []string{"docker.service", "snap.docker.dockerd.service"} {
		if systemdUnitExists(unit) {
			return unit
		}
	}
	return ""
}

func systemdUnitExists(unit string) bool {
	if err := exec.Command("systemctl", "cat", unit).Run(); err == nil {
		return true
	}
	out, err := exec.Command("systemctl", "list-unit-files", "--type=service", "--no-legend", unit).Output()
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) > 0 && fields[0] == unit {
			return true
		}
	}
	return false
}
