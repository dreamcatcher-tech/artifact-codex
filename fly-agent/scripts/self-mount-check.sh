#!/usr/bin/env bash
set -euo pipefail

MOUNT_DIR="${FLY_NFS_CHECK_DIR:-$(mktemp -d /tmp/fly-nfs-check.XXXXXX)}"
EXPORT_PATH="${FLY_NFS_EXPORT_PATH:-/data}"
MOUNT_OPTS="${FLY_NFS_MOUNT_OPTS:-nfsvers=4.1}"

cleanup() {
  if mountpoint -q "${MOUNT_DIR}"; then
    umount "${MOUNT_DIR}" || true
  fi
  if [[ "${MOUNT_DIR}" == /tmp/fly-nfs-check.* ]]; then
    rm -rf "${MOUNT_DIR}"
  fi
}
trap cleanup EXIT

SOURCE="${FLY_NFS_SOURCE:-}" 
if [ -z "${SOURCE}" ] && [ -n "${FLY_TEST_MACHINE_IP:-}" ]; then
  SOURCE="${FLY_TEST_MACHINE_IP}"
fi
if [ -z "${SOURCE}" ]; then
  if [ -n "${FLY_NFS_HOST:-}" ]; then
    SOURCE="${FLY_NFS_HOST}"
  elif [ -n "${FLY_NFS_APP:-}" ]; then
    SOURCE="${FLY_NFS_APP}.internal"
  else
    SOURCE="nfs-proto.internal"
  fi
fi

export FLY_NFS_MOUNT_DIR="${MOUNT_DIR}"
export FLY_NFS_SOURCE="${SOURCE}"
export FLY_NFS_MOUNT_OPTS="${MOUNT_OPTS}"
export FLY_NFS_EXPORT_PATH="${EXPORT_PATH}"

if ! /usr/local/bin/mount-nfs.sh; then
  echo "self-mount-check: mount failed" >&2
  exit 1
fi

ls -al "${MOUNT_DIR}" >&2

tmpfile="${MOUNT_DIR}/.fly-agent-check-$$"

touch "${tmpfile}"
rm -f "${tmpfile}"

echo "self-mount-check: mount succeeded" >&2
