package docker

import (
	"testing"

	"github.com/moby/moby/api/types/container"
)

func TestApplyDeploymentRuntimeFromFormValues(t *testing.T) {
	hostCfg := &container.HostConfig{}

	applyDeploymentRuntime(hostCfg, deploymentDesiredConfig{
		RestartPolicy: "on-failure",
		Runtime: map[string]any{
			"maxRetries": "3",
			"memoryMB":   "128",
			"memSwapMB":  "256",
			"cpuCount":   "0.5",
			"cpuShares":  "512",
			"pidsLimit":  "64",
		},
	})

	if hostCfg.RestartPolicy.Name != "on-failure" {
		t.Fatalf("restart policy = %q", hostCfg.RestartPolicy.Name)
	}
	if hostCfg.RestartPolicy.MaximumRetryCount != 3 {
		t.Fatalf("max retries = %d", hostCfg.RestartPolicy.MaximumRetryCount)
	}
	if hostCfg.Memory != 128*1048576 {
		t.Fatalf("memory = %d", hostCfg.Memory)
	}
	if hostCfg.MemorySwap != (128+256)*1048576 {
		t.Fatalf("memory swap = %d", hostCfg.MemorySwap)
	}
	if hostCfg.NanoCPUs != 500000000 {
		t.Fatalf("nano cpus = %d", hostCfg.NanoCPUs)
	}
	if hostCfg.CPUShares != 512 {
		t.Fatalf("cpu shares = %d", hostCfg.CPUShares)
	}
	if hostCfg.PidsLimit == nil || *hostCfg.PidsLimit != 64 {
		t.Fatalf("pids limit = %v", hostCfg.PidsLimit)
	}
}

func TestApplyDeploymentRuntimeFromNormalizedValues(t *testing.T) {
	hostCfg := &container.HostConfig{}

	applyDeploymentRuntime(hostCfg, deploymentDesiredConfig{
		Runtime: map[string]any{
			"restartPolicy": "always",
			"memoryLimit":   float64(67108864),
			"memorySwap":    float64(-1),
			"nanoCPUs":      float64(250000000),
		},
	})

	if hostCfg.RestartPolicy.Name != "always" {
		t.Fatalf("restart policy = %q", hostCfg.RestartPolicy.Name)
	}
	if hostCfg.Memory != 67108864 {
		t.Fatalf("memory = %d", hostCfg.Memory)
	}
	if hostCfg.MemorySwap != -1 {
		t.Fatalf("memory swap = %d", hostCfg.MemorySwap)
	}
	if hostCfg.NanoCPUs != 250000000 {
		t.Fatalf("nano cpus = %d", hostCfg.NanoCPUs)
	}
}
