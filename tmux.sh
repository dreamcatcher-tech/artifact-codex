#!/usr/bin/env bash
set -Eeuo pipefail

# Friendly tmux + ttyd launcher (no resizing, not one‑shot)
#
# Env overrides (optional):
#   SESSION  – tmux session name (default: codex-demo)
#   SOCKET   – tmux socket name   (default: codex-sock)
#   PORT     – ttyd port          (default: 7681)
#   SCROLL   – scrollback lines   (default: 200000)
#   AUTOSTART_CMD – command to run (default: c 'hi there')
#   RESTART_DELAY – seconds to wait before restart (default: 2)

SESSION=${SESSION:-codex-demo}
SOCKET=${SOCKET:-codex-sock}
PORT=${PORT:-7681}
SCROLL=${SCROLL:-200000}
AUTOSTART_CMD=${AUTOSTART_CMD:-"c 'hi there'"}
RESTART_DELAY=${RESTART_DELAY:-2}

# --- tiny ui helpers -------------------------------------------------------
color() { printf "\033[%sm" "$1"; }
reset() { printf "\033[0m"; }
info()  { color 36; printf "[info] %s\n" "$*"; reset; }
warn()  { color 33; printf "[warn] %s\n" "$*"; reset; }
err()   { color 31; printf "[fail] %s\n" "$*"; reset; }

have()  { command -v "$1" >/dev/null 2>&1; }

# --- tmux helpers ----------------------------------------------------------
tmuxx() { tmux -L "$SOCKET" "$@"; }

session_exists() {
  tmuxx has-session -t "$SESSION" 2>/dev/null
}

apply_ui_settings() {
  # Minimal, readable defaults. No resizing hooks or status chrome.
  tmuxx set -g history-limit "$SCROLL" \; \
        set -g status off \; \
        set -g status-left "" \; \
        set -g status-right "" \; \
        set -g display-time 0 \; \
        set -g set-titles off \; \
        set -g mouse off \; \
        set -g status-style "bg=colour235,fg=white" \; \
        set -g message-style "bg=colour237,fg=white" \; \
        set -g message-command-style "bg=colour237,fg=white" \; \
        set -g pane-border-status off \; \
        set -g pane-border-style "fg=default" \; \
        set -g pane-active-border-style "fg=default" \; \
        set -g mode-keys vi \; \
        set -g bell-action none \; \
        set -g visual-activity off \; \
        set -g monitor-activity off \; \
        setw -g allow-rename off \; \
        setw -g automatic-rename off >/dev/null
}

create_session() {
  info "Creating tmux session '$SESSION' on socket '$SOCKET'"
  # Start the app window first so attach focuses it.
  tmuxx -f /dev/null new-session -Ad -s "$SESSION" -n app \
    "bash -ilc \"while :; do $AUTOSTART_CMD; echo; echo '[app] restarting in ${RESTART_DELAY}s...'; sleep ${RESTART_DELAY}; done\"" >/dev/null

  apply_ui_settings
}

# Ensure the app window exists and focus it (no auto-respawn loops).
ensure_app_window() {
  if ! tmuxx list-windows -t "$SESSION" -F "#{window_name}" | grep -qx "app"; then
    info "Creating app window: $AUTOSTART_CMD"
    tmuxx new-window -t "$SESSION" -n app \
      "bash -ilc \"while :; do $AUTOSTART_CMD; echo; echo '[app] restarting in ${RESTART_DELAY}s...'; sleep ${RESTART_DELAY}; done\"" >/dev/null
  else
    # If the app window is just a shell, respawn it to run the app.
    current_cmd=$(tmuxx display-message -p -t "$SESSION":app "#{pane_current_command}") || current_cmd=""
    case "$current_cmd" in
      bash|sh|zsh|fish)
        info "Respawning existing app window to run: $AUTOSTART_CMD"
        tmuxx respawn-window -k -t "$SESSION":app \
          "bash -ilc \"while :; do $AUTOSTART_CMD; echo; echo '[app] restarting in ${RESTART_DELAY}s...'; sleep ${RESTART_DELAY}; done\"" >/dev/null || true
        ;;
      *) ;;
    esac
  fi
  tmuxx select-window -t "$SESSION":app >/dev/null
}

# --- ttyd helpers ----------------------------------------------------------
ttyd_running() {
  # Detect an existing ttyd bound to the same port.
  if have ss; then
    ss -ltn | awk '{print $4}' | grep -Eq "(^|:)${PORT}$" && return 0
  fi
  pgrep -fa "ttyd.*-p[= ]${PORT}(\s|$)" >/dev/null 2>&1
}

start_ttyd() {
  info "Starting ttyd on http://localhost:${PORT}"
  exec ttyd -W -p "$PORT" -t scrollback="$SCROLL" \
    tmux -L "$SOCKET" attach -t "$SESSION"
}

# --- main ------------------------------------------------------------------
if ! have tmux; then err "tmux not found in PATH"; exit 1; fi
if ! have ttyd; then err "ttyd not found in PATH"; exit 1; fi

if session_exists; then
  info "Reusing existing tmux session '$SESSION'"
  apply_ui_settings
  ensure_app_window
else
  create_session
fi

if ttyd_running; then
  warn "ttyd already serving on port ${PORT}. Not starting another."
  info "Open: http://localhost:${PORT}"
  # Keep script alive long enough to read the message when run interactively.
  # Exit with success without touching existing processes.
  exit 0
else
  start_ttyd
fi
