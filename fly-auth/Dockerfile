FROM denoland/deno:alpine-2.5.0

WORKDIR /app

COPY deno.json ./deno.json
COPY deno.lock ./deno.lock
COPY shared ./shared
COPY fly-auth ./fly-auth
COPY fly-computer ./fly-computer
COPY face-cmd ./face-cmd
COPY face-codex ./face-codex
COPY face-inspector ./face-inspector
COPY face-test ./face-test
COPY web-server ./web-server
COPY mcp-agents ./mcp-agents
COPY mcp-computers ./mcp-computers
COPY mcp-faces ./mcp-faces
COPY mcp-interactions ./mcp-interactions

WORKDIR /app/fly-auth

RUN deno cache main.ts --config ../deno.json

ENTRYPOINT ["deno", "run", "-A", "--config", "../deno.json", "main.ts"]
