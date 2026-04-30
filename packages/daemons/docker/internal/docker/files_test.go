package docker

import "testing"

func TestDockerWriteFileCommandPassesPathAsArgv(t *testing.T) {
	path := "/tmp/a'; touch /tmp/pwned; echo '"
	cmd := dockerWriteFileCommand(path)

	if len(cmd) != 3 {
		t.Fatalf("unexpected command length: %d", len(cmd))
	}
	if cmd[0] != "dd" {
		t.Fatalf("expected dd command, got %q", cmd[0])
	}
	if cmd[1] != "of="+path {
		t.Fatalf("expected path in single argv entry, got %q", cmd[1])
	}
	if cmd[2] != "bs=65536" {
		t.Fatalf("unexpected block size arg: %q", cmd[2])
	}
}

func TestValidatePathAllowsShellMetacharactersAsPlainPathData(t *testing.T) {
	paths := []string{
		"/tmp/a'; touch /tmp/pwned; echo '",
		"/tmp/$(touch /tmp/pwned)",
		"/tmp/a;touch /tmp/pwned",
		"/tmp/a\nb",
	}

	for _, path := range paths {
		if err := validatePath(path); err != nil {
			t.Fatalf("validatePath(%q) returned error: %v", path, err)
		}
	}
}
