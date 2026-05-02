# Update Trust Anchor

`update-signing-public-key.pem` is the canonical repo-wide update signing public key used by both Gateway backend and daemons.

The daemon Go package needs a package-local generated copy for `go:embed`. Run `scripts/sync-update-trust-anchor.sh` after rotating this key; daemon build, test, lint, and CI paths run that sync automatically.
