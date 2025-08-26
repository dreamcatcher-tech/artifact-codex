## Dockerfile to package the environment and install the Codex CLI from npm
## Usage (local):
##   docker build -t codex:latest .
##   docker run --rm codex:latest codex --help

ARG DEBIAN_FRONTEND=noninteractive
FROM debian:bookworm-slim

# Core tooling for runtime/developer experience on Debian
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    build-essential \
    clang \
    curl \
    dnsutils \
    git \
    git-lfs \
    gh \
    gnupg \
    iproute2 \
    ipset \
    iptables \
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
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for app runtime
RUN useradd -m -u 10001 codex

# Node.js via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_current.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# enable pnpm via corepack for the Node workspace
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

# install latest Deno (stable) to /usr/local/bin
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && deno --version

# Install Codex CLI from npm (latest)
RUN npm i -g @openai/codex && \
    codex --version || true

# install Rust + musl targets as ubuntu user
USER codex

RUN mkdir -p /home/codex/.codex
COPY --chown=codex:codex fly.config.toml /home/codex/.codex/config.toml

RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal && \
    ~/.cargo/bin/rustup target add aarch64-unknown-linux-musl x86_64-unknown-linux-musl && \
    ~/.cargo/bin/rustup component add clippy rustfmt && \
    ~/.cargo/bin/cargo install cargo-insta

ENV PATH="/home/codex/.cargo/bin:${PATH}"


# Copy only what's needed to run the MCP web server
COPY --chown=codex:codex mcp-server /mcp-server

# Pre-cache Deno deps for faster cold starts (non-fatal if network blocked later)
RUN deno cache -A /mcp-server/start.ts

WORKDIR /workspace

# Default entrypoint runs the MCP web server
# Listens on PORT (default 8080) for Fly's internal HTTP service
EXPOSE 8080
ENTRYPOINT ["deno", "run", "-A", "mcp-server/start.ts"]
CMD []
