FROM denoland/deno:alpine

RUN apk add --no-cache nfs-utils

WORKDIR /app

COPY . .

WORKDIR /app/fly-computer

RUN deno cache main.ts

CMD ["deno", "run", "-A", "main.ts"]
