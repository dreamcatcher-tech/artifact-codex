# NFSv4 server on Fly.io (NFS-Ganesha + Fly Volume)

Prototype-grade, userspace NFSv4 server (NFS-Ganesha) that exports a Fly Volume
from a private Fly app. Optimized for **ease of implementation** over hardening
or performance.

> **Security note:** This app is private by default (no `[[services]]`). Access
> it over Fly's WireGuard network (`*.internal` hostname). Do **not** expose NFS
> to the public Internet for production.

---

## Quick start

### 0) Prereqs

- Fly CLI installed and authenticated
- An organization set in Fly (use `fly orgs list`)
- Linux (or macOS) client that can mount NFSv4
- For access: join your machine to Fly's WireGuard network
  (`fly wireguard create`).

### 1) Initialize the app (no deploy yet)

```bash
fly launch --no-deploy --name nfs-proto
```

If you already created an app, just make sure the `app` name in `fly.toml`
matches.

### 2) Create a Fly Volume and mount point

```bash
# Pick a region close to your clients, e.g. iad, ord, sjc, fra, etc.
fly volumes create nfsdata --size 10 --region <REGION>
```

The volume will be mounted at `/data` inside the Machine by `[[mounts]]` in
`fly.toml`.

### 3) Deploy

```bash
fly deploy
```

### 4) Join the private network from your client

Create a WireGuard peer and bring it up on your laptop/server:

```bash
# Creates a WireGuard peer configuration file
fly wireguard create --org <YOUR_ORG> --name my-laptop
# Follow the printed instructions to bring up the interface (wg-quick up ...).
```

Once connected, your app resolves at `nfs-proto.internal` (IPv6).

### 5) Mount from a Linux client (NFSv4.1)

```bash
sudo mkdir -p /mnt/fly-nfs
sudo mount -t nfs -o nfsvers=4.1,proto=tcp nfs-proto.internal:/data /mnt/fly-nfs
```

> On NFSv4, `showmount -e` won’t work (that’s an NFSv3 RPC). Use the mount
> command directly.

You now have `/mnt/fly-nfs` backed by the Fly Volume.

---

## Files

- `Dockerfile` — Debian + NFS-Ganesha userspace server
- `entrypoint.sh` — Starts (optionally) `dbus` and `rpcbind` then runs Ganesha
  in the foreground
- `ganesha.conf` — Minimal NFSv4-only export of `/data`
- `fly.toml` — Private Fly app; mounts volume at `/data`
- `scripts/client-mount-linux.sh` — Convenience mount script
- `.dockerignore`, `.gitignore` — hygiene

---

## Notes / trade-offs

- Single Machine + single Volume. Volumes are **local to one Machine**; no
  shared multi-writer storage.
- NFSv4 only, AUTH_SYS (`SecType = sys`). Good enough for prototypes; add
  Kerberos/etc for real deployments.
- Ganesha runs in userspace; no kernel `nfsd` required.
- Logging goes to stdout/stderr of the container for Fly logs.
- If the Machine restarts, NFSv4 client reclaim is not guaranteed
  (`Graceless = true`). For stricter semantics, remove that line and consider
  persisting Ganesha state under the volume.

---

## Teardown

```bash
# Unmount from clients
sudo umount /mnt/fly-nfs || true

# Destroy app and volume (irreversible)
fly apps destroy nfs-proto
fly volumes list
fly volumes destroy <VOLUME_ID>
```
