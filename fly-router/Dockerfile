FROM denoland/deno:latest

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends nfs-common \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /mnt/computers

USER deno

WORKDIR /app

COPY . .

RUN deno install --quiet

WORKDIR /app/fly-router

ENTRYPOINT ["deno", "run", "-A", "main.ts"]
