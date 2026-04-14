package docker

import "testing"

func TestAllowlistCheckerExplicitNames(t *testing.T) {
	checker := NewAllowlistChecker([]string{"web", "api"})

	if !checker.IsAllowed("web") {
		t.Fatal("expected web to be allowed")
	}
	if checker.IsAllowed("worker") {
		t.Fatal("expected worker to be blocked")
	}

	filtered := checker.Filter([]ContainerInfo{
		{Name: "web"},
		{Name: "worker"},
		{Name: "api"},
	})

	if len(filtered) != 2 {
		t.Fatalf("expected 2 filtered containers, got %d", len(filtered))
	}
	if filtered[0].Name != "web" || filtered[1].Name != "api" {
		t.Fatalf("unexpected filtered order/content: %+v", filtered)
	}
}

func TestAllowlistCheckerWildcardAndUpdate(t *testing.T) {
	checker := NewAllowlistChecker([]string{"*"})

	if !checker.IsAllowed("anything") {
		t.Fatal("expected wildcard allowlist to allow any container")
	}

	containers := []ContainerInfo{{Name: "web"}, {Name: "worker"}}
	filtered := checker.Filter(containers)
	if len(filtered) != len(containers) {
		t.Fatalf("expected all containers to pass through, got %d", len(filtered))
	}

	checker.Update([]string{"worker"})

	if checker.IsAllowed("web") {
		t.Fatal("expected web to be blocked after update")
	}
	if !checker.IsAllowed("worker") {
		t.Fatal("expected worker to be allowed after update")
	}
}
