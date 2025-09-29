FROM denoland/deno:latest

WORKDIR /app

COPY . . 
RUN deno cache fly-openai/src/main.ts

ENTRYPOINT [\
  "deno",\
  "run",\
  "--allow-env",\
  "--allow-net",\
  "fly-openai/src/main.ts"\
  ]
