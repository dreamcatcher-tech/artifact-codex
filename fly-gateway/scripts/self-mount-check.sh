#!/usr/bin/env bash
set -euo pipefail

MOUNT_DIR="/tmp/fly-nfs-check"
TARGET_IP="${FLY_TEST_MACHINE_IP:-}"
if [ -z "${TARGET_IP}" ]; then
  echo "FLY_TEST_MACHINE_IP not set; this script should run as a Fly machine check" >&2
  exit 1
fi

TARGET="[${TARGET_IP}]:/data"
MOUNT_OPTS="nfsvers=4.1"

cleanup() {
  if mountpoint -q "${MOUNT_DIR}"; then
    umount "${MOUNT_DIR}" || true
  fi
  rm -rf "${MOUNT_DIR}"
}
trap cleanup EXIT

mkdir -p "${MOUNT_DIR}"

if ! command -v mount.nfs >/dev/null 2>&1; then
  echo "mount.nfs not found" >&2
  exit 1
fi

echo "[self-check] mounting ${TARGET} to ${MOUNT_DIR}" >&2
mount -t nfs4 -o "${MOUNT_OPTS}" "${TARGET}" "${MOUNT_DIR}"

# basic smoke: list directory, create temp file
ls -al "${MOUNT_DIR}" >&2

tmpfile="${MOUNT_DIR}/.fly-self-check-$$"

touch "${tmpfile}"
rm -f "${tmpfile}"

cleanup

echo "[self-check] mount successful" >&2
