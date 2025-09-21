#!/usr/bin/env bash
set -euo pipefail

DEFAULT_MOUNT_DIR="${FLY_NFS_MOUNT_DIR:-/mnt/fly-nfs}"
DEFAULT_EXPORT_BASE="${FLY_NFS_EXPORT_PATH:-/data}"
DEFAULT_MOUNT_OPTS="${FLY_NFS_MOUNT_OPTS:-nfsvers=4.1}"
DEFAULT_HOST="nfs-proto.internal"

MOUNT_DIR="${DEFAULT_MOUNT_DIR}"
EXPORT_BASE="${DEFAULT_EXPORT_BASE}"
MOUNT_OPTS="${DEFAULT_MOUNT_OPTS}"
SUBPATH=""
SOURCE_OVERRIDE=""
HOST_OVERRIDE=""
APP_OVERRIDE=""

usage() {
  cat <<'USAGE'
Usage: mount-nfs.sh [SUBPATH] [options]

Mount an NFSv4 export, optionally scoping to a subpath within the share.

Arguments:
  SUBPATH           Optional path within the export to mount. If relative,
                    it is joined to the base export path (default /data).

Options:
  --export-path PATH    Override the base export path (default /data).
  --subpath PATH        Same as positional SUBPATH.
  --mount-dir DIR       Target directory on the local filesystem.
  --mount-opts OPTS     Options string passed to mount -o.
  --source HOST         Explicit NFS endpoint (takes precedence over others).
  --host HOST           Alias for --source.
  --app NAME            Resolve as NAME.internal when source not provided.
  -h, --help            Show this message.

Environment variables:
  FLY_NFS_SOURCE, FLY_NFS_HOST, FLY_NFS_APP override endpoint resolution.
  FLY_NFS_MOUNT_DIR sets the mount directory.
  FLY_NFS_EXPORT_PATH sets the base export path.
  FLY_NFS_MOUNT_OPTS sets mount options.
USAGE
}

normalize_path() {
  local path="${1}"
  if [[ -z "${path}" ]]; then
    printf '/\n'
    return 0
  fi
  if [[ "${path}" != /* ]]; then
    path="/${path}"
  fi
  path="$(printf '%s\n' "${path}" | sed -E 's#/+#/#g')"
  if [[ "${path}" != '/' ]]; then
    path="${path%/}"
  fi
  printf '%s\n' "${path}"
}

join_relative() {
  local base="${1}"
  local rel="${2}"
  if [[ -z "${rel}" ]]; then
    printf '%s\n' "$(normalize_path "${base}")"
    return 0
  fi
  if [[ "${rel}" == /* ]]; then
    normalize_path "${rel}"
  else
    normalize_path "${base%/}/${rel}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --export-path)
      if [[ $# -lt 2 ]]; then
        echo "--export-path requires a value" >&2
        exit 1
      fi
      EXPORT_BASE="$(normalize_path "$2")"
      shift 2
      ;;
    --subpath)
      if [[ $# -lt 2 ]]; then
        echo "--subpath requires a value" >&2
        exit 1
      fi
      if [[ -n "${SUBPATH}" ]]; then
        echo "Multiple subpaths provided" >&2
        exit 1
      fi
      SUBPATH="$2"
      shift 2
      ;;
    --mount-dir)
      if [[ $# -lt 2 ]]; then
        echo "--mount-dir requires a value" >&2
        exit 1
      fi
      MOUNT_DIR="$2"
      shift 2
      ;;
    --mount-opts)
      if [[ $# -lt 2 ]]; then
        echo "--mount-opts requires a value" >&2
        exit 1
      fi
      MOUNT_OPTS="$2"
      shift 2
      ;;
    --source)
      if [[ $# -lt 2 ]]; then
        echo "--source requires a value" >&2
        exit 1
      fi
      SOURCE_OVERRIDE="$2"
      shift 2
      ;;
    --host)
      if [[ $# -lt 2 ]]; then
        echo "--host requires a value" >&2
        exit 1
      fi
      HOST_OVERRIDE="$2"
      shift 2
      ;;
    --app)
      if [[ $# -lt 2 ]]; then
        echo "--app requires a value" >&2
        exit 1
      fi
      APP_OVERRIDE="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -n "${SUBPATH}" ]]; then
        echo "Unexpected extra argument: $1" >&2
        exit 1
      fi
      SUBPATH="$1"
      shift
      ;;
  esac
done

if [[ $# -gt 0 ]]; then
  if [[ -n "${SUBPATH}" ]]; then
    echo "Too many arguments" >&2
    exit 1
  fi
  SUBPATH="$1"
  shift
fi

if [[ $# -gt 0 ]]; then
  echo "Unexpected arguments: $*" >&2
  exit 1
fi

EXPORT_PATH="$(join_relative "${EXPORT_BASE}" "${SUBPATH}")"

if [[ -z "${SOURCE_OVERRIDE}" ]]; then
  if [[ -n "${FLY_NFS_SOURCE:-}" ]]; then
    SOURCE_OVERRIDE="${FLY_NFS_SOURCE}"
  elif [[ -n "${HOST_OVERRIDE}" ]]; then
    SOURCE_OVERRIDE="${HOST_OVERRIDE}"
  elif [[ -n "${FLY_NFS_HOST:-}" ]]; then
    SOURCE_OVERRIDE="${FLY_NFS_HOST}"
  elif [[ -n "${APP_OVERRIDE}" ]]; then
    SOURCE_OVERRIDE="${APP_OVERRIDE}.internal"
  elif [[ -n "${FLY_NFS_APP:-}" ]]; then
    SOURCE_OVERRIDE="${FLY_NFS_APP}.internal"
  else
    SOURCE_OVERRIDE="${DEFAULT_HOST}"
  fi
fi

SOURCE="${SOURCE_OVERRIDE}"

if [[ -z "${SOURCE}" ]]; then
  echo "An NFS host must be specified" >&2
  exit 1
fi

if ! command -v mount.nfs >/dev/null 2>&1; then
  echo "mount.nfs not found" >&2
  exit 1
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
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

mkdir -p "${MOUNT_DIR}"

echo "[mount-nfs] mounting ${SPEC} -> ${MOUNT_DIR} with opts ${MOUNT_OPTS}" >&2

if mountpoint -q "${MOUNT_DIR}"; then
  echo "[mount-nfs] ${MOUNT_DIR} already mounted" >&2
  exit 0
fi

mount -t nfs4 -o "${MOUNT_OPTS}" "${SPEC}" "${MOUNT_DIR}"

mountpoint -q "${MOUNT_DIR}"
