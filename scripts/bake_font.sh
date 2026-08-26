#!/usr/bin/env bash
# Full pipeline for one (font, weight, style) baking unit: freeze the variable-font axes to a
# static TTF (scripts/freeze_variable_font.py), then bake the MSDF atlas from it
# (scripts/bake_atlas.cjs). See README.md for why this is the baking unit (not font size,
# line-height, letter-spacing, or paragraph-spacing — those never need a re-bake).
#
# Usage:
#   scripts/bake_font.sh <variant-dir> <variable-font.ttf> <axis=value>...
#
# <variant-dir> must already contain a charset.txt (the character-set decision for this variant).
# Variants are grouped by font family: fonts/<FontName>/<FontName>-<variant>/.
# Example:
#   scripts/bake_font.sh fonts/Inter/Inter-400 /path/to/Inter[opsz,wght].ttf wght=400 opsz=14

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <variant-dir> <variable-font.ttf> <axis=value>..." >&2
  exit 1
fi

VARIANT_DIR="$1"
SOURCE_TTF="$2"
shift 2
AXES=("$@")

if [ ! -f "$VARIANT_DIR/charset.txt" ]; then
  echo "error: $VARIANT_DIR/charset.txt not found — create it first (the charset is a per-variant decision, not auto-generated)" >&2
  exit 1
fi

NAME="$(basename "$VARIANT_DIR")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATIC_TTF="$VARIANT_DIR/source/$NAME.ttf"

python3 "$SCRIPT_DIR/freeze_variable_font.py" "$SOURCE_TTF" "$STATIC_TTF" "${AXES[@]}"

node "$SCRIPT_DIR/bake_atlas.cjs" \
  --font "$STATIC_TTF" \
  --charset "$VARIANT_DIR/charset.txt" \
  --out-dir "$VARIANT_DIR" \
  --name "${NAME}-msdf"

node "$SCRIPT_DIR/generate_manifest.mjs"
