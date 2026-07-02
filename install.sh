#!/bin/bash
#
# Install script for corsa
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tomagranate/corsa/main/install.sh | bash
#
# Environment variables:
#   INSTALL_DIR  - Installation directory (default: /usr/local/bin or ~/.local/bin)
#   VERSION      - Specific version to install (default: latest)
#

set -e

# Configuration
REPO="tomagranate/corsa"
GITHUB_URL="https://github.com/${REPO}"
RELEASES_URL="${GITHUB_URL}/releases"

# Colors and formatting
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'

# Box drawing characters
BOX_TL="╭"
BOX_TR="╮"
BOX_BL="╰"
BOX_BR="╯"
BOX_H="─"
BOX_V="│"

print_header() {
    echo
    echo -e "${CYAN}${BOLD}"
    echo "  ╭─────────────────────────────────╮"
    echo "  │          corsa installer        │"
    echo "  ╰─────────────────────────────────╯"
    echo -e "${RESET}"
}

step() {
    echo -e "  ${CYAN}▸${RESET} $1"
}

substep() {
    echo -e "    ${DIM}$1${RESET}"
}

success() {
    echo -e "  ${GREEN}✓${RESET} $1"
}

warn() {
    echo -e "  ${YELLOW}!${RESET} $1"
}

error() {
    echo -e "  ${RED}✗${RESET} $1" >&2
    exit 1
}

# Progress bar for curl
# Uses curl's built-in progress when available, otherwise shows spinner
download_with_progress() {
    local url="$1"
    local output="$2"
    local label="$3"
    
    # Check if we have a terminal
    if [ -t 1 ]; then
        # Terminal available - show progress bar
        echo -ne "    "
        curl -#fSL "$url" -o "$output" 2>&1 | while IFS= read -r -n1 char; do
            echo -n "$char"
        done
        echo -ne "\r    "
        # Clear the line and show completion
        printf "%-60s\r" " "
    else
        # No terminal - silent download
        curl -fsSL "$url" -o "$output"
    fi
}

# Detect OS
detect_os() {
    local os
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    case "$os" in
        darwin) echo "darwin" ;;
        linux) echo "linux" ;;
        mingw*|msys*|cygwin*) echo "windows" ;;
        *) error "Unsupported operating system: $os" ;;
    esac
}

# Detect architecture
detect_arch() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64|amd64) echo "x64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) error "Unsupported architecture: $arch" ;;
    esac
}

# Get latest version from GitHub
get_latest_version() {
    local version
    version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
    if [ -z "$version" ]; then
        error "Could not determine latest version"
    fi
    echo "$version"
}

# Determine install directory
get_install_dir() {
    if [ -n "$INSTALL_DIR" ]; then
        echo "$INSTALL_DIR"
    elif [ -w "/usr/local/bin" ]; then
        echo "/usr/local/bin"
    else
        mkdir -p "$HOME/.local/bin"
        echo "$HOME/.local/bin"
    fi
}

# Check if directory is in PATH
check_path() {
    local dir="$1"
    case ":$PATH:" in
        *":$dir:"*) return 0 ;;
        *) return 1 ;;
    esac
}

# Try downloading from a URL, return 0 on success
try_download() {
    local url="$1"
    local output="$2"
    
    if curl -fsSL "$url" -o "$output" 2>/dev/null; then
        return 0
    fi
    return 1
}

# Download from GitHub releases
download_binary() {
    local version="$1"
    local binary_name="$2"
    local archive_ext="$3"
    local output="$4"
    
    local github_url="${RELEASES_URL}/download/v${version}/${binary_name}.${archive_ext}"
    
    if [ -t 1 ]; then
        if curl -#fSL "$github_url" -o "$output" 2>/dev/null; then
            return 0
        fi
    else
        if curl -fsSL "$github_url" -o "$output" 2>/dev/null; then
            return 0
        fi
    fi
    
    return 1
}

# Download checksum from GitHub releases
download_checksum() {
    local version="$1"
    local binary_name="$2"
    local archive_ext="$3"
    local output="$4"

    local checksum_url="${RELEASES_URL}/download/v${version}/${binary_name}.${archive_ext}.sha256"

    if curl -fsSL "$checksum_url" -o "$output" 2>/dev/null; then
        return 0
    fi

    return 1
}

# Verify a downloaded archive against its release SHA256 sidecar.
verify_checksum() {
    local archive="$1"
    local checksum_file="$2"
    local expected actual

    expected=$(awk '{print tolower($1)}' "$checksum_file")
    if [[ ! "$expected" =~ ^[a-f0-9]{64}$ ]]; then
        error "Invalid checksum file"
    fi

    if command -v sha256sum &>/dev/null; then
        actual=$(sha256sum "$archive" | awk '{print tolower($1)}')
    elif command -v shasum &>/dev/null; then
        actual=$(shasum -a 256 "$archive" | awk '{print tolower($1)}')
    else
        error "Cannot verify checksum: sha256sum or shasum is required"
    fi

    if [ "$actual" != "$expected" ]; then
        error "Checksum verification failed for downloaded archive"
    fi
}

# Main installation
main() {
    print_header

    # Detect platform
    local os arch
    os=$(detect_os)
    arch=$(detect_arch)
    step "Platform: ${BOLD}${os}-${arch}${RESET}"

    # Get version
    local version
    if [ -n "$VERSION" ]; then
        version="$VERSION"
    else
        step "Fetching latest version..."
        version=$(get_latest_version)
    fi
    step "Version: ${BOLD}v${version}${RESET}"

    # Determine install directory
    local install_dir
    install_dir=$(get_install_dir)
    step "Target: ${BOLD}${install_dir}${RESET}"
    echo

    # Build download URL
    local binary_name="corsa-${os}-${arch}"
    local archive_ext="tar.gz"
    local exe_ext=""
    if [ "$os" = "windows" ]; then
        archive_ext="zip"
        exe_ext=".exe"
    fi

    # Create temporary directory
    local tmp_dir
    tmp_dir=$(mktemp -d)
    trap "rm -rf '$tmp_dir'" EXIT

    local archive_path="${tmp_dir}/archive.${archive_ext}"
    local checksum_path="${archive_path}.sha256"

    # Download
    step "Downloading..."
    if ! download_binary "$version" "$binary_name" "$archive_ext" "$archive_path"; then
        error "Download failed. Check that v${version} exists for ${os}-${arch}."
    fi
    if ! download_checksum "$version" "$binary_name" "$archive_ext" "$checksum_path"; then
        error "Checksum download failed. Check that v${version} includes checksum assets."
    fi

    step "Verifying checksum..."
    verify_checksum "$archive_path" "$checksum_path"

    # Extract
    step "Extracting..."
    cd "$tmp_dir"
    if [ "$archive_ext" = "tar.gz" ]; then
        tar -xzf "archive.tar.gz"
    else
        unzip -q "archive.zip"
    fi

    # Find the binary
    local binary_file
    binary_file=$(find . -name "corsa*" -type f ! -name "*.tar.gz" ! -name "*.zip" | head -1)
    if [ -z "$binary_file" ]; then
        error "Could not find binary in archive"
    fi

    # Install
    step "Installing..."
    chmod +x "$binary_file"
    
    # Use sudo if needed and available
    if [ -w "$install_dir" ]; then
        mv "$binary_file" "${install_dir}/corsa${exe_ext}"
    elif command -v sudo &>/dev/null; then
        sudo mv "$binary_file" "${install_dir}/corsa${exe_ext}"
    else
        error "Cannot write to ${install_dir}. Run with sudo or set INSTALL_DIR."
    fi

    echo
    echo -e "  ${GREEN}${BOLD}╭─────────────────────────────────╮${RESET}"
    echo -e "  ${GREEN}${BOLD}│${RESET}   ${GREEN}✓${RESET} Installed ${BOLD}corsa v${version}${RESET}      ${GREEN}${BOLD}│${RESET}"
    echo -e "  ${GREEN}${BOLD}╰─────────────────────────────────╯${RESET}"
    echo

    # Check if install directory is in PATH
    if ! check_path "$install_dir"; then
        warn "${install_dir} is not in your PATH"
        echo
        echo -e "  Add to your shell profile:"
        echo -e "  ${DIM}export PATH=\"\$PATH:${install_dir}\"${RESET}"
        echo
    fi

    # Next steps
    echo -e "  ${DIM}Get started:${RESET}"
    if command -v corsa &>/dev/null; then
        echo -e "  ${CYAN}$${RESET} corsa init"
        echo -e "  ${CYAN}$${RESET} corsa"
    else
        echo -e "  ${CYAN}$${RESET} ${install_dir}/corsa init"
        echo -e "  ${CYAN}$${RESET} ${install_dir}/corsa"
    fi
    echo
}

main "$@"
