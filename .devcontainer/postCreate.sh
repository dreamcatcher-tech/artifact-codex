#!/usr/bin/env bash
set -euo pipefail

phase="${1:-postCreate}"

sync_codex_config() {
  local dest_dir="$HOME/.codex"
  local host_dir="/tmp/host-codex"
  mkdir -p "$dest_dir"

  for f in auth.json config.toml; do
    if [[ -f "$host_dir/$f" ]]; then
      cp -f "$host_dir/$f" "$dest_dir/"
    fi
  done
}

install_fly_cli() {
  curl -fsSL https://fly.io/install.sh | sh
}

ensure_fly_path() {
  if ! grep -q '/.fly/bin' "$HOME/.bashrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.fly/bin:$PATH"' >>"$HOME/.bashrc"
  fi
}

ensure_docker_group() {
  local socket="/var/run/docker.sock"
  if [[ ! -S "$socket" ]]; then
    return 0
  fi

  local gid
  gid="$(stat -c '%g' "$socket")"

  if getent group docker >/dev/null 2>&1; then
    local current_gid
    current_gid="$(getent group docker | cut -d: -f3)"
    if [[ "$current_gid" != "$gid" ]]; then
      sudo groupmod -o -g "$gid" docker
    fi
  else
    sudo groupadd -g "$gid" docker
  fi

  if ! id -nG "$USER" | grep -qw docker; then
    sudo usermod -aG docker "$USER"
  fi
}

case "$phase" in
  postCreate)
    sync_codex_config
    install_fly_cli
    ensure_fly_path
    ensure_docker_group
    echo "postCreate: done"
    ;;
  postStart)
    ensure_docker_group
    echo "postStart: docker group ready"
    ;;
  *)
    echo "Unknown phase: $phase" >&2
    exit 1
    ;;
esac
