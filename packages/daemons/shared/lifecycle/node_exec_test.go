package lifecycle

import "testing"

func TestNodeConsoleSessionKeySeparatesGatewayUsers(t *testing.T) {
	first := nodeConsoleSessionKey("user-1")
	second := nodeConsoleSessionKey("user-2")
	if first == second {
		t.Fatal("different Gateway users resolved to the same node console session")
	}
	if first != nodeConsoleSessionKey("user-1") {
		t.Fatal("the same Gateway user did not resolve to a stable node console session")
	}
}

func TestNodeConsoleSessionKeyKeepsLegacyFallback(t *testing.T) {
	if got := nodeConsoleSessionKey(""); got != "node-console" {
		t.Fatalf("legacy session key = %q, want node-console", got)
	}
}
