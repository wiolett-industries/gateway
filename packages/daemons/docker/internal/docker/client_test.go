package docker

import (
	"encoding/json"
	"testing"

	"github.com/moby/moby/api/types/container"
	imagetypes "github.com/moby/moby/api/types/image"
)

func TestContainerCreateConfigParsesRestartPolicyFromCamelCase(t *testing.T) {
	var cfg ContainerCreateConfig
	if err := json.Unmarshal([]byte(`{"image":"nginx:latest","restartPolicy":"always"}`), &cfg); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	if cfg.RestartPolicy != "always" {
		t.Fatalf("restart policy = %q", cfg.RestartPolicy)
	}
	if cfg.effectiveRestartPolicy() != "always" {
		t.Fatalf("effective restart policy = %q", cfg.effectiveRestartPolicy())
	}
}

func TestContainerCreateConfigKeepsLegacyRestartPolicyAlias(t *testing.T) {
	var cfg ContainerCreateConfig
	if err := json.Unmarshal([]byte(`{"image":"nginx:latest","restart_policy":"unless-stopped"}`), &cfg); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	if cfg.RestartPolicyLegacy != "unless-stopped" {
		t.Fatalf("legacy restart policy = %q", cfg.RestartPolicyLegacy)
	}
	if cfg.effectiveRestartPolicy() != "unless-stopped" {
		t.Fatalf("effective restart policy = %q", cfg.effectiveRestartPolicy())
	}
}

func TestApplyNanoCPULimitClearsQuotaPeriod(t *testing.T) {
	resources := container.Resources{
		CPUPeriod: 100000,
		CPUQuota:  200000,
	}

	applyNanoCPULimit(&resources, 500000000)

	if resources.NanoCPUs != 500000000 {
		t.Fatalf("expected NanoCPUs 500000000, got %d", resources.NanoCPUs)
	}
	if resources.CPUPeriod != 0 {
		t.Fatalf("expected CPUPeriod to be cleared, got %d", resources.CPUPeriod)
	}
	if resources.CPUQuota != 0 {
		t.Fatalf("expected CPUQuota to be cleared, got %d", resources.CPUQuota)
	}
}

func TestApplyNanoCPULimitClearsAllCpuLimits(t *testing.T) {
	resources := container.Resources{
		NanoCPUs:  1000000000,
		CPUPeriod: 100000,
		CPUQuota:  100000,
	}

	applyNanoCPULimit(&resources, 0)

	if resources.NanoCPUs != 0 {
		t.Fatalf("expected NanoCPUs to be cleared, got %d", resources.NanoCPUs)
	}
	if resources.CPUPeriod != 0 {
		t.Fatalf("expected CPUPeriod to be cleared, got %d", resources.CPUPeriod)
	}
	if resources.CPUQuota != 0 {
		t.Fatalf("expected CPUQuota to be cleared, got %d", resources.CPUQuota)
	}
}

func TestAnnotateImageUsageMatchesByImageID(t *testing.T) {
	images := []imagetypes.Summary{
		{ID: "sha256:busybox", RepoTags: []string{"busybox:latest"}, Containers: -1},
		{ID: "sha256:nginx", RepoTags: []string{"nginx:latest"}, Containers: -1},
	}
	containers := []container.Summary{
		{ImageID: "sha256:busybox", Image: "busybox:latest"},
	}

	result := annotateImageUsage(images, containers)

	if result[0].Containers != 1 {
		t.Fatalf("expected busybox usage count 1, got %d", result[0].Containers)
	}
	if result[1].Containers != 0 {
		t.Fatalf("expected nginx usage count 0, got %d", result[1].Containers)
	}
}

func TestAnnotateImageUsageMatchesByRepoTagWhenImageIDMissing(t *testing.T) {
	images := []imagetypes.Summary{
		{ID: "sha256:busybox", RepoTags: []string{"busybox:latest"}, Containers: -1},
	}
	containers := []container.Summary{
		{Image: "busybox:latest"},
	}

	result := annotateImageUsage(images, containers)

	if result[0].Containers != 1 {
		t.Fatalf("expected busybox usage count 1, got %d", result[0].Containers)
	}
}
