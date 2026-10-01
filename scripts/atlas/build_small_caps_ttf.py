#!/usr/bin/env python3
"""
Build a static TTF whose small caps are reachable by codepoint, for baking them into the MSDF atlas.

msdf-bmfont-xml bakes characters, not glyphs, so a font's small caps (the glyphs its OpenType `smcp`
feature substitutes for lower case letters) can't be baked as they are. This freezes the source
variable font to one weight like scripts/atlas/freeze_variable_font.py, then maps every small cap of a
charset character to a Private Use Area codepoint, U+E000 + the character's own codepoint (so the
small cap of "a", U+0061, is U+E061). A consumer drawing small caps swaps each lower case character
for that codepoint. The PUA characters are appended to the written charset so the atlas bakes them.

Exits with code 3, writing nothing, when the source font has no `smcp` feature.

Usage:
  python scripts/atlas/build_small_caps_ttf.py <source.ttf> <output.ttf> <charset.txt> <output-charset.txt> wght=700
"""

import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

from font_tables import get_features, parse_axis_args, pin_axes, unwrap_subtable

SMALL_CAPS_PUA_BASE = 0xE000
SMALL_CAPS_PUA_LIMIT = 0xF8FF
SINGLE_SUBSTITUTION = 1
# bake_small_caps.mjs tells "no small caps" apart from a failure by this exit code.
NO_SMALL_CAPS_EXIT_CODE = 3


def get_small_caps_mapping(font: TTFont, lookup_indices: list[int]) -> dict[str, str]:
    """Each glyph's small cap, from the single substitutions of the `smcp` lookups."""
    mapping: dict[str, str] = {}

    for index in lookup_indices:
        lookup = font["GSUB"].table.LookupList.Lookup[index]

        for raw_subtable in lookup.SubTable:
            subtable, lookup_type = unwrap_subtable(raw_subtable, lookup.LookupType, "GSUB")

            if lookup_type == SINGLE_SUBSTITUTION:
                for source, target in subtable.mapping.items():
                    mapping.setdefault(source, target)

    return mapping


def build_small_caps_ttf(source: Path, output: Path, charset_path: Path, output_charset: Path, axes: dict[str, float]) -> int:
    font = TTFont(source)
    smcp_lookups = get_features(font, "GSUB").get("smcp")

    if smcp_lookups is None:
        return 0

    if "fvar" in font:
        pin_axes(font, axes)

    mapping = get_small_caps_mapping(font, smcp_lookups)
    best_cmap = font.getBestCmap()
    charset = charset_path.read_text(encoding="utf8")
    small_caps: dict[int, str] = {}

    for char in dict.fromkeys(charset):
        codepoint = ord(char)
        glyph = best_cmap.get(codepoint)
        pua = SMALL_CAPS_PUA_BASE + codepoint

        if glyph in mapping and pua <= SMALL_CAPS_PUA_LIMIT:
            small_caps[pua] = mapping[glyph]

    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap.update(small_caps)

    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output)
    output_charset.parent.mkdir(parents=True, exist_ok=True)
    output_charset.write_text(charset.rstrip("\n") + "".join(chr(pua) for pua in sorted(small_caps)), encoding="utf8")

    return len(small_caps)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="source (variable or static) TTF with its OpenType features")
    parser.add_argument("output", type=Path, help="path to write the static TTF with the small caps mapped")
    parser.add_argument("charset", type=Path, help="the variant's charset.txt")
    parser.add_argument("output_charset", type=Path, help="path to write the charset plus the small caps codepoints")
    parser.add_argument("axes", nargs="*", help="axis pins as TAG=VALUE, e.g. wght=700")

    args = parser.parse_args()
    count = build_small_caps_ttf(args.source, args.output, args.charset, args.output_charset, parse_axis_args(args.axes))

    if count == 0:
        print(f"{args.source.name} has no small caps", file=sys.stderr)
        sys.exit(NO_SMALL_CAPS_EXIT_CODE)

    print(f"mapped {count} small caps into {args.output}")


if __name__ == "__main__":
    main()
