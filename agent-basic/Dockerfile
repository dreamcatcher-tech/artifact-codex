FROM denoland/deno:alpine-2.5.0

USER root

RUN apk add --no-cache nfs-utils util-linux coreutils curl \
  && mkdir -p /mnt/computers 

WORKDIR /app

COPY . .

WORKDIR /app/agent-basic

RUN deno cache main.ts --config ../deno.json

ENTRYPOINT ["deno", "run", "-A", "--config", "../deno.json"]
CMD [ "app.ts" ]