#!/usr/bin/env bash
set -euo pipefail

RETRIES="${FLY_NFS_RETRIES:-5}"
DELAY="${FLY_NFS_RETRY_DELAY_SEC:-3}"
MOUNT_ENABLED="${FLY_NFS_ENABLE_MOUNT:-1}"

attempt_mount() {
  local attempt=1
  while [ "${attempt}" -le "${RETRIES}" ]; do
    if /usr/local/bin/mount-nfs.sh; then
      echo "[entrypoint] NFS mount ready" >&2
      return 0
    fi
    echo "[entrypoint] mount attempt ${attempt} failed; retrying in ${DELAY}s" >&2
    sleep "${DELAY}"
    attempt=$((attempt + 1))
  done
  echo "[entrypoint] Failed to mount NFS after ${RETRIES} attempts" >&2
  return 1
}

if [ "${MOUNT_ENABLED}" = "1" ]; then
  attempt_mount
else
  echo "[entrypoint] NFS mount disabled via FLY_NFS_ENABLE_MOUNT" >&2
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec deno run -A /agent/web-server/main.ts
