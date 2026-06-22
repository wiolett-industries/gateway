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

func TestDockerWriteFileChunkCommandUsesAlignedSeek(t *testing.T) {
	cmd, err := dockerWriteFileChunkCommand("/tmp/.gateway-upload-abc.tmp", 2*dockerFileUploadBlockBytes)
	if err != nil {
		t.Fatalf("dockerWriteFileChunkCommand returned error: %v", err)
	}
	expected := []string{"dd", "of=/tmp/.gateway-upload-abc.tmp", "bs=65536", "seek=2", "conv=notrunc"}
	if len(cmd) != len(expected) {
		t.Fatalf("unexpected command length: %d", len(cmd))
	}
	for i := range expected {
		if cmd[i] != expected[i] {
			t.Fatalf("cmd[%d] = %q, expected %q", i, cmd[i], expected[i])
		}
	}
}

func TestDockerWriteFileChunkCommandRejectsUnalignedOffset(t *testing.T) {
	if _, err := dockerWriteFileChunkCommand("/tmp/.gateway-upload-abc.tmp", 1); err == nil {
		t.Fatal("expected unaligned offset to fail")
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

func TestUploadTempPathRejectsUnsafeUploadIDs(t *testing.T) {
	for _, uploadID := range []string{"../escape", "bad/id", "bad id", "short"} {
		if _, _, err := uploadTempPath(uploadID, "/tmp/file"); err == nil {
			t.Fatalf("expected uploadTempPath to reject %q", uploadID)
		}
	}
}

func TestUploadTempPathUsesTargetParent(t *testing.T) {
	tempPath, cleanTarget, err := uploadTempPath("upload_123456", "/tmp/folder/file.txt")
	if err != nil {
		t.Fatalf("uploadTempPath returned error: %v", err)
	}
	if cleanTarget != "/tmp/folder/file.txt" {
		t.Fatalf("unexpected clean target: %q", cleanTarget)
	}
	if tempPath != "/tmp/folder/.gateway-upload-upload_123456.tmp" {
		t.Fatalf("unexpected temp path: %q", tempPath)
	}
}

func TestValidateMovePathsRejectsUnsafeMoves(t *testing.T) {
	cases := []struct {
		name string
		from string
		to   string
	}{
		{name: "root source", from: "/", to: "/tmp/root"},
		{name: "root target", from: "/tmp/file", to: "/"},
		{name: "same path", from: "/tmp/file", to: "/tmp/file"},
		{name: "descendant target", from: "/tmp/folder", to: "/tmp/folder/child"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := validateMovePaths(tc.from, tc.to); err == nil {
				t.Fatalf("expected validateMovePaths(%q, %q) to fail", tc.from, tc.to)
			}
		})
	}
}

func TestValidateMovePathsCleansSafeMoves(t *testing.T) {
	from, to, err := validateMovePaths("/tmp/source/.", "/var/target")
	if err != nil {
		t.Fatalf("validateMovePaths returned error: %v", err)
	}
	if from != "/tmp/source" || to != "/var/target" {
		t.Fatalf("unexpected cleaned paths: %q -> %q", from, to)
	}
}
