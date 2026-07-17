#!/usr/bin/env sh
set -eu
PAPER_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TECTONIC_BIN=${TECTONIC_BIN:-tectonic}
TECTONIC_CACHE_DIR=${TECTONIC_CACHE_DIR:-"$PAPER_ROOT/.tectonic-cache-0.16.9"}
export TECTONIC_CACHE_DIR
VERSION=$($TECTONIC_BIN --version)
[ "$VERSION" = "Tectonic 0.16.9" ] || { echo "Expected Tectonic 0.16.9, received $VERSION" >&2; exit 1; }
mkdir -p "$PAPER_ROOT/build" "$TECTONIC_CACHE_DIR"
cd "$PAPER_ROOT/manuscript"
"$TECTONIC_BIN" -X compile main.tex --outdir "$PAPER_ROOT/build" --keep-logs --keep-intermediates --reruns 2
node "$PAPER_ROOT/check-latex-log.mjs"
