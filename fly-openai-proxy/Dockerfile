FROM denoland/deno:latest

WORKDIR /app

COPY deno.json deno.lock ./
COPY fly-openai-proxy ./fly-openai-proxy

RUN deno cache fly-openai-proxy/src/main.ts

ENTRYPOINT [\
  "deno",\
  "run",\
  "--allow-env",\
  "--allow-net",\
  "fly-openai-proxy/src/main.ts"\
  ]
