FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    nfs-ganesha \
    nfs-ganesha-vfs \
    rpcbind \
    dbus \
  && rm -rf /var/lib/apt/lists/*

# Volume mountpoint (Fly will mount here)
RUN mkdir -p /data

COPY ganesha.conf /etc/ganesha/ganesha.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# NFSv4 uses TCP 2049
EXPOSE 2049/tcp

CMD ["/entrypoint.sh"]
