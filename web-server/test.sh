#!/usr/bin/env bash
set -Eeuo pipefail

# Imitate the Dockerfile env and entrypoint locally, then run tmux.sh

# Defaults matching Dockerfile ENV
export SESSION="${SESSION:-root-session}"
export SOCKET="${SOCKET:-root-socket}"
export PORT="${PORT:-8080}"
export TTYD_PORT="${TTYD_PORT:-8100}"
export WINDOW_TITLE="${WINDOW_TITLE:-root-window}"
export TTYD_HOST="${TTYD_HOST:-127.0.0.1}"
export WRITEABLE="${WRITEABLE:-off}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMUX_SH="${REPO_ROOT}/shared/tmux.sh"

# Reset any previous tmux server/session on this socket
if command -v tmux >/dev/null 2>&1; then
  tmux -L "$SOCKET" kill-session -t "$SESSION" 2>/dev/null || true
  tmux -L "$SOCKET" kill-server 2>/dev/null || true
fi

echo "TMUX_SH: ${TMUX_SH}"
echo "SCRIPT_DIR: ${SCRIPT_DIR}"

exec "${TMUX_SH}" deno run -A "${SCRIPT_DIR}/main.ts"
