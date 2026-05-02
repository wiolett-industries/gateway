# Update Trust Anchor

The canonical repo-wide update signing public key lives at `config/update-trust/update-signing-public-key.pem`.

`scripts/sync-update-trust-anchor.sh` copies that PEM into this package as `update-signing-public-key.pem` because daemon binaries embed it with `go:embed`, which requires package-local files. The generated package-local PEM is ignored by git.
