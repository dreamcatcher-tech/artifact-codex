#!/usr/bin/env bash
set -Eeuo pipefail

# Generic tmux + ttyd launcher.
# Usage: tmux.sh <command> [args...]

SESSION=${SESSION-}
SOCKET=${SOCKET-}
TTYD_PORT=${TTYD_PORT-}
WINDOW_TITLE=${WINDOW_TITLE-}
HOST=${HOST-}
# Optional: when set truthy, enables ttyd read-only mode
WRITEABLE=${WRITEABLE-}

have() { command -v "$1" >/dev/null 2>&1; }
require() { if ! have "$1"; then echo "error: missing '$1' in PATH" >&2; exit 1; fi; }
require_env() { local name="$1"; if [ -z "${!name:-}" ]; then echo "error: missing env $name" >&2; exit 1; fi; }

require tmux
require ttyd
require_env SESSION
require_env SOCKET
require_env TTYD_PORT
require_env WINDOW_TITLE
require_env HOST

SHELL=${SHELL:-/usr/bin/bash}

if [ $# -lt 1 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

# Build a safe single-string command for the tmux window.
CMD=""
for arg in "$@"; do
  printf -v q '%q' "$arg"
  CMD+="${q} "
done
CMD=${CMD%% } # trim trailing space

# Create session if missing; keep a login shell so Ctrl+C doesn't kill session
if ! tmux -L "$SOCKET" has-session -t "$SESSION" 2>/dev/null; then
  tmux -L "$SOCKET" -f /dev/null new-session -Ad -s "$SESSION" -n "$WINDOW_TITLE" \
    "$SHELL" -il >/dev/null
  tmux -L "$SOCKET" send-keys -t "$SESSION":"$WINDOW_TITLE" "$CMD" C-m >/dev/null
fi

echo "ttyd: http://${HOST}:${TTYD_PORT}"

ttyd_flags=( -p "$TTYD_PORT" )
# Enable write if requested
case "${WRITEABLE,,}" in
  1|true|on|yes) ttyd_flags+=( -W ) ;;
  *) ;;
esac

# Attach to the session if it exists, or create a fresh login shell if not.
# This ensures that after exiting the main command (e.g., via Ctrl+C),
# clients reconnect into a shell instead of looping when the session is gone.
# exec ttyd "${ttyd_flags[@]}" tmux -L "$SOCKET" new-session -A -s "$SESSION" -n "$WINDOW_TITLE" "$SHELL" -il
exec ttyd "${ttyd_flags[@]}" bash -il
