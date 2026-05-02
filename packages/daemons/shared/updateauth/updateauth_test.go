package updateauth

import "testing"

const testChecksum = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const testURL = "https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway/packages/generic/nginx-daemon/v9.9.9-nginx/nginx-daemon-linux-amd64"
const testManifest = `{
  "schemaVersion": 1,
  "keyId": "wiolett-update-v1",
  "payload": "eyJraW5kIjoiZGFlbW9uLWJpbmFyeSIsInZlcnNpb24iOiJ2OS45LjkiLCJ0YWciOiJ2OS45LjktbmdpbngiLCJkYWVtb25UeXBlIjoibmdpbngiLCJhcmNoIjoiYW1kNjQiLCJhcnRpZmFjdE5hbWUiOiJuZ2lueC1kYWVtb24tbGludXgtYW1kNjQiLCJkb3dubG9hZFVybCI6Imh0dHBzOi8vZ2l0bGFiLndpb2xldHQubmV0L2FwaS92NC9wcm9qZWN0cy93aW9sZXR0JTJGZ2F0ZXdheS9wYWNrYWdlcy9nZW5lcmljL25naW54LWRhZW1vbi92OS45LjktbmdpbngvbmdpbngtZGFlbW9uLWxpbnV4LWFtZDY0Iiwic2hhMjU2IjoiMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZiIsImNyZWF0ZWRBdCI6IjIwMjYtMDUtMDJUMTQ6Mzk6MDNaIiwiZ2l0Q29tbWl0U2hhIjoidGVzdCIsImdpdFBpcGVsaW5lSWQiOiIxIn0",
  "signature": "sNy92HOZyOUMyGJkXQ1nRmTSFm3BosuaAUaInP_Svo0cWGx50jvMlnsfU64FyubGDXK4ihvpgtlcNCfqN61ABw"
}`

func TestVerifyDaemonManifest(t *testing.T) {
	payload, err := VerifyDaemonManifest(testManifest, DaemonExpectation{
		DaemonType:   "nginx",
		Version:      "v9.9.9",
		Tag:          "v9.9.9-nginx",
		Arch:         "amd64",
		ArtifactName: "nginx-daemon-linux-amd64",
		DownloadURL:  testURL,
		SHA256:       testChecksum,
	})
	if err != nil {
		t.Fatalf("VerifyDaemonManifest returned error: %v", err)
	}
	if payload.ArtifactName != "nginx-daemon-linux-amd64" {
		t.Fatalf("unexpected artifact name %q", payload.ArtifactName)
	}
}

func TestVerifyDaemonManifestRejectsMismatch(t *testing.T) {
	_, err := VerifyDaemonManifest(testManifest, DaemonExpectation{
		DaemonType:   "docker",
		Version:      "v9.9.9",
		Tag:          "v9.9.9-nginx",
		Arch:         "amd64",
		ArtifactName: "nginx-daemon-linux-amd64",
		DownloadURL:  testURL,
		SHA256:       testChecksum,
	})
	if err == nil {
		t.Fatal("expected daemon type mismatch to fail")
	}
}

func TestVerifyDaemonManifestRejectsTampering(t *testing.T) {
	tampered := `{"schemaVersion":1,"keyId":"wiolett-update-v1","payload":"eyJraW5kIjoiZGFlbW9uLWJpbmFyeSJ9","signature":"sNy92HOZyOUMyGJkXQ1nRmTSFm3BosuaAUaInP_Svo0cWGx50jvMlnsfU64FyubGDXK4ihvpgtlcNCfqN61ABw"}`
	_, err := VerifyDaemonManifest(tampered, DaemonExpectation{
		DaemonType:   "nginx",
		Version:      "v9.9.9",
		Tag:          "v9.9.9-nginx",
		Arch:         "amd64",
		ArtifactName: "nginx-daemon-linux-amd64",
		DownloadURL:  testURL,
		SHA256:       testChecksum,
	})
	if err == nil {
		t.Fatal("expected tampered manifest to fail")
	}
}

func TestTrustedHTTPSURLAllowsConfiguredGitLabOrigins(t *testing.T) {
	if !isTrustedHTTPSURL("https://gitlab.example.test/api/v4/projects/custom%2Fgateway/packages/generic/nginx-daemon/v9.9.9-nginx/nginx-daemon-linux-amd64") {
		t.Fatal("expected HTTPS package URL from a configured GitLab origin to be trusted")
	}
	if isTrustedHTTPSURL("http://gitlab.example.test/api/v4/projects/custom%2Fgateway/packages/generic/nginx-daemon/v9.9.9-nginx/nginx-daemon-linux-amd64") {
		t.Fatal("expected non-HTTPS package URL to be rejected")
	}
}
