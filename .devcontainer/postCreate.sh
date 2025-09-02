#!/usr/bin/env bash
set -euo pipefail

# Sync host Codex config into the container if present
DEST_DIR="$HOME/.codex"
HOST_DIR="/tmp/host-codex"
mkdir -p "$DEST_DIR"

for f in auth.json config.toml; do
  if [ -f "$HOST_DIR/$f" ]; then
    cp -f "$HOST_DIR/$f" "$DEST_DIR/"
  fi
done

# Install Fly CLI
curl -fsSL https://fly.io/install.sh | sh

# Ensure Fly is on PATH for interactive shells
if ! grep -q '/.fly/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.fly/bin:$PATH"' >> "$HOME/.bashrc"
fi

echo "postCreate: done"

