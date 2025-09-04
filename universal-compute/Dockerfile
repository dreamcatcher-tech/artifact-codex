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

# --- Zsh + powerlevel10k + MesloLGS NF --------------------------------------
# Set default runtime shell env to zsh (tmux will also be configured below).
ENV SHELL=/usr/bin/zsh

# Install fontconfig for fc-cache and fetch Powerlevel10k + recommended font.
# Note: the MesloLGS NF font improves glyph rendering for the theme. While
# fonts ultimately render client-side in browser terminals, installing them in
# the container helps local terminals and GUI apps, and documents the default.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends fontconfig ca-certificates; \
  rm -rf /var/lib/apt/lists/*; \
  \
  # Install powerlevel10k theme system-wide
  git clone --depth=1 https://github.com/romkatv/powerlevel10k.git /usr/local/share/powerlevel10k; \
  \
  # Install MesloLGS NF (Regular/Bold/Italic/Bold Italic)
  install -d -m 0755 /usr/local/share/fonts/truetype/meslo; \
  curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Regular.ttf" \
    "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Regular.ttf"; \
  curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Bold.ttf" \
    "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Bold.ttf"; \
  curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Italic.ttf" \
    "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Italic.ttf"; \
  curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Bold Italic.ttf" \
    "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Bold%20Italic.ttf"; \
  fc-cache -f >/dev/null 2>&1 || true; \
  \
  # Minimal .zshrc that loads powerlevel10k and disables the first-run wizard.
  printf '%s\n' \
    'export LANG=${LANG:-C.UTF-8}' \
    'export LC_ALL=${LC_ALL:-C.UTF-8}' \
    'export SHELL=/usr/bin/zsh' \
    'POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true' \
    '[[ -r /usr/local/share/powerlevel10k/powerlevel10k.zsh-theme ]] && \
source /usr/local/share/powerlevel10k/powerlevel10k.zsh-theme' \
    > /root/.zshrc

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
