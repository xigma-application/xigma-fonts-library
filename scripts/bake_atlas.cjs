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
const generateBMFont = require('msdf-bmfont-xml');
const opentype = require('opentype.js');

const DEFAULT_FONT_SIZE = 64;
const DEFAULT_DISTANCE_RANGE = 6;
const DEFAULT_TEXTURE_PADDING = 2;
const DEFAULT_TEXTURE_SIZE = [2048, 2048];

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }

  return args;
}

function requireArg(args, key) {
  const value = args[key];

  if (!value) {
    throw new Error(`missing required --${key}`);
  }

  return value;
}

function loadCharset(charsetPath) {
  return fs.readFileSync(charsetPath, 'utf8');
}

function bakeAtlas(fontPath, charset, name, textureSize) {
  const opt = {
    filename: name,
    outputType: 'json',
    fieldType: 'msdf',
    charset,
    fontSize: DEFAULT_FONT_SIZE,
    distanceRange: DEFAULT_DISTANCE_RANGE,
    texturePadding: DEFAULT_TEXTURE_PADDING,
    textureSize,
    smartSize: true,
  };

  return new Promise((resolve, reject) => {
    generateBMFont(fontPath, opt, (error, textures, font) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ textures, font });
    });
  });
}

// msdf-bmfont-xml quirk (confirmed against its source, index.js): the `filename` option only
// renames the texture page(s) — the BMFont data file is always named after the *input TTF's own
// filename* (fontPath's basename), never `opt.filename`. xigma-app's own generate:font-atlas
// script works around this with a shell `mv`; here we just dictate every output filename
// ourselves from `name`, ignoring what the library returned.
function writeOutputs(outDir, name, textures, font) {
  fs.mkdirSync(outDir, { recursive: true });

  textures.forEach((texture, index) => {
    const suffix = textures.length > 1 ? `.${index}` : '';
    fs.writeFileSync(path.join(outDir, `${name}${suffix}.png`), texture.texture);
  });

  const fontExtension = path.extname(font.filename);
  fs.writeFileSync(path.join(outDir, `${name}${fontExtension}`), font.data);
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

  const { textures, font } = await bakeAtlas(fontPath, charset, name, textureSize);

  writeOutputs(outDir, name, textures, font);

  console.log(`wrote ${textures.length} texture page(s) + ${name}${path.extname(font.filename)} to ${outDir}`);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
