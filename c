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

ensure_line_in_file() {
  local file="$1"
  local line="$2"

  mkdir -p -- "$(dirname -- "$file")"
  if [[ -f "$file" ]] && grep -Fqx -- "$line" "$file"; then
    return 1
  fi

  printf '%s\n' "$line" >>"$file"
  return 0
}

# Format kilobytes as megabytes with thousands separators.
format_megabytes() {
  local kilobytes="$1"
  local mb_times_100=$(( (kilobytes * 100 + 512) / 1024 ))
  local int_part=$(( mb_times_100 / 100 ))
  local frac_part=$(( mb_times_100 % 100 ))
  local int_str="$int_part"
  local formatted=""

  while (( ${#int_str} > 3 )); do
    formatted=",${int_str: -3}$formatted"
    int_str="${int_str:0:${#int_str}-3}"
  done

  formatted="${int_str}${formatted}"
  printf '%s.%02d' "$formatted" "$frac_part"
}

# Self-install symlink to ~/.local/bin/c
TARGET_DIR="$HOME/.local/bin"
TARGET="$TARGET_DIR/c"
mkdir -p -- "$TARGET_DIR"
ln -sf -- "$SELF" "$TARGET"

if [[ ":${PATH}:" != *":${TARGET_DIR}:"* ]]; then
  export PATH="$TARGET_DIR:$PATH"
  command -v hash >/dev/null 2>&1 && hash -r || true

  SHELL_NAME="${SHELL:-sh}"
  SHELL_NAME="${SHELL_NAME##*/}"

  PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
  declare -a CONFIG_FILES=()

  case "$SHELL_NAME" in
    fish)
      PATH_LINE='set -gx PATH $HOME/.local/bin $PATH'
      CONFIG_FILES=("$HOME/.config/fish/config.fish")
      ;;
    bash)
      CONFIG_FILES=("$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile" "$HOME/.bashrc")
      ;;
    zsh)
      CONFIG_FILES=("$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.profile")
      ;;
    *)
      CONFIG_FILES=("$HOME/.profile")
      ;;
  esac

  declare -a UPDATED_FILES=()

  for candidate in "${CONFIG_FILES[@]}"; do
    if ensure_line_in_file "$candidate" "$PATH_LINE"; then
      UPDATED_FILES+=("$candidate")
    fi
  done

  if (( ${#UPDATED_FILES[@]} > 0 )); then
    printf 'Added %s to PATH via:%s\n' "$TARGET_DIR" "${UPDATED_FILES[*]/#/ }"
    if [[ "$SHELL_NAME" == "fish" ]]; then
      echo "Restart your shell or run 'source <file>' for each updated file to load it now."
    else
      echo "Restart your shell or run '. \"<file>\"' for each updated file to load it now."
    fi
  else
    echo "$TARGET_DIR already configured in shell startup files."
  fi
fi

# Ensure npx is available
if ! command -v npx >/dev/null 2>&1; then
  echo "Error: 'npx' is not installed or not on PATH." >&2
  echo "Install Node.js which provides npx: https://nodejs.org/" >&2
  exit 127
fi

# Use the caller's absolute working directory for codex's own --cd argument
CWD_ABS="$(pwd -P)"

TIME_OUTPUT="$(mktemp)"
cleanup_time_output() {
  rm -f -- "$TIME_OUTPUT"
}
trap cleanup_time_output EXIT

if /usr/bin/time -f '%M' -o "$TIME_OUTPUT" npx -y @openai/codex --cd "$CWD_ABS" "$@"; then
  STATUS=0
else
  STATUS=$?
fi

if [[ -s "$TIME_OUTPUT" ]]; then
  PEAK_KB="$(<"$TIME_OUTPUT")"
  if [[ "$PEAK_KB" =~ ^[0-9]+$ ]]; then
    PEAK_MB="$(format_megabytes "$PEAK_KB")"
    >&2 printf '\n\tPeak RAM: %s MB\n\n' "$PEAK_MB"
  else
    >&2 printf '\n\tPeak RAM: %s kB\n\n' "$PEAK_KB"
  fi
fi

exit "$STATUS"
