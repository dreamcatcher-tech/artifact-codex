#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${1:-nfs-proto}"
MOUNT_DIR="${2:-/mnt/fly-nfs}"

echo "Mounting ${APP_NAME}.internal:/data to ${MOUNT_DIR} (NFSv4.1)"
sudo mkdir -p "${MOUNT_DIR}"
sudo mount -t nfs -o nfsvers=4.1,proto=tcp "${APP_NAME}.internal:/data" "${MOUNT_DIR}"

echo "Mounted filesystems:"
mount | grep "${MOUNT_DIR}" || true
