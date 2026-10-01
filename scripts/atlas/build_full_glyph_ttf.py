#!/usr/bin/env python3
"""
Build a static TTF whose every glyph is reachable by a BMP codepoint, its full charset and its OpenType
feature data, for baking every glyph of a font into the MSDF atlas and shaping text with it in xigma-app.

msdf-bmfont-xml bakes characters, not glyphs, so the glyphs a font only reaches through its OpenType
features (stylistic sets, character variants, fractions, ligatures...) can't be baked as they are. This
gives every glyph an id: the lowest BMP codepoint the font maps to it, or, for a glyph no BMP codepoint
reaches, a Private Use Area codepoint from U+F000 up, added to the font's cmap. The charset written is
every one of those ids, so the atlas holds every glyph of the font.

The features file describes, in those ids, what xigma-app needs to shape text:
  - `lookups`: the GSUB lookup list (single, alternate, ligature, context and chained context
    substitutions, in any format); the others are kept as `unsupported` so indices stay aligned
  - `features`: every GSUB feature tag with the indices of its lookups
  - `sets`: the glyph sets context rules match against, as `{"in": [...]}` or `{"not": [...]}`
  - `marks`: the mark glyphs, skipped by lookups flagged to ignore marks
  - `positions`: GPOS single adjustments per feature (e.g. `cpsp`) and the `kern` pair adjustments
  - `aliases`: codepoints whose glyph has another id
  - `unitsPerEm`: the unit every position is in

Usage:
  python scripts/atlas/build_full_glyph_ttf.py <source.ttf> <output.ttf> <output-charset.txt> <output-features.json>
"""

import argparse
import json
from pathlib import Path

from fontTools.ttLib import TTFont

from font_tables import get_features, unwrap_subtable

PUA_BASE = 0xF000
PUA_LIMIT = 0xF8FF
BMP_LIMIT = 0xFFFF
IGNORE_MARKS_FLAG = 0x0008
MARK_GLYPH_CLASS = 3


def get_glyph_ids(font: TTFont) -> dict[str, int]:
    ids: dict[str, int] = {}

    for codepoint, glyph in sorted(font.getBestCmap().items()):
        if codepoint <= BMP_LIMIT:
            ids.setdefault(glyph, codepoint)

    unmapped = [glyph for glyph in font.getGlyphOrder() if glyph not in ids]

    if PUA_BASE + len(unmapped) - 1 > PUA_LIMIT:
        raise ValueError(f"{len(unmapped)} unmapped glyphs do not fit the Private Use Area")

    ids.update({glyph: PUA_BASE + index for index, glyph in enumerate(unmapped)})

    return ids


class SetPool:
    def __init__(self) -> None:
        self.sets: list[dict] = []
        self.index: dict[str, int] = {}

    def add(self, kind: str, glyph_ids: list[int]) -> int:
        entry = {kind: sorted(set(glyph_ids))}
        key = json.dumps(entry)

        if key not in self.index:
            self.index[key] = len(self.sets)
            self.sets.append(entry)

        return self.index[key]


def get_class_sets(class_def, ids: dict[str, int], pool: SetPool) -> dict[int, int]:
    classes: dict[int, list[int]] = {}

    for glyph, value in (class_def.classDefs if class_def else {}).items():
        classes.setdefault(value, []).append(ids[glyph])

    others = [glyph_id for value, members in classes.items() if value != 0 for glyph_id in members]
    sets = {value: pool.add("in", members) for value, members in classes.items() if value != 0}
    sets[0] = pool.add("not", others)

    return sets


def get_actions(records) -> list[list[int]]:
    return [[record.SequenceIndex, record.LookupListIndex] for record in records]


def get_coverage_sets(coverages, ids: dict[str, int], pool: SetPool) -> list[int]:
    return [pool.add("in", [ids[glyph] for glyph in coverage.glyphs]) for coverage in coverages or []]


def get_glyph_sets(glyphs, ids: dict[str, int], pool: SetPool) -> list[int]:
    return [pool.add("in", [ids[glyph]]) for glyph in glyphs]


def convert_context(subtable, is_chained: bool, ids: dict[str, int], pool: SetPool) -> list[dict]:
    rules: list[dict] = []

    if subtable.Format == 3:
        rules.append(
            {
                "backtrack": get_coverage_sets(subtable.BacktrackCoverage, ids, pool) if is_chained else [],
                "input": get_coverage_sets(subtable.InputCoverage if is_chained else subtable.Coverage, ids, pool),
                "lookahead": get_coverage_sets(subtable.LookAheadCoverage, ids, pool) if is_chained else [],
                "actions": get_actions(subtable.SubstLookupRecord),
            }
        )
    elif subtable.Format == 2:
        prefix = "ChainSub" if is_chained else "Sub"
        input_def = subtable.InputClassDef if is_chained else subtable.ClassDef
        input_sets = get_class_sets(input_def, ids, pool)
        backtrack_sets = get_class_sets(subtable.BacktrackClassDef, ids, pool) if is_chained else {}
        lookahead_sets = get_class_sets(subtable.LookAheadClassDef, ids, pool) if is_chained else {}
        input_classes = input_def.classDefs if input_def else {}

        for first_class, rule_set in enumerate(getattr(subtable, f"{prefix}ClassSet") or []):
            if rule_set is None:
                continue

            first_set = pool.add("in", [ids[glyph] for glyph in subtable.Coverage.glyphs if input_classes.get(glyph, 0) == first_class])

            for rule in getattr(rule_set, f"{prefix}ClassRule"):
                rules.append(
                    {
                        "backtrack": [backtrack_sets.get(value, backtrack_sets[0]) for value in rule.Backtrack] if is_chained else [],
                        "input": [first_set, *[input_sets.get(value, input_sets[0]) for value in (rule.Input if is_chained else rule.Class)]],
                        "lookahead": [lookahead_sets.get(value, lookahead_sets[0]) for value in rule.LookAhead] if is_chained else [],
                        "actions": get_actions(rule.SubstLookupRecord),
                    }
                )
    else:
        prefix = "ChainSubRule" if is_chained else "SubRule"

        for first_glyph, rule_set in zip(subtable.Coverage.glyphs, getattr(subtable, f"{prefix}Set") or []):
            if rule_set is None:
                continue

            for rule in getattr(rule_set, prefix):
                rules.append(
                    {
                        "backtrack": get_glyph_sets(rule.Backtrack, ids, pool) if is_chained else [],
                        "input": get_glyph_sets([first_glyph, *rule.Input], ids, pool),
                        "lookahead": get_glyph_sets(rule.LookAhead, ids, pool) if is_chained else [],
                        "actions": get_actions(rule.SubstLookupRecord),
                    }
                )

    return rules


def convert_gsub_lookup(lookup, ids: dict[str, int], pool: SetPool) -> dict:
    converted: dict = {"type": "unsupported", "ignoreMarks": bool(lookup.LookupFlag & IGNORE_MARKS_FLAG)}
    singles: dict[str, int] = {}
    ligatures: dict[str, list[list[int]]] = {}
    rules: list[dict] = []

    for raw_subtable in lookup.SubTable:
        subtable, lookup_type = unwrap_subtable(raw_subtable, lookup.LookupType, "GSUB")

        if lookup_type == 1:
            converted["type"] = "single"
            for source, target in subtable.mapping.items():
                singles.setdefault(str(ids[source]), ids[target])
        elif lookup_type == 3:
            converted["type"] = "single"
            for source, alternates in subtable.alternates.items():
                singles.setdefault(str(ids[source]), ids[alternates[0]])
        elif lookup_type == 4:
            converted["type"] = "ligature"
            for first, entries in subtable.ligatures.items():
                ligatures.setdefault(str(ids[first]), []).extend(
                    [*[ids[component] for component in entry.Component], ids[entry.LigGlyph]] for entry in entries
                )
        elif lookup_type in (5, 6):
            converted["type"] = "context"
            rules.extend(convert_context(subtable, lookup_type == 6, ids, pool))

    if converted["type"] == "single":
        converted["map"] = singles
    elif converted["type"] == "ligature":
        converted["map"] = ligatures
    elif converted["type"] == "context":
        converted["rules"] = rules

    return converted


def get_value(value) -> list[int]:
    return [getattr(value, "XPlacement", 0) or 0, getattr(value, "XAdvance", 0) or 0] if value else [0, 0]


def convert_single_positions(lookup, ids: dict[str, int]) -> dict[str, list[int]]:
    positions: dict[str, list[int]] = {}

    for raw_subtable in lookup.SubTable:
        subtable, lookup_type = unwrap_subtable(raw_subtable, lookup.LookupType, "GPOS")

        if lookup_type == 1:
            glyphs = subtable.Coverage.glyphs
            values = [subtable.Value] * len(glyphs) if subtable.Format == 1 else subtable.Value

            for glyph, value in zip(glyphs, values):
                positions.setdefault(str(ids[glyph]), get_value(value))

    return positions


def convert_pair_positions(lookup, ids: dict[str, int]) -> list[dict]:
    kerning: list[dict] = []

    for raw_subtable in lookup.SubTable:
        subtable, lookup_type = unwrap_subtable(raw_subtable, lookup.LookupType, "GPOS")

        if lookup_type != 2:
            continue

        if subtable.Format == 1:
            pairs: dict[str, dict[str, int]] = {}

            for first, pair_set in zip(subtable.Coverage.glyphs, subtable.PairSet):
                for record in pair_set.PairValueRecord:
                    amount = get_value(record.Value1)[1]

                    if amount:
                        pairs.setdefault(str(ids[first]), {})[str(ids[record.SecondGlyph])] = amount

            kerning.append({"type": "pairs", "pairs": pairs})
        else:
            first_classes = {str(ids[glyph]): subtable.ClassDef1.classDefs.get(glyph, 0) for glyph in subtable.Coverage.glyphs}
            second_classes = {str(ids[glyph]): value for glyph, value in subtable.ClassDef2.classDefs.items()}
            values: dict[str, dict[str, int]] = {}

            for first_class, record in enumerate(subtable.Class1Record):
                for second_class, class2 in enumerate(record.Class2Record):
                    amount = get_value(class2.Value1)[1]

                    if amount:
                        values.setdefault(str(first_class), {})[str(second_class)] = amount

            kerning.append({"type": "classes", "first": first_classes, "second": second_classes, "values": values})

    return kerning


def get_positions(font: TTFont, ids: dict[str, int]) -> dict:
    if "GPOS" not in font:
        return {"kern": [], "single": {}}

    lookups = font["GPOS"].table.LookupList.Lookup
    features = get_features(font, "GPOS")
    single = {
        tag: {key: value for index in indices for key, value in convert_single_positions(lookups[index], ids).items()}
        for tag, indices in features.items()
        if tag != "kern"
    }

    return {
        "kern": [pair for index in features.get("kern", []) for pair in convert_pair_positions(lookups[index], ids)],
        "single": {tag: positions for tag, positions in single.items() if positions},
    }


def get_marks(font: TTFont, ids: dict[str, int]) -> list[int]:
    if "GDEF" not in font or not font["GDEF"].table.GlyphClassDef:
        return []

    return sorted(ids[glyph] for glyph, value in font["GDEF"].table.GlyphClassDef.classDefs.items() if value == MARK_GLYPH_CLASS)


def build_full_glyph_ttf(source: Path, output: Path, output_charset: Path, output_features: Path) -> int:
    font = TTFont(source)
    ids = get_glyph_ids(font)
    best_cmap = font.getBestCmap()
    pool = SetPool()
    lookups = (
        [convert_gsub_lookup(lookup, ids, pool) for lookup in font["GSUB"].table.LookupList.Lookup]
        if "GSUB" in font and font["GSUB"].table.LookupList
        else []
    )
    aliases = {
        str(codepoint): ids[glyph] for codepoint, glyph in best_cmap.items() if codepoint <= BMP_LIMIT and ids[glyph] != codepoint
    }
    features = {
        "aliases": aliases,
        "features": get_features(font, "GSUB"),
        "lookups": lookups,
        "marks": get_marks(font, ids),
        "positions": get_positions(font, ids),
        "sets": pool.sets,
        "unitsPerEm": font["head"].unitsPerEm,
    }
    unmapped = {glyph_id: glyph for glyph, glyph_id in ids.items() if glyph_id >= PUA_BASE and glyph_id not in best_cmap}

    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap.update(unmapped)

    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output)
    output_charset.parent.mkdir(parents=True, exist_ok=True)
    output_charset.write_text("".join(chr(glyph_id) for glyph_id in sorted(set(ids.values()))), encoding="utf8")
    output_features.parent.mkdir(parents=True, exist_ok=True)
    output_features.write_text(json.dumps(features, separators=(",", ":")), encoding="utf8")

    return len(set(ids.values()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="static TTF with its OpenType features")
    parser.add_argument("output", type=Path, help="path to write the static TTF with every glyph mapped")
    parser.add_argument("output_charset", type=Path, help="path to write the charset of every glyph")
    parser.add_argument("output_features", type=Path, help="path to write the OpenType feature data")

    args = parser.parse_args()
    count = build_full_glyph_ttf(args.source, args.output, args.output_charset, args.output_features)

    print(f"mapped {count} glyphs into {args.output}")


if __name__ == "__main__":
    main()
