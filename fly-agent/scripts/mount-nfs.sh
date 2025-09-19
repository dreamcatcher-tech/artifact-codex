#!/usr/bin/env bash
set -euo pipefail

MOUNT_DIR="${FLY_NFS_MOUNT_DIR:-/mnt/fly-nfs}"
EXPORT_PATH="${FLY_NFS_EXPORT_PATH:-/data}"
MOUNT_OPTS="${FLY_NFS_MOUNT_OPTS:-nfsvers=4.1}"

DEFAULT_HOST="nfs-proto.internal"

if [ -n "${FLY_NFS_SOURCE:-}" ]; then
  SOURCE="${FLY_NFS_SOURCE}"
elif [ -n "${FLY_NFS_HOST:-}" ]; then
  SOURCE="${FLY_NFS_HOST}"
elif [ -n "${FLY_NFS_APP:-}" ]; then
  SOURCE="${FLY_NFS_APP}.internal"
else
  SOURCE="${DEFAULT_HOST}"
fi

if [ -z "${SOURCE}" ]; then
  echo "FLY_NFS_SOURCE/FLY_NFS_HOST/FLY_NFS_APP must be set" >&2
  exit 1
fi

if ! command -v mount.nfs >/dev/null 2>&1; then
  echo "mount.nfs not found" >&2
  exit 1
fi

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "mount-nfs.sh requires root privileges" >&2
  exit 1
fi

format_spec() {
  local host="$1"
  local export_path="$2"
  local raw="${host}"
  if [[ "${raw}" == \[*\] ]]; then
    raw="${raw#[}"
    raw="${raw%]}"
  fi

  if [[ "${raw}" == *:* && "${raw}" != *.* ]]; then
    printf '[%s]:%s' "${raw}" "${export_path}"
  else
    printf '%s:%s' "${raw}" "${export_path}"
  fi
}

SPEC="$(format_spec "${SOURCE}" "${EXPORT_PATH}")"

echo "[mount-nfs] mounting ${SPEC} -> ${MOUNT_DIR} with opts ${MOUNT_OPTS}" >&2
mkdir -p "${MOUNT_DIR}"

if mountpoint -q "${MOUNT_DIR}"; then
  echo "[mount-nfs] ${MOUNT_DIR} already mounted" >&2
  exit 0
fi

mount -t nfs4 -o "${MOUNT_OPTS}" "${SPEC}" "${MOUNT_DIR}"

mountpoint -q "${MOUNT_DIR}"
