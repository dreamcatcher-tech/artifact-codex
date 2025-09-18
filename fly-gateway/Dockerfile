FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    nfs-ganesha \
    nfs-ganesha-vfs \
    nfs-common \
    rpcbind \
    dbus \
  && rm -rf /var/lib/apt/lists/*

# Ensure /etc/mtab exists for ganesha VFS FSAL detection
RUN ln -sf /proc/self/mounts /etc/mtab

# Volume mountpoint (Fly will mount here)
RUN mkdir -p /data

COPY ganesha.conf /etc/ganesha/ganesha.conf
COPY entrypoint.sh /entrypoint.sh
COPY scripts/self-mount-check.sh /self-mount-check.sh
RUN chmod +x /entrypoint.sh
RUN chmod +x /self-mount-check.sh

# NFSv4 uses TCP 2049
EXPOSE 2049/tcp

CMD ["/entrypoint.sh"]
