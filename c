#!/usr/bin/env bash
set -euo pipefail

# Resolve this script's directory, following symlinks
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname -- "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink -- "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname -- "$SOURCE")" >/dev/null 2>&1 && pwd)"
SELF="$SCRIPT_DIR/$(basename -- "$0")"

# Self-install symlink to ~/.local/bin/c
TARGET_DIR="$HOME/.local/bin"
TARGET="$TARGET_DIR/c"
mkdir -p -- "$TARGET_DIR"
RESOLVED_SELF="$(readlink -f -- "$SELF")"
RESOLVED_TARGET="$(readlink -f -- "$TARGET" 2>/dev/null || true)"
if [[ "$RESOLVED_TARGET" != "$RESOLVED_SELF" ]]; then
  ln -sf -- "$RESOLVED_SELF" "$TARGET"
fi

# Ensure npx is available
if ! command -v npx >/dev/null 2>&1; then
  echo "Error: 'npx' is not installed or not on PATH." >&2
  echo "Install Node.js which provides npx: https://nodejs.org/" >&2
  exit 127
fi

# Use the caller's absolute working directory for codex's own --cd argument
CWD_ABS="$(pwd -P)"

exec npx -y @openai/codex --cd "$CWD_ABS" "$@"
