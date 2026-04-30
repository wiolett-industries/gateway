package docker

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	mobycontainer "github.com/moby/moby/api/types/container"
)

var dangerousSocketDirsExact = map[string]struct{}{
	"/run":     {},
	"/var/run": {},
}

var dangerousSocketRoots = map[string]struct{}{
	"/run/docker":      {},
	"/run/containerd":  {},
	"/run/snap.docker": {},
	"/var/snap/docker": {},
}

var dockerSocketTokens = []string{
	"docker",
	"dockerd",
	"containerd",
	"cri-dockerd",
	"podman",
	"nerdctl",
	"buildkit",
	"buildkitd",
}

func dockerSocketMountError(source string) error {
	return fmt.Errorf("DOCKER_SOCKET_MOUNT_FORBIDDEN: mounting Docker, containerd, or compatible daemon sockets into containers is not allowed: %s", source)
}

func matchesDangerousSocketDir(clean string) bool {
	if _, ok := dangerousSocketDirsExact[clean]; ok {
		return true
	}
	for dangerousRoot := range dangerousSocketRoots {
		if clean == dangerousRoot || strings.HasPrefix(clean, dangerousRoot+"/") {
			return true
		}
	}
	return false
}

func looksLikeDockerSocketPath(raw string) bool {
	clean := filepath.Clean(raw)
	if clean == "." || !filepath.IsAbs(clean) {
		return false
	}
	lower := strings.ToLower(clean)
	if matchesDangerousSocketDir(lower) {
		return true
	}
	base := filepath.Base(lower)
	if !strings.HasSuffix(base, ".sock") {
		return false
	}
	for _, token := range dockerSocketTokens {
		if strings.Contains(base, token) {
			return true
		}
	}
	return false
}

func pathIsDockerSocket(raw string) bool {
	if raw == "" || !filepath.IsAbs(raw) {
		return false
	}
	candidates := []string{raw}
	if resolved, err := filepath.EvalSymlinks(raw); err == nil && resolved != raw {
		candidates = append(candidates, resolved)
	}

	for _, candidate := range candidates {
		if looksLikeDockerSocketPath(candidate) {
			return true
		}
		info, err := os.Stat(candidate)
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSocket != 0 && looksLikeDockerSocketPath(filepath.Join(filepath.Dir(candidate), info.Name())) {
			return true
		}
		if info.IsDir() {
			lower := strings.ToLower(filepath.Clean(candidate))
			if matchesDangerousSocketDir(lower) {
				return true
			}
			entries, err := os.ReadDir(candidate)
			if err != nil {
				continue
			}
			for _, entry := range entries {
				child := filepath.Join(candidate, entry.Name())
				if looksLikeDockerSocketPath(child) {
					return true
				}
				childInfo, err := entry.Info()
				if err == nil && childInfo.Mode()&os.ModeSocket != 0 && looksLikeDockerSocketPath(child) {
					return true
				}
			}
		}
	}
	return false
}

func bindSource(bind string) string {
	parts := strings.Split(bind, ":")
	if len(parts) < 2 {
		return ""
	}
	source := strings.TrimSpace(parts[0])
	if filepath.IsAbs(source) {
		return source
	}
	return ""
}

func forbidDockerSocketBinds(binds []string) error {
	for _, bind := range binds {
		source := bindSource(bind)
		if source == "" {
			continue
		}
		if pathIsDockerSocket(source) {
			return dockerSocketMountError(source)
		}
	}
	return nil
}

func forbidDockerSocketMountPoints(mounts []mobycontainer.MountPoint) error {
	for _, mount := range mounts {
		if mount.Source == "" {
			continue
		}
		if pathIsDockerSocket(mount.Source) {
			return dockerSocketMountError(mount.Source)
		}
	}
	return nil
}

func forbidDeploymentSocketMounts(mounts []deploymentMount) error {
	for _, mount := range mounts {
		if mount.HostPath == "" {
			continue
		}
		if pathIsDockerSocket(mount.HostPath) {
			return dockerSocketMountError(mount.HostPath)
		}
	}
	return nil
}
