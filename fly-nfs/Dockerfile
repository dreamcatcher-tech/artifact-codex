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

WORKDIR /app

COPY . .

WORKDIR /app/fly-nfs

# Copy ganesha config from build context into container
COPY fly-nfs/ganesha.conf /etc/ganesha/ganesha.conf

CMD ["/app/fly-nfs/entrypoint.sh"]
