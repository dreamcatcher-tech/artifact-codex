#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${1:-nfs-proto}"
MOUNT_DIR="${2:-/mnt/fly-nfs}"
SUBPATH="${3:-}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "This script must run as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MOUNT_SCRIPT="${ROOT_DIR}/scripts/mount-nfs.sh"

if [[ ! -x "${MOUNT_SCRIPT}" ]]; then
  echo "mount script not found at ${MOUNT_SCRIPT}" >&2
  exit 1
fi

resolve_ipv6() {
  getent ahostsv6 "$1" | awk 'NR==1 {print $1; exit}'
}

TARGET_HOST="${APP_NAME}.flycast"
TARGET_ADDR="$(resolve_ipv6 "${TARGET_HOST}")"

if [[ -z "${TARGET_ADDR}" ]]; then
  echo "Failed to resolve ${TARGET_HOST} to an IPv6 address" >&2
  exit 1
fi

mkdir -p "${MOUNT_DIR}"

export FLY_NFS_MOUNT_DIR="${MOUNT_DIR}"
export FLY_NFS_SOURCE="${TARGET_ADDR}"
export FLY_NFS_EXPORT_PATH="${FLY_NFS_EXPORT_PATH:-/data}"
export FLY_NFS_MOUNT_OPTS="${FLY_NFS_MOUNT_OPTS:-nfsvers=4.1}"

if [[ -n "${SUBPATH}" ]]; then
  echo "Mounting ${TARGET_HOST} (${TARGET_ADDR}) subpath ${SUBPATH} to ${MOUNT_DIR}" >&2
  "${MOUNT_SCRIPT}" "${SUBPATH}"
else
  echo "Mounting ${TARGET_HOST} (${TARGET_ADDR}) to ${MOUNT_DIR}" >&2
  "${MOUNT_SCRIPT}"
fi

mount | grep "${MOUNT_DIR}" || true
