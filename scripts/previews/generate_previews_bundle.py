#!/usr/bin/env python3
"""
Bundles every committed name-preview SVG (fonts/<Family>/<name>.svg) into one fonts/previews.json,
so a font picker fetches a single file once at start and draws every row straight away instead of
loading ~2300 SVGs while the list scrolls.

Each entry is keyed by the manifest name and holds the preview's outline rescaled to a fixed height
of PREVIEW_HEIGHT units (the picker draws it at ~16 CSS px, so one decimal is plenty) plus its width
in the same units: {"Abel": {"d": "M15.1 23.8H5.6...", "w": 65.9}}. Fonts without a preview file
(no glyphs to write their own name with) are left out, matching their null preview in the manifest.

Usage:
  python scripts/previews/generate_previews_bundle.py
"""

import json
import re
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "fonts" / "manifest.json"
BUNDLE_PATH = REPO_ROOT / "fonts" / "previews.json"
PREVIEW_HEIGHT = 32


def format_number(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def bundle_preview(svg: str) -> dict:
    x, y, width, height = map(float, re.search(r'viewBox="([^"]+)"', svg).group(1).split())
    scale = PREVIEW_HEIGHT / height
    pen = SVGPathPen(None, ntos=format_number)
    transform_pen = TransformPen(pen, (scale, 0, 0, scale, -x * scale, -y * scale))

    for path_data in re.findall(r' d="([^"]+)"', svg):
        parse_path(path_data, transform_pen)

    return {"d": pen.getCommands(), "w": round(width * scale, 1)}


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())
    bundle = {
        entry["name"]: bundle_preview((REPO_ROOT / entry["preview"]).read_text())
        for entry in manifest
        if entry["preview"] and (REPO_ROOT / entry["preview"]).exists()
    }

    BUNDLE_PATH.write_text(json.dumps(bundle, separators=(",", ":")))
    print(f"wrote {len(bundle)} preview(s) to {BUNDLE_PATH} ({BUNDLE_PATH.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
