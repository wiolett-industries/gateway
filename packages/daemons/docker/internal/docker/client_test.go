package docker

import (
	"testing"

	"github.com/moby/moby/api/types/container"
)

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
