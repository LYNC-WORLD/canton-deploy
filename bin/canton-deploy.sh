#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT/dist/index.cjs" ]]; then
  echo "canton-deploy: missing bundle at $ROOT/dist/index.cjs" >&2
  echo "  Build before publish: npm install && npm run build" >&2
  exit 1
fi

export CANTON_PROTO_PATH="${CANTON_PROTO_PATH:-$ROOT/share/protobuf}"

if [[ ! -d "$CANTON_PROTO_PATH" ]]; then
  echo "canton-deploy: protobuf tree not found at $CANTON_PROTO_PATH" >&2
  echo "  Re-run: npm run build (after fetch-canton-protobuf.sh)." >&2
  exit 1
fi

exec node "$ROOT/dist/index.cjs" "$@"
