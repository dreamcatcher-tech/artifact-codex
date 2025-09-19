FROM denoland/deno:alpine-2.5.0

WORKDIR /app

COPY deno.lock ./deno.lock
COPY fly-auth/ .

RUN deno cache main.ts

ENTRYPOINT ["deno", "run", "-A", "main.ts"]
