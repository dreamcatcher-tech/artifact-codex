FROM denoland/deno:alpine-2.5.0

USER root

ENV FLYCTL_INSTALL=/usr/local
ENV PATH="${FLYCTL_INSTALL}/bin:${PATH}"

RUN apk add --no-cache nfs-utils util-linux coreutils curl \
  && mkdir -p /mnt/computers \
  && curl -fsSL https://fly.io/install.sh | sh

RUN flyctl settings autoupdate disable
RUN flyctl settings analytics disable

WORKDIR /app

COPY . .

WORKDIR /app/fly-auth

RUN deno cache main.ts --config ../deno.json

ENTRYPOINT ["deno", "run", "-A", "--config", "../deno.json", "main.ts"]
