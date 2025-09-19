#!/usr/bin/env sh
set -eu

# Ganesha refuses to register exports without a running system dbus session.
if command -v dbus-daemon >/dev/null 2>&1; then
  mkdir -p /var/run/dbus || true
  dbus-daemon --system --fork || true
fi

# Even in NFSv4-only mode Ganesha tries to talk to rpcbind during init.
if command -v rpcbind >/dev/null 2>&1; then
  rpcbind || true
fi

# Ganesha creates PID and socket files under these directories on boot.
mkdir -p /var/lib/nfs/ganesha || true
mkdir -p /var/run/ganesha || true

exec ganesha.nfsd -F -f /etc/ganesha/ganesha.conf -L STDOUT -N EVENT
