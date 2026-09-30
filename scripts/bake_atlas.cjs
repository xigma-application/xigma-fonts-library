#!/usr/bin/env node
/**
 * Bake an MSDF glyph atlas from a static TTF, via msdf-bmfont-xml's programmatic API.
 *
 * Second half of the pipeline: scripts/freeze_variable_font.py produces the static TTF this
 * script consumes. Parameters (fontSize=64, distanceRange=6, texturePadding=2, msdf/json) match
 * xigma-app's `generate:font-atlas` script (`msdf-bmfont-xml -f json -t msdf -s 64 -r 6 -p 2`) —
 * see xigma-app/docs/ROADMAP.md, Etap 7, for why those specific values were tuned.
 *
 * `--texture-size <n>` bakes onto an n×n texture instead of 2048×2048, for a charset of every glyph of a
 * font. `--no-kerning` leaves the kernings out: msdf-bmfont-xml measures every pair of the charset, which
 * for thousands of characters takes long and writes a huge file, and a font baked with its features file
 * (scripts/build_full_glyph_ttf.py) carries its kerning there instead.
 *
 * Usage:
 *   node scripts/bake_atlas.cjs --font <static.ttf> --charset <charset.txt> --out-dir <dir> --name <inter-400>
 *     [--texture-size 4096] [--no-kerning true]
 */

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

const { DEFAULT_TEXTURE_SIZE, bakeMsdfAtlas, writeMsdfAtlas } = require('./lib/bakeMsdfAtlas.cjs');
const { parseArgs, requireArg } = require('./lib/parseArgs.cjs');

function loadCharset(charsetPath) {
  return fs.readFileSync(charsetPath, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const fontPath = requireArg(args, 'font');
  const charsetPath = requireArg(args, 'charset');
  const outDir = requireArg(args, 'out-dir');
  const name = requireArg(args, 'name');

  const charset = loadCharset(charsetPath);
  const textureSize = args['texture-size'] ? [Number(args['texture-size']), Number(args['texture-size'])] : DEFAULT_TEXTURE_SIZE;

  if (args['no-kerning']) {
    opentype.Font.prototype.getKerningValue = () => 0;
  }

  const { textures, font } = await bakeMsdfAtlas(fontPath, charset, name, textureSize);

  writeMsdfAtlas(outDir, name, textures, font);

  console.log(`wrote ${textures.length} texture page(s) + ${name}${path.extname(font.filename)} to ${outDir}`);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
