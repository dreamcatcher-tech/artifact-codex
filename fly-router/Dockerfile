FROM denoland/deno:latest

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends nfs-common \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /mnt/computers

USER deno

WORKDIR /app

COPY . .

WORKDIR /app/fly-router

RUN deno cache main.ts --config ../deno.json

ENTRYPOINT ["deno", "run", "-A", "main.ts"]
