"""
fontTools helpers the TTF-building scripts next to this file share (freeze_variable_font.py,
build_small_caps_ttf.py, build_full_glyph_ttf.py). Python puts a script's own directory on sys.path, so
they import it as `font_tables` without any packaging.
"""

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

EXTENSION_LOOKUP_TYPE = {"GSUB": 7, "GPOS": 9}


def parse_axis_args(axis_args: list[str]) -> dict[str, float]:
    """Axis pins given as TAG=VALUE (wght=700 opsz=14) as {tag: value}."""
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


def pin_axes(font: TTFont, axes: dict[str, float]) -> tuple[set[str], set[str]]:
    """
    Instances a variable font in place at the pins of the axes it has, and returns the axis tags it had
    and the pinned tags it has no axis for. Not every variable font has every axis (Roboto has wdth/wght but no
    opsz), and callers pass house-style defaults (opsz=14) blanket across arbitrary fonts, so a pin the
    font has no axis for is dropped rather than failing — it just means "this font's own default".
    """
    available_tags = {axis.axisTag for axis in font["fvar"].axes}
    applied = {tag: value for tag, value in axes.items() if tag in available_tags}

    instancer.instantiateVariableFont(font, applied, inplace=True)

    return available_tags, set(axes) - available_tags


def unwrap_subtable(subtable, lookup_type: int, table_tag: str):
    """An extension subtable's wrapped subtable and its real lookup type; any other subtable as it is."""
    if lookup_type == EXTENSION_LOOKUP_TYPE[table_tag]:
        return subtable.ExtSubTable, subtable.ExtSubTable.LookupType

    return subtable, lookup_type


def get_features(font: TTFont, table_tag: str) -> dict[str, list[int]]:
    """Every feature tag of the GSUB or GPOS table with the sorted indices of its lookups."""
    features: dict[str, set[int]] = {}

    if table_tag in font and font[table_tag].table.FeatureList:
        for record in font[table_tag].table.FeatureList.FeatureRecord:
            features.setdefault(record.FeatureTag, set()).update(record.Feature.LookupListIndex)

    return {tag: sorted(indices) for tag, indices in sorted(features.items())}
