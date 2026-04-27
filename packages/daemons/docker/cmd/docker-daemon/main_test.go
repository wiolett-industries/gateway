package main

import (
	"strings"
	"testing"
)

func TestDockerDaemonSystemdUnitDoesNotHardRequireDocker(t *testing.T) {
	unit := dockerDaemonSystemdUnitForDockerUnit("snap.docker.dockerd.service")

	if strings.Contains(unit, "Requires=snap.docker.dockerd.service") {
		t.Fatalf("unit must not hard-require Docker service:\n%s", unit)
	}
	if !strings.Contains(unit, "After=network-online.target snap.docker.dockerd.service") {
		t.Fatalf("unit should still order after Docker service:\n%s", unit)
	}
	if !strings.Contains(unit, "Wants=network-online.target snap.docker.dockerd.service") {
		t.Fatalf("unit should still want Docker service:\n%s", unit)
	}
}
