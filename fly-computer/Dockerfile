FROM denoland/deno:alpine

ENV FLYCTL_INSTALL=/usr/local
ENV PATH="${FLYCTL_INSTALL}/bin:${PATH}"

RUN apk add --no-cache nfs-utils curl \
  && curl -fsSL https://fly.io/install.sh | sh

RUN flyctl settings autoupdate disable
RUN flyctl settings analytics disable

WORKDIR /app

COPY . .

WORKDIR /app/fly-computer

RUN deno cache main.ts

CMD ["deno", "run", "-A", "main.ts"]
