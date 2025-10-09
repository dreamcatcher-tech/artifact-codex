FROM denoland/deno:latest

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends nfs-common \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /mnt/computers

WORKDIR /app

COPY . .

RUN deno install --quiet

WORKDIR /app/fly-router

ENV DEBUG=@artifact/*
ENV DEBUG_COLORS=1
ENV DEBUG_HIDE_DATE=1

ENTRYPOINT ["deno", "run", "-A", "main.ts"]
