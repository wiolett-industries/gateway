package docker

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	mobycontainer "github.com/moby/moby/api/types/container"
)

func TestForbidDockerSocketBindsBlocksKnownSocketPaths(t *testing.T) {
	binds := []string{
		"/var/run/docker.sock:/var/run/docker.sock",
		"/run/snap.docker/dockerd.sock:/docker.sock:ro",
		"/var/snap/docker/current/run/dockerd.sock:/docker.sock:ro",
	}

	for _, bind := range binds {
		if err := forbidDockerSocketBinds([]string{bind}); err == nil {
			t.Fatalf("expected bind %q to be rejected", bind)
		}
	}
}

func TestForbidDockerSocketBindsBlocksSocketDirectoryAncestors(t *testing.T) {
	binds := []string{
		"/var/snap/docker:/snap-docker",
		"/var/snap/docker/current:/snap-docker-current",
		"/var/snap/docker/current/run:/snap-docker-run",
		"/run/containerd:/containerd",
	}

	for _, bind := range binds {
		if err := forbidDockerSocketBinds([]string{bind}); err == nil {
			t.Fatalf("expected bind %q to be rejected", bind)
		}
	}
}

func TestForbidDockerSocketBindsAllowsOrdinaryRunDescendants(t *testing.T) {
	binds := []string{
		"/run/secrets:/run-secrets:ro",
		"/run/app/app.sock:/app/app.sock",
		"/run/docker-data:/docker-data",
		"/var/run/app:/app-run",
	}

	for _, bind := range binds {
		if err := forbidDockerSocketBinds([]string{bind}); err != nil {
			t.Fatalf("expected bind %q to be allowed, got %v", bind, err)
		}
	}
}

func TestForbidDockerSocketBindsBlocksExistingSocketWithDockerName(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "dockersock")
	if err != nil {
		t.Fatalf("create temp dir: %v", err)
	}
	defer os.RemoveAll(dir)
	socketPath := filepath.Join(dir, "dockerd.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen unix socket: %v", err)
	}
	defer listener.Close()

	if err := forbidDockerSocketBinds([]string{socketPath + ":/app/d.sock"}); err == nil {
		t.Fatal("expected unix Docker-compatible socket bind to be rejected")
	}
}

func TestForbidDockerSocketBindsAllowsOrdinaryBind(t *testing.T) {
	if err := forbidDockerSocketBinds([]string{"/srv/app/data:/data:ro"}); err != nil {
		t.Fatalf("expected ordinary bind to be allowed, got %v", err)
	}
}

func TestForbidDockerSocketMountPointsBlocksKnownSocketPaths(t *testing.T) {
	mounts := []mobycontainer.MountPoint{
		{Source: "/var/run/docker.sock", Destination: "/docker.sock"},
	}

	if err := forbidDockerSocketMountPoints(mounts); err == nil {
		t.Fatal("expected Docker socket mount point to be rejected")
	}
}

func TestForbidDeploymentSocketMountsBlocksKnownSocketPaths(t *testing.T) {
	mounts := []deploymentMount{
		{HostPath: "/run/containerd/containerd.sock", ContainerPath: "/containerd.sock"},
	}

	if err := forbidDeploymentSocketMounts(mounts); err == nil {
		t.Fatal("expected deployment socket mount to be rejected")
	}
}

func TestForbidDeploymentSocketMountsAllowsNamedVolumes(t *testing.T) {
	mounts := []deploymentMount{
		{Name: "app-data", ContainerPath: "/data"},
		{HostPath: "/srv/app/config", ContainerPath: "/config", ReadOnly: true},
	}

	if err := forbidDeploymentSocketMounts(mounts); err != nil {
		t.Fatalf("expected ordinary deployment mounts to be allowed, got %v", err)
	}
}
