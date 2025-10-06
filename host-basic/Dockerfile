FROM denoland/deno:latest

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends nfs-common util-linux curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /mnt/computers

WORKDIR /app

COPY . .

WORKDIR /app/host-basic

RUN deno cache --quiet main.ts

ENV DEBUG=@artifact/host-basic*
ENV DEBUG_COLORS=1
ENV DEBUG_HIDE_DATE=1

ENTRYPOINT ["deno", "run", "-A"]
CMD [ "main.ts" ]
