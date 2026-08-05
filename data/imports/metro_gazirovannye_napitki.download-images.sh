#!/usr/bin/env bash
# Later image download for METRO draft rows. Does NOT upload to TINDA.
# Usage: bash data/imports/metro_gazirovannye_napitki.download-images.sh [out-dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
JSON="$ROOT/data/imports/metro_gazirovannye_napitki.json"
OUT_DIR="${1:-$ROOT/data/imports/metro-images}"
mkdir -p "$OUT_DIR"
node "$ROOT/scripts/metro-download-images-later.mjs" "$JSON" "$OUT_DIR"
