FROM denoland/deno:latest

WORKDIR /app

COPY . .
RUN deno cache fly-openai/main.ts

ENTRYPOINT [\
  "deno",\
  "run",\
  "--allow-env",\
  "--allow-net",\
  "fly-openai/main.ts"\
  ]
