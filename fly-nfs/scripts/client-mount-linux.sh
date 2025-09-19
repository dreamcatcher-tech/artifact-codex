#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${1:-nfs-proto}"
MOUNT_DIR="${2:-/mnt/fly-nfs}"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "This script must run as root" >&2
  exit 1
fi

resolve_ipv6() {
  getent ahostsv6 "$1" | awk 'NR==1 {print $1; exit}'
}

TARGET_HOST="${APP_NAME}.flycast"
TARGET_ADDR="$(resolve_ipv6 "${TARGET_HOST}")"

if [ -z "${TARGET_ADDR}" ]; then
  echo "Failed to resolve ${TARGET_HOST} to an IPv6 address" >&2
  exit 1
fi

if [[ "${TARGET_ADDR}" == *:* ]]; then
  SPEC="[${TARGET_ADDR}]:/data"
else
  SPEC="${TARGET_ADDR}:/data"
fi

MNT_OPTS="nfsvers=4.1"

echo "Mounting ${TARGET_HOST} (${TARGET_ADDR}) to ${MOUNT_DIR} (NFSv4.1)"
mkdir -p "${MOUNT_DIR}"
mount -t nfs4 -o "${MNT_OPTS}" "${SPEC}" "${MOUNT_DIR}"

mount | grep "${MOUNT_DIR}" || true
