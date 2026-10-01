#!/usr/bin/env node
/**
 * Bake one Unicode glyph block of a variant (see scripts/lib/glyphBlocks.cjs): every character of
 * U+<block>…U+<block+255> the static TTF maps, with the exact parameters of the variant's main atlas
 * (scripts/lib/bakeMsdfAtlas.cjs), so its glyphs sit on the same baseline and scale. Kerning is left
 * out, like the full-glyph bake: a pair across a block and the main atlas could not be looked up anyway.
 * A block without any character of the font is written as `{"chars":[]}` with no texture.
 *
 * Usage:
 *   node scripts/atlas/bake_glyph_block.cjs --font <static.ttf> --block AC00 --out-dir <variant>/glyphs --name <variant>
 */

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

const { bakeMsdfAtlas, writeMsdfAtlas } = require('../lib/bakeMsdfAtlas.cjs');
const { GLYPH_BLOCK_SIZE, getGlyphBlockName } = require('../lib/glyphBlocks.cjs');
const { parseArgs, requireArg } = require('../lib/parseArgs.cjs');

function getBlockCharset(font, blockStart) {
  const glyphIndexMap = font.tables.cmap.glyphIndexMap;

  return Array.from({ length: GLYPH_BLOCK_SIZE }, (_, offset) => blockStart + offset)
    .filter((code) => glyphIndexMap[code] > 0)
    .map((code) => String.fromCodePoint(code))
    .join('');
}

// msdf-bmfont-xml writes each glyph's `id` as `char.charCodeAt(0)`, which is only the high surrogate
// of a character past U+FFFF — rewrite it from the glyph's own `char`.
function fixAstralIds(atlasPath) {
  const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));

  atlas.chars.forEach((glyph) => {
    glyph.id = glyph.char.codePointAt(0);
  });
  fs.writeFileSync(atlasPath, JSON.stringify(atlas));
}

async function bakeGlyphBlock(fontPath, blockStart, outDir, variant) {
  const name = getGlyphBlockName(variant, blockStart);
  const charset = getBlockCharset(opentype.loadSync(fontPath), blockStart);

  if (!charset) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.json`), '{"chars":[]}\n');
    return 0;
  }

  opentype.Font.prototype.getKerningValue = () => 0;

  const { textures, font } = await bakeMsdfAtlas(fontPath, charset, name);

  if (textures.length > 1) {
    throw new Error(`${name}: ${textures.length} texture pages, a glyph block must fit one`);
  }

  writeMsdfAtlas(outDir, name, textures, font);
  fixAstralIds(path.join(outDir, `${name}.json`));

  return Array.from(charset).length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const blockStart = parseInt(requireArg(args, 'block'), 16);
  const name = requireArg(args, 'name');
  const count = await bakeGlyphBlock(requireArg(args, 'font'), blockStart, requireArg(args, 'out-dir'), name);

  console.log(`${getGlyphBlockName(name, blockStart)}: ${count} glyph(s)`);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
