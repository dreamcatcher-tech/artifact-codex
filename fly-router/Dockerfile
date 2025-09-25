FROM denoland/deno:latest

USER root

RUN apk add --no-cache nfs-utils 
RUN mkdir -p /mnt/computers

USER deno

WORKDIR /app

COPY . .

WORKDIR /app/fly-router

RUN deno cache main.ts --config ../deno.json

ENTRYPOINT ["deno", "run", "-A", "main.ts"]
