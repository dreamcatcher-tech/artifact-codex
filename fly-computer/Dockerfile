FROM denoland/deno:debian-2.5.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends nfs-common bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY deno.lock /app/deno.lock
COPY shared /app/shared
COPY fly-agent/scripts/mount-nfs.sh /usr/local/bin/mount-nfs.sh
COPY fly-computer /app/fly-computer

RUN chmod +x /usr/local/bin/mount-nfs.sh /app/fly-computer/entrypoint.sh

WORKDIR /app/fly-computer

RUN deno cache main.ts

ENTRYPOINT ["./entrypoint.sh"]
