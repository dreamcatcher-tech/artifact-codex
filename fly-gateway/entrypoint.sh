#!/usr/bin/env sh
set -Eeuo pipefail

# Optional: dbus for ganesha control tooling
if command -v dbus-daemon >/dev/null 2>&1; then
  mkdir -p /var/run/dbus || true
  dbus-daemon --system --fork || true
fi

# Optional: rpcbind (not required for NFSv4, but quiets some client/tooling expectations)
if command -v rpcbind >/dev/null 2>&1; then
  rpcbind || true
fi

# Ensure ganesha state dir exists
mkdir -p /var/lib/nfs/ganesha || true

# Run ganesha in the foreground; log to stderr/stdout
exec ganesha.nfsd -F -f /etc/ganesha/ganesha.conf -N EVENT
