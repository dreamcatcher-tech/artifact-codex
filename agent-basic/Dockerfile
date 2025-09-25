FROM denoland/deno:alpine-2.5.0

USER root

RUN apk add --no-cache nfs-utils util-linux coreutils curl \
  && mkdir -p /mnt/computers 

WORKDIR /app

COPY . .

RUN deno install --quiet

WORKDIR /app/agent-basic

ENTRYPOINT ["deno", "run", "-A"]
CMD [ "app.ts" ]