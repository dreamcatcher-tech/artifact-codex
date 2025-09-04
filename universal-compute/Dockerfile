ARG NODE_MAJOR=22
FROM node:${NODE_MAJOR}-bookworm-slim AS node

ARG DEBIAN_FRONTEND=noninteractive
FROM ubuntu:24.04


# Enable universe and install core tooling (includes ttyd from Ubuntu repos)
RUN apt-get update && \
  apt-get install -y --no-install-recommends software-properties-common && \
  add-apt-repository --yes universe && \
  apt-get update && \
  apt-get install -y --no-install-recommends \
  ca-certificates \
  # build-essential \
  # clang \
  curl \
  wget \
  dnsutils \
  git \
  # git-lfs \
  # gnupg \
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
  # libssl-dev \
  # lld \
  # musl-tools \
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
  nano \
  tmux \
  htop \
  ttyd && \
  rm -rf /var/lib/apt/lists/*


COPY --from=node /usr/local/ /usr/local/

# Install latest Deno (stable) system-wide
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && deno --version

RUN npm i -g npm
RUN npm i -g @openai/codex
COPY codex.config.toml /root/.codex/config.toml

# Copy only what's needed to run the MCP web server
COPY fly-mcp /fly-mcp

# Pre-cache Deno deps for faster cold starts
WORKDIR /fly-mcp
RUN deno cache --quiet main.ts

WORKDIR /workspace

# Default entrypoint runs the MCP web server
# Listens on PORT (default 8080) for Fly's internal HTTP service
EXPOSE 8080

ENV PORT=8080
# ENV AUTOSTART_CMD="npx -y @openai/codex"
ENV PRE_CMD="/fly-mcp/pre.ts"
ENV SIXEL="on"
COPY tmux.sh /tmux.sh
ENTRYPOINT ["/tmux.sh"]
CMD []
