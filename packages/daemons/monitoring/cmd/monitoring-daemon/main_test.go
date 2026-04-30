package main

import "testing"

func TestGatewayCertSHA256Pattern(t *testing.T) {
	valid := "sha256:0123456789abcdef0123456789abcdef0123456789ABCDEF0123456789ABCDEF"
	if !gatewayCertSHA256Pattern.MatchString(valid) {
		t.Fatal("expected valid sha256 fingerprint to match")
	}

	invalid := []string{
		"",
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		"sha256:abcd",
		"sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
	}
	for _, value := range invalid {
		t.Run(value, func(t *testing.T) {
			if gatewayCertSHA256Pattern.MatchString(value) {
				t.Fatalf("expected %q not to match", value)
			}
		})
	}
}
