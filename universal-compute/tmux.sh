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
#   AUTOSTART_CMD – command to run in a loop (default: unset → do nothing)
#   PRE_CMD       – one-off command to run before first AUTOSTART_CMD (default: unset)
#   RESTART_DELAY – seconds to wait before restart (default: 2)
#   WINDOW_TITLE  – tmux window title/name (default: Dreamcatcher)
#   MOUSE    – enable tmux mouse (on|off, default: on)
#   SIXEL    – enable sixel graphics in browser+tmux (on|off, default: off)

SESSION=${SESSION:-codex-demo}
SOCKET=${SOCKET:-codex-sock}
PORT=${PORT:-7681}
SCROLL=${SCROLL:-200000}
AUTOSTART_CMD=${AUTOSTART_CMD:-}
PRE_CMD=${PRE_CMD:-}
RESTART_DELAY=${RESTART_DELAY:-2}
WINDOW_TITLE=${WINDOW_TITLE:-Dreamcatcher}
# Default to tmux mouse OFF so the browser/xterm.js handles
# text selection, context menu, and clipboard consistently.
# Set MOUSE=on to restore tmux mouse interactions (pane resize/click).
MOUSE=${MOUSE:-off}
SIXEL=${SIXEL:-off}

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

  # Disable tmux's right-click menu so RMB does nothing
  tmuxx unbind-key -n MouseDown3Pane 2>/dev/null || true
  tmuxx unbind-key -n MouseDown3Status 2>/dev/null || true
  tmuxx unbind-key -n MouseDown3Client 2>/dev/null || true
  tmuxx unbind-key -n MouseDown3StatusLeft 2>/dev/null || true
  tmuxx unbind-key -n MouseDown3StatusRight 2>/dev/null || true

  # Map Alt shortcuts to Control for browser-reserved keys
  tmuxx unbind-key -n M-t 2>/dev/null || true
  tmuxx unbind-key -n M-j 2>/dev/null || true
  tmuxx unbind-key -n M-c 2>/dev/null || true
  tmuxx bind-key -n M-t send-keys C-t >/dev/null
  tmuxx bind-key -n M-j send-keys C-j >/dev/null
  tmuxx bind-key -n M-c send-keys C-c >/dev/null

  # If requested, tell tmux the client terminal supports sixel graphics.
  # This helps apps inside tmux detect support. Safe to ignore if unsupported.
  if [ "${SIXEL}" = "on" ]; then
    tmuxx set -as terminal-features ",xterm*:sixel" >/dev/null 2>&1 || true
  fi
}

# Compose the command that the app window should run.
# - Runs PRE_CMD once if set.
# - Loops AUTOSTART_CMD if set; otherwise starts an interactive shell.
app_cmd() {
  local pre="" main=""

  if [ -n "${PRE_CMD:-}" ]; then
    pre="$PRE_CMD; "
  fi

  if [ -n "${AUTOSTART_CMD:-}" ]; then
    main="while :; do $AUTOSTART_CMD; echo; echo '[app] restarting in ${RESTART_DELAY}s...'; sleep ${RESTART_DELAY}; done"
    printf 'bash -ilc "%s%s"' "$pre" "$main"
  else
    if [ -n "${PRE_CMD:-}" ]; then
      # Run PRE once, then drop into a login shell
      printf 'bash -ilc "%sexec bash -il"' "$pre"
    else
      # Neither PRE nor AUTOSTART provided → do nothing (just a shell)
      printf 'bash -il'
    fi
  fi
}

create_session() {
  info "Creating tmux session '$SESSION' on socket '$SOCKET'"
  # Start the app window first so attach focuses it.
  local CMD
  CMD=$(app_cmd)
  tmuxx -f /dev/null new-session -Ad -s "$SESSION" -n "$WINDOW_TITLE" "$CMD" >/dev/null

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
      local CMD
      CMD=$(app_cmd)
      info "Creating app window"
      tmuxx new-window -t "$SESSION" -n "$WINDOW_TITLE" "$CMD" >/dev/null
    fi
  fi

  # Ensure the window runs the app (not an idle shell)
  current_cmd=$(tmuxx display-message -p -t "$SESSION":"$WINDOW_TITLE" "#{pane_current_command}") || current_cmd=""
  case "$current_cmd" in
    bash|sh|zsh|fish)
      if [ -n "${AUTOSTART_CMD:-}" ]; then
        info "Respawning existing app window to run AUTOSTART_CMD"
        local CMD
        CMD=$(app_cmd)
        tmuxx respawn-window -k -t "$SESSION":"$WINDOW_TITLE" "$CMD" >/dev/null || true
      fi
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
  # Optional client flags for xterm.js via ttyd
  local client_flags=()
  if [ "${SIXEL}" = "on" ]; then
    # Enable xterm.js Sixel addon in the browser terminal
    client_flags+=( -t enableSixel=true )
  fi

  # Ensure a fresh session is created on reconnect if the user exited the shell.
  # This prevents ttyd from rapidly reconnecting with "no sessions" when
  # AUTOSTART_CMD is not set and the interactive shell is exited.
  local CMD
  CMD=$(app_cmd)
  export TMUX_APP_CMD="$CMD"

  # Build an attach wrapper that creates the session if missing, applies
  # minimal UI settings, and then attaches. This runs per client connect.
  local -a attach_wrapper=(
    bash -lc
    "tmux -L \"$SOCKET\" has-session -t \"$SESSION\" 2>/dev/null || (
       tmux -L \"$SOCKET\" -f /dev/null new-session -Ad -s \"$SESSION\" -n \"$WINDOW_TITLE\" \"\$TMUX_APP_CMD\" >/dev/null;
       tmux -L \"$SOCKET\" set -g history-limit \"$SCROLL\" >/dev/null;
       tmux -L \"$SOCKET\" set -g status off >/dev/null;
       tmux -L \"$SOCKET\" set -g set-titles off >/dev/null;
       tmux -L \"$SOCKET\" set -g mouse \"$MOUSE\" >/dev/null;
       tmux -L \"$SOCKET\" setw -g allow-rename off >/dev/null;
       tmux -L \"$SOCKET\" setw -g automatic-rename off >/dev/null
     );
     exec tmux -L \"$SOCKET\" attach -t \"$SESSION\""
  )

  exec ttyd -W -p "$PORT" \
    -t scrollback="$SCROLL" \
    -t scrollOnUserInput=false \
    -t disableResizeOverlay=true \
    -t copyOnSelection=true \
    -t rightClickSelectsWord=false \
    -t macOptionClickForcesSelection=true \
    -t disableLeaveAlert=true \
    "${client_flags[@]}" \
    "${attach_wrapper[@]}"
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
