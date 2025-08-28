#!/usr/bin/env bash
set -Eeuo pipefail

# Friendly tmux + ttyd launcher (no resizing, not one‑shot)
#
# Env overrides (optional):
#   SESSION  – tmux session name (default: codex-demo)
#   SOCKET   – tmux socket name   (default: codex-sock)
#   PORT     – ttyd port          (default: 7681)
#   SCROLL   – scrollback lines   (default: 200000)
#               tip: set to "unlimited" for a huge buffer
#   AUTOSTART_CMD – command to run (default: c 'hi there')
#   RESTART_DELAY – seconds to wait before restart (default: 2)
#   WINDOW_TITLE  – tmux window title/name (default: Dreamcatcher)
#   MOUSE    – enable tmux mouse (on|off, default: on)

SESSION=${SESSION:-codex-demo}
SOCKET=${SOCKET:-codex-sock}
PORT=${PORT:-7681}
SCROLL=${SCROLL:-200000}
AUTOSTART_CMD=${AUTOSTART_CMD:-"c 'hi there'"}
RESTART_DELAY=${RESTART_DELAY:-2}
WINDOW_TITLE=${WINDOW_TITLE:-Dreamcatcher}
MOUSE=${MOUSE:-on}

# Normalize special scroll values
case "${SCROLL}" in
  unlimited|inf|INF)
    # Extremely large but finite to avoid memory blowups
    SCROLL=10000000
    ;;
  0)
    # In tmux, 0 means no history; choose a large finite value instead
    SCROLL=10000000
    ;;
esac

# Guarantee a UTF-8 locale so tmux/Node correctly enable Unicode/emoji
export LANG=${LANG:-C.UTF-8}
export LC_ALL=${LC_ALL:-C.UTF-8}
export LC_CTYPE=${LC_CTYPE:-C.UTF-8}

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
        set -g mouse "$MOUSE" \; \
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

  # Map Alt shortcuts to Control for browser-reserved keys
  tmuxx unbind-key -n M-t 2>/dev/null || true
  tmuxx unbind-key -n M-j 2>/dev/null || true
  tmuxx unbind-key -n M-c 2>/dev/null || true
  tmuxx bind-key -n M-t send-keys C-t >/dev/null
  tmuxx bind-key -n M-j send-keys C-j >/dev/null
  tmuxx bind-key -n M-c send-keys C-c >/dev/null
}

create_session() {
  info "Creating tmux session '$SESSION' on socket '$SOCKET'"
  # Start the app window first so attach focuses it.
  tmuxx -f /dev/null new-session -Ad -s "$SESSION" -n "$WINDOW_TITLE" \
    "bash -ilc \"while :; do $AUTOSTART_CMD; echo; echo '[app] restarting in ${RESTART_DELAY}s...'; sleep ${RESTART_DELAY}; done\"" >/dev/null

  apply_ui_settings
}

# Ensure the app window exists and focus it (no auto-respawn loops).
ensure_app_window() {
  if ! tmuxx list-windows -t "$SESSION" -F "#{window_name}" | grep -qx "$WINDOW_TITLE"; then
    # Migrate an old 'app' window name if present; otherwise create anew
    if tmuxx list-windows -t "$SESSION" -F "#{window_name}" | grep -qx "app"; then
      info "Renaming legacy 'app' window to '$WINDOW_TITLE'"
      tmuxx rename-window -t "$SESSION":app "$WINDOW_TITLE" >/dev/null || true
    else
      info "Creating app window: $AUTOSTART_CMD"
      tmuxx new-window -t "$SESSION" -n "$WINDOW_TITLE" \
        "bash -ilc \"while :; do $AUTOSTART_CMD; echo; echo '[app] restarting in ${RESTART_DELAY}s...'; sleep ${RESTART_DELAY}; done\"" >/dev/null
    fi
  fi

  # Ensure the window runs the app (not an idle shell)
  current_cmd=$(tmuxx display-message -p -t "$SESSION":"$WINDOW_TITLE" "#{pane_current_command}") || current_cmd=""
  case "$current_cmd" in
    bash|sh|zsh|fish)
      info "Respawning existing app window to run: $AUTOSTART_CMD"
      tmuxx respawn-window -k -t "$SESSION":"$WINDOW_TITLE" \
        "bash -ilc \"while :; do $AUTOSTART_CMD; echo; echo '[app] restarting in ${RESTART_DELAY}s...'; sleep ${RESTART_DELAY}; done\"" >/dev/null || true
      ;;
    *) ;;
  esac

  tmuxx select-window -t "$SESSION":"$WINDOW_TITLE" >/dev/null
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
  exec ttyd -W -p "$PORT" \
    -t scrollback="$SCROLL" \
    -t scrollOnUserInput=false \
    -t disableLeaveAlert=true \
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
