#!/usr/bin/env bash
set -euo pipefail
set -x

# This script installs Powerlevel10k and MesloLGS NF fonts,
# and writes a minimal /root/.zshrc to load the theme.
# It is intended to be called during Docker build to declutter the Dockerfile.

export DEBIAN_FRONTEND=${DEBIAN_FRONTEND:-noninteractive}

# Install powerlevel10k theme system-wide if not already present.
if [ ! -d /usr/local/share/powerlevel10k ]; then
  git clone --depth=1 https://github.com/romkatv/powerlevel10k.git /usr/local/share/powerlevel10k
fi

# Install MesloLGS NF fonts recommended by Powerlevel10k.
install -d -m 0755 /usr/local/share/fonts/truetype/meslo
curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Regular.ttf" \
  "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Regular.ttf"
curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Bold.ttf" \
  "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Bold.ttf"
curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Italic.ttf" \
  "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Italic.ttf"
curl -fsSL -o "/usr/local/share/fonts/truetype/meslo/MesloLGS NF Bold Italic.ttf" \
  "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20Bold%20Italic.ttf"

# Rebuild font cache if fc-cache is available.
fc-cache -f >/dev/null 2>&1 || true

# Minimal .zshrc that loads powerlevel10k and disables the first-run wizard.
cat > /root/.zshrc <<'EOF'
export LANG=${LANG:-C.UTF-8}
export LC_ALL=${LC_ALL:-C.UTF-8}
export SHELL=/usr/bin/zsh
POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true
[[ -r /usr/local/share/powerlevel10k/powerlevel10k.zsh-theme ]] && \
source /usr/local/share/powerlevel10k/powerlevel10k.zsh-theme
EOF
