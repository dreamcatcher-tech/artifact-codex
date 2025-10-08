FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
# enable 'universe' because musl-tools & clang live there
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    software-properties-common && \
    add-apt-repository --yes universe

# now install build deps
RUN apt-get install -y --no-install-recommends \
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
    docker.io \
    python3 \
    python3-pip \
    python3-venv \
    tmux \
    ttyd \
    lsof

RUN curl -fsSL https://deb.nodesource.com/setup_current.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs

# enable pnpm via corepack for the Node workspace
RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

# install latest Deno (stable) to /usr/local/bin
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && \
    deno --version

# allow passwordless sudo for the ubuntu user
RUN echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-ubuntu && chmod 0440 /etc/sudoers.d/90-ubuntu

RUN rm -rf /var/lib/apt/lists/*

# Ubuntu 24.04 ships with user 'ubuntu' already created with UID 1000.
USER ubuntu

# install Rust + musl target as dev user
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal && \
    ~/.cargo/bin/rustup target add aarch64-unknown-linux-musl x86_64-unknown-linux-musl && \
    ~/.cargo/bin/rustup component add clippy rustfmt

# snapshot testing tool for TUI
RUN ~/.cargo/bin/cargo install cargo-insta

ENV PATH="/home/ubuntu/.cargo/bin:${PATH}"



WORKDIR /workspace
