#!/usr/bin/env bash
# Download Ledger/Admin API protos from a Canton GitHub release.
# Usage: bash scripts/fetch-canton-protobuf.sh [VERSION]
# Example VERSION: 3.5.1-rc5   (release tag is v3.5.1-rc5)
set -euo pipefail
VERSION="${1:-3.5.1-rc5}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
URL="https://github.com/digital-asset/canton/releases/download/v${VERSION}/canton-open-source-${VERSION}-protobuf.tar.gz"
echo "Fetching $URL"
curl -fsSL "$URL" | tar xz
echo "OK → ${REPO_ROOT}/canton-open-source-${VERSION}/protobuf"
