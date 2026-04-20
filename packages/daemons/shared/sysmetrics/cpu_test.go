package sysmetrics

import "testing"

func TestCalculateCPUPercentFromDeltas(t *testing.T) {
	got := calculateCPUPercentFromDeltas(40, 100)
	if got != 60 {
		t.Fatalf("expected 60, got %.2f", got)
	}
}

func TestCalculateCPUPercentFromDeltasRejectsInvalidDeltas(t *testing.T) {
	got := calculateCPUPercentFromDeltas(120, 100)
	if got != 0 {
		t.Fatalf("expected 0, got %.2f", got)
	}
}
