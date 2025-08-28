## Dockerfile to package the environment and install the Codex CLI from npm
## Usage (local):
##   docker build -t codex:latest .
##   docker run --rm codex:latest codex --help

ARG DEBIAN_FRONTEND=noninteractive
FROM node:22-bookworm-slim

# Core tooling for runtime/developer experience on Debian
RUN apt-get update && \
  apt-get install -y --no-install-recommends \
  ca-certificates \
  build-essential \
  clang \
  curl \
  wget \
  dnsutils \
  git \
  git-lfs \
  gnupg \
  iproute2 \
  iputils-ping \
  traceroute \
  mtr-tiny \
  ipset \
  iptables \
  net-tools \
  netcat-openbsd \
  jq \
  less \
  libssl-dev \
  lld \
  man-db \
  musl-tools \
  pkg-config \
  procps \
  ripgrep \
  sudo \
  unzip \
  zsh \
  bash-completion \
  fzf \
  openssh-client \
  gh \
  rustc \
  cargo \
  && rm -rf /var/lib/apt/lists/*

# Install latest Deno (stable) system-wide
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && deno --version

# Install Codex CLI from npm (latest)
RUN npm i -g @openai/codex

# codex config
RUN codex --version
COPY fly.config.toml /root/.codex/config.toml

# Copy only what's needed to run the MCP web server
COPY mcp-server /mcp-server

# Pre-cache Deno deps for faster cold starts
WORKDIR /mcp-server
RUN deno cache --quiet start.ts

WORKDIR /workspace

# Default entrypoint runs the MCP web server
# Listens on PORT (default 8080) for Fly's internal HTTP service
EXPOSE 8080
ENTRYPOINT ["deno", "run", "-A", "/mcp-server/start.ts"]
CMD []
