package docker

import "sync"

// AllowlistChecker controls which containers the daemon may manage.
// If the list contains "*", all containers are allowed.
type AllowlistChecker struct {
	mu       sync.RWMutex
	allowAll bool
	allowed  map[string]bool // container names
}

// NewAllowlistChecker builds an AllowlistChecker from the given name list.
// A list containing "*" means every container is allowed.
func NewAllowlistChecker(list []string) *AllowlistChecker {
	a := &AllowlistChecker{}
	a.apply(list)
	return a
}

// IsAllowed returns true if the container name is permitted.
func (a *AllowlistChecker) IsAllowed(name string) bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.allowAll {
		return true
	}
	return a.allowed[name]
}

// Update replaces the allowlist at runtime (e.g. via DockerConfigPush).
func (a *AllowlistChecker) Update(list []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.apply(list)
}

// Filter returns only containers whose name is in the allowlist.
func (a *AllowlistChecker) Filter(containers []ContainerInfo) []ContainerInfo {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.allowAll {
		return containers
	}
	filtered := make([]ContainerInfo, 0, len(containers))
	for _, c := range containers {
		if a.allowed[c.Name] {
			filtered = append(filtered, c)
		}
	}
	return filtered
}

// apply sets the internal state from the list. Must be called with mu held.
func (a *AllowlistChecker) apply(list []string) {
	a.allowAll = false
	a.allowed = make(map[string]bool, len(list))
	for _, name := range list {
		if name == "*" {
			a.allowAll = true
			a.allowed = nil
			return
		}
		a.allowed[name] = true
	}
}
