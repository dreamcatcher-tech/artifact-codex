#!/usr/bin/env bash
set -euo pipefail

MOUNT_DIR="/tmp/fly-nfs-check"
TARGET_IP="${FLY_TEST_MACHINE_IP:-}"
SUBPATH="${FLY_NFS_SELF_CHECK_SUBPATH:-}"
BASE_EXPORT="/data"
MOUNT_OPTS="${FLY_NFS_MOUNT_OPTS:-nfsvers=4.1}"

if [ -z "${TARGET_IP}" ]; then
  echo "FLY_TEST_MACHINE_IP not set; this script should run as a Fly machine check" >&2
  exit 1
fi

cleanup() {
  if mountpoint -q "${MOUNT_DIR}"; then
    umount "${MOUNT_DIR}" || true
  fi
  rm -rf "${MOUNT_DIR}"
}
trap cleanup EXIT

mkdir -p "${MOUNT_DIR}"

export FLY_NFS_MOUNT_DIR="${MOUNT_DIR}"
export FLY_NFS_MOUNT_OPTS="${MOUNT_OPTS}"

if [[ -n "${SUBPATH}" ]]; then
  echo "[self-check] mounting ${TARGET_IP}:${SUBPATH} to ${MOUNT_DIR}" >&2
  /usr/local/bin/mount-nfs.sh "${SUBPATH}" --source "${TARGET_IP}"
else
  echo "[self-check] mounting ${TARGET_IP} (base ${BASE_EXPORT}) to ${MOUNT_DIR}" >&2
  /usr/local/bin/mount-nfs.sh --source "${TARGET_IP}"
fi

# basic smoke: list directory, create temp file
ls -al "${MOUNT_DIR}" >&2

tmpfile="${MOUNT_DIR}/.fly-self-check-$$"

touch "${tmpfile}"
rm -f "${tmpfile}"

cleanup

echo "[self-check] mount successful" >&2
