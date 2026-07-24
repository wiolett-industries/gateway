package docker

import (
	"archive/tar"
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	pb "github.com/wiolett-industries/gateway/daemon-shared/gatewayv1"
	"github.com/zeebo/blake3"
)

func TestIsNotFoundErrRecognizesMissingImages(t *testing.T) {
	for _, err := range []error{
		cerrdefs.ErrNotFound.WithMessage("image is missing"),
		errors.New("Error response from daemon: No such image: nginx:alpine"),
	} {
		if !isNotFoundErr(err) {
			t.Fatalf("expected missing image error to be recognized: %v", err)
		}
	}
}

func TestClassifyMigrationMountsAllowsNamedVolumeFromLegacyBindSyntax(t *testing.T) {
	volumeNames, blockers := classifyMigrationMounts([]container.MountPoint{
		{
			Type:        mount.TypeVolume,
			Name:        "data",
			Source:      "/var/lib/docker/volumes/data/_data",
			Destination: "/data",
			Driver:      "local",
		},
	}, nil)
	if !reflect.DeepEqual(volumeNames, []string{"data"}) {
		t.Fatalf("volume names = %#v, want data", volumeNames)
	}
	if len(blockers) != 0 {
		t.Fatalf("named volume produced blockers: %#v", blockers)
	}

	_, blockers = classifyMigrationMounts([]container.MountPoint{
		{Type: mount.TypeBind, Source: "/host/data", Destination: "/data"},
	}, nil)
	if !reflect.DeepEqual(blockers, []string{"bind mounts are host-bound"}) {
		t.Fatalf("bind blockers = %#v", blockers)
	}
}

func TestMigrationArtifactStoreResumeAndPermissions(t *testing.T) {
	stateDir := t.TempDir()
	store, err := newMigrationArtifactStore(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	file, err := store.openWrite("migration-1", "artifact-1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("hello"); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := store.openWrite("migration-1", "artifact-1", 4); err == nil {
		t.Fatal("expected mismatched resume offset to fail")
	}
	file, err = store.openWrite("migration-1", "artifact-1", 5)
	if err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	dir, err := store.migrationDir("migration-1", false)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0700 {
		t.Fatalf("migration directory mode = %o, want 700", got)
	}
	if _, err := store.artifactPath("../escape", "artifact", true); err == nil {
		t.Fatal("expected unsafe migration id to fail")
	}
}

func TestMigrationArtifactStoreCleansOnlyStaleMigrations(t *testing.T) {
	store, err := newMigrationArtifactStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	stale, _ := store.migrationDir("stale", true)
	fresh, _ := store.migrationDir("fresh", true)
	now := time.Now()
	old := now.Add(-migrationArtifactMaxAge - time.Hour)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	if err := store.cleanupStale(now); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale migration still exists: %v", err)
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("fresh migration was removed: %v", err)
	}
}

func TestReceiveMigrationChunkEnforcesOffsetAndOneMiBLimit(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "artifact")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	incoming := &migrationIncomingArtifact{migrationID: "m1", artifactID: "a1", file: file}
	complete, err := receiveMigrationChunk(incoming, &pb.MigrationArtifactChunk{MigrationId: "m1", ArtifactId: "a1", Offset: 0, Data: []byte("abc")})
	if err != nil || complete || incoming.offset != 3 {
		t.Fatalf("first chunk = complete %v, offset %d, err %v", complete, incoming.offset, err)
	}
	if _, err := receiveMigrationChunk(incoming, &pb.MigrationArtifactChunk{MigrationId: "m1", ArtifactId: "a1", Offset: 2}); err == nil {
		t.Fatal("expected offset mismatch")
	}
	if _, err := receiveMigrationChunk(incoming, &pb.MigrationArtifactChunk{MigrationId: "m1", ArtifactId: "a1", Offset: 3, Data: make([]byte, migrationChunkBytes+1)}); err == nil {
		t.Fatal("expected oversized chunk rejection")
	}
	complete, err = receiveMigrationChunk(incoming, &pb.MigrationArtifactChunk{MigrationId: "m1", ArtifactId: "a1", Offset: 3, Eof: true})
	if err != nil || !complete {
		t.Fatalf("EOF = complete %v, err %v", complete, err)
	}
}

func TestMigrationVolumeArchiveExtractPreservesLogicalEvidence(t *testing.T) {
	source := t.TempDir()
	if err := os.Mkdir(filepath.Join(source, "nested"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "nested", "data.txt"), []byte("migration payload"), 0640); err != nil {
		t.Fatal(err)
	}
	stamp := time.Unix(1_700_000_000, 123_000_000)
	if err := os.Chtimes(filepath.Join(source, "nested", "data.txt"), stamp, stamp); err != nil {
		t.Fatal(err)
	}

	var archive bytes.Buffer
	sourceHasher := blake3.New()
	writer := tar.NewWriter(&archive)
	entryCount, contentBytes, err := archiveMigrationTree(source, writer, sourceHasher)
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	entries, digest, targetEntries, targetBytes, err := extractMigrationTree(target, tar.NewReader(bytes.NewReader(archive.Bytes())))
	if err != nil {
		t.Fatal(err)
	}
	if entryCount != targetEntries || contentBytes != targetBytes {
		t.Fatalf("source evidence counts %d/%d, target %d/%d", entryCount, contentBytes, targetEntries, targetBytes)
	}
	if want := stringHex(sourceHasher.Sum(nil)); digest != want {
		t.Fatalf("logical digest = %s, want %s", digest, want)
	}
	if err := verifyMigrationMetadata(target, entries); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(target, "nested", "data.txt"))
	if err != nil || string(data) != "migration payload" {
		t.Fatalf("target data = %q, err %v", data, err)
	}
}

func TestMigrationVolumeArchiveRejectsSpecialFiles(t *testing.T) {
	// A synthetic special-mode check proves the archive gate without relying on
	// platform-specific device creation.
	if _, err := migrationEntryKind(os.ModeNamedPipe); err == nil {
		t.Fatal("expected special filesystem entry rejection")
	}
}

func TestMeasureMigrationTreeReturnsMetadataOnlyTotals(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "nested"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "data"), []byte("1234567"), 0600); err != nil {
		t.Fatal(err)
	}
	entries, logicalBytes, err := measureMigrationTree(root)
	if err != nil {
		t.Fatal(err)
	}
	if entries != 2 || logicalBytes != 7 {
		t.Fatalf("measure = %d entries/%d bytes, want 2/7", entries, logicalBytes)
	}
}

func TestMigrationVolumeExtractPreservesSymlink(t *testing.T) {
	var archive bytes.Buffer
	writer := tar.NewWriter(&archive)
	stamp := time.Unix(1_700_000_000, 0)
	if err := writer.WriteHeader(&tar.Header{Name: "link", Typeflag: tar.TypeSymlink, Linkname: "target", Mode: 0777, Uid: os.Getuid(), Gid: os.Getgid(), ModTime: stamp, Format: tar.FormatPAX}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	entries, _, _, _, err := extractMigrationTree(target, tar.NewReader(bytes.NewReader(archive.Bytes())))
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyMigrationMetadata(target, entries); err != nil {
		t.Fatal(err)
	}
	link, err := os.Readlink(filepath.Join(target, "link"))
	if err != nil || link != "target" {
		t.Fatalf("link = %q, err %v", link, err)
	}
}

func TestMigrationVolumeArchiveExtractPreservesHardLinks(t *testing.T) {
	source := t.TempDir()
	first := filepath.Join(source, "first")
	if err := os.WriteFile(first, []byte("shared"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(first, filepath.Join(source, "second")); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	hasher := blake3.New()
	writer := tar.NewWriter(&archive)
	if _, _, err := archiveMigrationTree(source, writer, hasher); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	entries, _, _, _, err := extractMigrationTree(target, tar.NewReader(bytes.NewReader(archive.Bytes())))
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyMigrationMetadata(target, entries); err != nil {
		t.Fatal(err)
	}
	firstInfo, _ := os.Stat(filepath.Join(target, "first"))
	secondInfo, _ := os.Stat(filepath.Join(target, "second"))
	if !os.SameFile(firstInfo, secondInfo) {
		t.Fatal("target files are not hard linked")
	}
}

func TestManifestUnknownCreateFieldIsBlocked(t *testing.T) {
	raw := []byte(`{"Config":{"Image":"nginx","FuturePortableSetting":true},"HostConfig":{}}`)
	err := rejectUnknownCreateFields(raw, reflect.TypeOf(container.Config{}), reflect.TypeOf(container.HostConfig{}))
	if err == nil {
		t.Fatal("expected unknown create field blocker")
	}
}

func stringHex(value []byte) string {
	const digits = "0123456789abcdef"
	result := make([]byte, len(value)*2)
	for i, b := range value {
		result[i*2] = digits[b>>4]
		result[i*2+1] = digits[b&15]
	}
	return string(result)
}
