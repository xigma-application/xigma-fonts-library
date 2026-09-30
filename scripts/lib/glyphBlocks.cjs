/**
 * Unicode glyph blocks — the characters a variant's main atlas does not carry, baked in blocks of 256
 * code points so xigma-app can fetch just the block of a character a text actually uses (é, ©, €, •,
 * Korean, Chinese...). A block lives next to its variant's atlas:
 *
 *   fonts/<Family>/<variant>/glyphs/<variant>-glyphs-u<XXXX>-msdf.json|png
 *
 * where XXXX is the block's first code point in upper-case hex, at least four digits (U+AC00 → uAC00,
 * U+1D400 → u1D400). A block the font has no character in is baked as a JSON with `"chars": []` and no
 * texture, so it is not baked again. Every plane is covered (blocks u0000…u10FF00).
 */

const path = require('path');

const GLYPH_BLOCK_SIZE = 256;
const GLYPH_BLOCK_COUNT = 0x1100;
const GLYPH_BLOCK_DIR = 'glyphs';
const GLYPH_BLOCK_PATH_PATTERN = /^([^/]+)\/([^/]+)\/glyphs\/\2-glyphs-u([0-9A-F]{2,4}00)-msdf\.(json|png)$/;

function getGlyphBlockName(variant, blockStart) {
  return `${variant}-glyphs-u${blockStart.toString(16).toUpperCase().padStart(4, '0')}-msdf`;
}

function getGlyphBlockDir(fontsDir, family, variant) {
  return path.join(fontsDir, family, variant, GLYPH_BLOCK_DIR);
}

function getFontBlockStarts(font) {
  const codes = Object.keys(font.tables.cmap.glyphIndexMap).map(Number);

  return [
    ...new Set(codes.filter((code) => code < GLYPH_BLOCK_SIZE * GLYPH_BLOCK_COUNT).map((code) => code - (code % GLYPH_BLOCK_SIZE))),
  ].sort((a, b) => a - b);
}

module.exports = {
  GLYPH_BLOCK_COUNT,
  GLYPH_BLOCK_DIR,
  GLYPH_BLOCK_PATH_PATTERN,
  GLYPH_BLOCK_SIZE,
  getFontBlockStarts,
  getGlyphBlockDir,
  getGlyphBlockName,
};
