#!/usr/bin/env python3
"""
Freeze a variable font to a static weight/style instance via fontTools' varLib.instancer.

MSDF baking (msdf-bmfont-xml, the Node side of this pipeline) needs a static TTF — it can't
consume a variable font's multiple axes directly. This is the same freezing step xigma-app used
to produce its committed Inter-Regular.ttf (wght=400 opsz=14) before running its own
`generate:font-atlas` script; here it's generalized to any axis pins so it can produce one static
instance per (font, weight, style) baking unit, e.g. inter-400, inter-700, inter-400-italic.

Usage:
  python scripts/freeze_variable_font.py <input.ttf> <output.ttf> wght=700
  python scripts/freeze_variable_font.py <input.ttf> <output.ttf> wght=400 opsz=14 ital=1
"""

import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer


def parse_axis_args(axis_args: list[str]) -> dict[str, float]:
    axes: dict[str, float] = {}

    for arg in axis_args:
        if "=" not in arg:
            raise ValueError(f"invalid axis pin (expected TAG=VALUE): {arg!r}")

        tag, _, raw_value = arg.partition("=")

        try:
            axes[tag] = float(raw_value)
        except ValueError as error:
            raise ValueError(f"invalid axis value for {tag!r}: {raw_value!r}") from error

    return axes


def freeze_variable_font(input_path: Path, output_path: Path, axes: dict[str, float]) -> None:
    font = TTFont(input_path)

    if "fvar" not in font:
        raise ValueError(f"{input_path} has no 'fvar' table — it isn't a variable font")

    instancer.instantiateVariableFont(font, axes, inplace=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    font.save(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="source variable-font TTF")
    parser.add_argument("output", type=Path, help="path to write the static instance TTF")
    parser.add_argument("axes", nargs="+", help="axis pins as TAG=VALUE, e.g. wght=700 opsz=14 ital=1")

    args = parser.parse_args()

    try:
        axes = parse_axis_args(args.axes)
        freeze_variable_font(args.input, args.output, axes)
    except (ValueError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)

    pins = ", ".join(f"{tag}={value}" for tag, value in axes.items())
    print(f"wrote static instance ({pins}) to {args.output}")


if __name__ == "__main__":
    main()
