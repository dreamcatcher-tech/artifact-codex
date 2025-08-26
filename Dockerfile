## Multi-stage Dockerfile to build and package the `codex` binary
## Usage (local):
##   docker build -t codex:latest .
##   docker run --rm codex:latest codex --help

FROM rust:1.89-slim-bookworm AS build

# Create app user early to avoid copying files with root ownership into
# the final image when using BuildKit cache mounts.
RUN useradd -m -u 10001 appuser

WORKDIR /app

# Install minimal native deps common to Rust crates
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates pkg-config build-essential libssl-dev \
    && rm -rf /var/lib/apt/lists/*


COPY . .

# Build only the CLI binary from the Rust workspace under codex/codex-rs
# Note: the Rust workspace lives under the nested `codex/codex-rs` folder
# in this repository layout.
WORKDIR /app/codex/codex-rs
RUN cargo build --release -p codex-cli

ARG DEBIAN_FRONTEND=noninteractive
FROM ubuntu:24.04

# enable 'universe' because musl-tools & clang live there
RUN apt-get update && \
    apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository --yes universe && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    software-properties-common \
    build-essential \
    curl \
    dnsutils \
    git \
    ca-certificates \
    pkg-config \
    clang \
    lld \
    musl-tools \
    libssl-dev \
    just \
    aggregate \
    git-lfs \
    bash-completion \
    sudo \
    fzf \
    gh \
    gnupg2 \
    iproute2 \
    ipset \
    iptables \
    jq \
    less \
    man-db \
    procps \
    unzip \
    ripgrep \
    zsh \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Node.js via NodeSource + Codex CLI
RUN curl -fsSL https://deb.nodesource.com/setup_current.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g '@openai/codex' && \
    rm -rf /var/lib/apt/lists/*

# enable pnpm via corepack for the Node workspace
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

# install latest Deno (stable) to /usr/local/bin
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && deno --version


# Copy the compiled CLI from the build stage
COPY --from=build /app/codex/codex-rs/target/release/codex /usr/local/bin/codex

# install Rust + musl targets as ubuntu user
USER ubuntu

RUN mkdir -p /home/ubuntu/.codex
COPY --chown=ubuntu:ubuntu fly.config.toml /home/ubuntu/.codex/config.toml

RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal && \
    ~/.cargo/bin/rustup target add aarch64-unknown-linux-musl x86_64-unknown-linux-musl && \
    ~/.cargo/bin/rustup component add clippy rustfmt && \
    ~/.cargo/bin/cargo install cargo-insta

ENV PATH="/home/ubuntu/.cargo/bin:${PATH}"

WORKDIR /workspace

# Copy only what's needed to run the MCP web server
COPY --chown=ubuntu:ubuntu mcp-server /workspace/mcp-server

# Pre-cache Deno deps for faster cold starts (non-fatal if network blocked later)
RUN deno cache -A /workspace/mcp-server/start.ts

# Default entrypoint runs the MCP web server
# Listens on PORT (default 8080) for Fly's internal HTTP service
EXPOSE 8080
ENTRYPOINT ["deno", "run", "-A", "--unstable", "mcp-server/start.ts"]
CMD []
