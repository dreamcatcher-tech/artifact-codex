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
  fontconfig \
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
  htop \
  nnn \
  nfs-common \
  tmux \
  lsof \
  ttyd && \
  rm -rf /var/lib/apt/lists/*


COPY --from=node /usr/local/ /usr/local/

# Install latest Deno (stable) system-wide
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && deno --version

RUN npm i -g npm
RUN npm i -g @openai/codex

# Copy only what's needed to run the MCP web server
COPY . /agent

RUN set -eux; \
  SRC="/agent/fly-agent"; \
  install -Dm644 "${SRC}/codex.config.toml" /root/.codex/config.toml; \
  install -Dm755 "${SRC}/entrypoint.sh" /entrypoint.sh; \
  install -Dm755 "${SRC}/scripts/mount-nfs.sh" /usr/local/bin/mount-nfs.sh; \
  install -Dm755 "${SRC}/scripts/self-mount-check.sh" /usr/local/bin/self-mount-check.sh

# Pre-cache Deno deps for faster cold starts
RUN deno install --quiet

WORKDIR /workspace

ENV PORT="8080"

ENTRYPOINT ["/entrypoint.sh"]
