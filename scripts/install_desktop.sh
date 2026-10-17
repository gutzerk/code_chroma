#!/bin/sh
# Deprecated forwarder: the macOS installer now lives in distribution/install.sh (manifest-based,
# verified, user-scoped by default). Arguments such as --system are passed through.
set -eu
echo "install_desktop.sh is deprecated; forwarding to distribution/install.sh" >&2
exec sh -c 'curl -fsSL https://raw.githubusercontent.com/gutzerk/code_chroma/main/distribution/install.sh | sh -s -- "$@"' sh "$@"
