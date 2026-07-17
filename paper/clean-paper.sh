#!/usr/bin/env sh
set -eu
PAPER_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
find "$PAPER_ROOT/build" -maxdepth 1 -type f \( -name '*.aux' -o -name '*.bbl' -o -name '*.blg' -o -name '*.log' -o -name '*.out' -o -name '*.pdf' \) -delete
