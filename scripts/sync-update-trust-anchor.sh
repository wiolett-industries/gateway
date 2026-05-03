#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

SOURCE="$REPO_ROOT/config/update-trust/update-signing-public-key.pem"
DAEMON_DEST_DIR="$REPO_ROOT/packages/daemons/shared/updateauth"
DAEMON_DEST="$DAEMON_DEST_DIR/update-signing-public-key.pem"
BACKEND_DEST_DIR="$REPO_ROOT/packages/backend/config/update-trust"
BACKEND_DEST="$BACKEND_DEST_DIR/update-signing-public-key.pem"

test -f "$SOURCE" || {
  echo "Missing update signing public key: $SOURCE" >&2
  exit 1
}

mkdir -p "$DAEMON_DEST_DIR" "$BACKEND_DEST_DIR"
cp "$SOURCE" "$DAEMON_DEST"
cp "$SOURCE" "$BACKEND_DEST"
