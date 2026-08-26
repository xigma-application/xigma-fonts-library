#!/usr/bin/env python3
"""
Render a short text string (typically a font's display name) as a single SVG built directly from
its glyph outlines — the same trick Figma's font picker uses to preview 1600+ fonts in a list
without loading a real webfont per row: a small, pre-rendered vector snapshot, tightly cropped to
the actual ink, instead of the full MSDF atlas this repo otherwise produces.

One SVG per family/style is enough for this — unlike the atlas (which must be per weight, since
weights are genuinely different outlines), a name preview only needs one representative weight
(Regular/400 by default) to be recognizable in a picker row.

Usage:
  python scripts/generate_preview_svg.py <static.ttf> "<text>" <output.svg>
"""

import argparse
import sys
from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

PREVIEW_PADDING = 40  # font units, small buffer around the tight ink bounds


def glyph_name_for_char(cmap: dict[int, str], char: str) -> str | None:
    return cmap.get(ord(char))


def layout_glyphs(font: TTFont, text: str) -> list[tuple[str, float]]:
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    space_advance = hmtx[cmap[ord(" ")]][0] if ord(" ") in cmap else 0

    positions: list[tuple[str, float]] = []
    x = 0.0

    for char in text:
        glyph_name = glyph_name_for_char(cmap, char)

        if glyph_name is None:
            x += space_advance
            continue

        positions.append((glyph_name, x))
        x += hmtx[glyph_name][0]

    return positions


def render_svg(font: TTFont, text: str) -> str:
    glyph_set = font.getGlyphSet()
    positions = layout_glyphs(font, text)

    if not positions:
        raise ValueError(f"no renderable glyphs found for text {text!r}")

    # y-flip (font outlines are y-up, SVG is y-down), x-advance baked in per glyph
    path_data_parts = []
    bounds = None

    for glyph_name, x_offset in positions:
        transform = Transform(1, 0, 0, -1, x_offset, 0)

        svg_pen = SVGPathPen(glyph_set)
        glyph_set[glyph_name].draw(TransformPen(svg_pen, transform))
        path_data_parts.append(svg_pen.getCommands())

        bounds_pen = BoundsPen(glyph_set)
        glyph_set[glyph_name].draw(TransformPen(bounds_pen, transform))

        if bounds_pen.bounds is not None:
            x_min, y_min, x_max, y_max = bounds_pen.bounds
            if bounds is None:
                bounds = [x_min, y_min, x_max, y_max]
            else:
                bounds[0] = min(bounds[0], x_min)
                bounds[1] = min(bounds[1], y_min)
                bounds[2] = max(bounds[2], x_max)
                bounds[3] = max(bounds[3], y_max)

    if bounds is None:
        raise ValueError(f"text {text!r} produced no visible ink (all whitespace glyphs?)")

    x_min, y_min, x_max, y_max = bounds
    x_min -= PREVIEW_PADDING
    y_min -= PREVIEW_PADDING
    x_max += PREVIEW_PADDING
    y_max += PREVIEW_PADDING
    width = x_max - x_min
    height = y_max - y_min

    path_data = " ".join(path_data_parts)

    # fill="white" + data-svg-property="fill" matches xigma-app's icon-recoloring convention
    # (see xigma-app/src/assets/svg/*.svg) — the Icon component swaps this attribute at runtime.
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{x_min:.2f} {y_min:.2f} {width:.2f} {height:.2f}">'
        f'<path data-svg-property="fill" fill="white" d="{path_data}"/>'
        "</svg>\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("font", type=Path, help="static TTF to render the preview text with")
    parser.add_argument("text", help="text to render, typically the font's display name")
    parser.add_argument("output", type=Path, help="path to write the SVG")

    args = parser.parse_args()

    try:
        font = TTFont(args.font)
        svg = render_svg(font, args.text)
    except (ValueError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(svg)
    print(f"wrote preview SVG ({args.text!r}) to {args.output}")


if __name__ == "__main__":
    main()
