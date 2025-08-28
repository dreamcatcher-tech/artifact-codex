
# shared, interactive session that runs `codex` via a login+interactive shell
SESSION=codex-demo SOCKET=codex-sock PORT=7681 SCROLL=200000 \
&& tmux -L "$SOCKET" -f /dev/null new-session -Ad -s "$SESSION" \
     "bash -ilc 'exec c -- hi || exec bash -il'" \
&& tmux -L "$SOCKET" set -g status off \; set -g history-limit "$SCROLL" \
&& ttyd -W -p "$PORT" -t scrollback="$SCROLL" tmux -L "$SOCKET" attach -t "$SESSION"
