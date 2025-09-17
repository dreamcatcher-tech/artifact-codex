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

exec npx -y @openai/codex --cd "$CWD_ABS" "$@"
