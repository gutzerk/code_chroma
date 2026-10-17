#!/bin/sh
# Deprecated forwarder: the Linux installer now lives in distribution/install.sh (manifest-based,
# verified, AppImage in ~/Applications by default; --system installs the .deb through apt).
set -eu
echo "install_linux.sh is deprecated; forwarding to distribution/install.sh" >&2
exec sh -c 'curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh -s -- "$@"' sh "$@"
