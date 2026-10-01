#!/usr/bin/env node
/**
 * Bake every Unicode glyph block (scripts/lib/glyphBlocks.cjs) of every baked variant, so the deploy
 * build (scripts/build_deploy.mjs) can publish them — the static host cannot bake a block on demand the
 * way scripts/serve.mjs does in development. Only blocks the font has at least one character in are
 * baked; blocks already on disk are skipped, so it is safe to stop and re-run.
 *
 * Usage:
 *   node scripts/atlas/bake_glyph_blocks.mjs [--family Inter]
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { resolveVariantTtf } from '../lib/fontSourcePaths.mjs';
import glyphBlocks from '../lib/glyphBlocks.cjs';
import { FONTS_DIR } from '../lib/repoPaths.mjs';
import { runBakeGlyphBlock } from '../lib/runScripts.mjs';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

/** Every variant of the family (all of fonts/ without one) that has an atlas baked. */
function listBakedVariants(family) {
  const familyNames = family ? [family] : fs.readdirSync(FONTS_DIR).filter((name) => fs.statSync(path.join(FONTS_DIR, name)).isDirectory());

  return familyNames.flatMap((family) =>
    fs
      .readdirSync(path.join(FONTS_DIR, family), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(FONTS_DIR, family, entry.name, `${entry.name}-msdf.json`)))
      .map((entry) => ({ family, variant: entry.name })),
  );
}

function bakeVariantBlocks({ family, variant }) {
  const font = resolveVariantTtf(family, variant);
  const outDir = glyphBlocks.getGlyphBlockDir(FONTS_DIR, family, variant);

  if (!font) {
    console.warn(`skip ${variant}: no source TTF`);
    return;
  }

  glyphBlocks
    .getFontBlockStarts(opentype.loadSync(font))
    .filter((blockStart) => !fs.existsSync(path.join(outDir, `${glyphBlocks.getGlyphBlockName(variant, blockStart)}.json`)))
    .forEach((blockStart) => {
      runBakeGlyphBlock({ blockHex: blockStart.toString(16), font, outDir, stdio: ['ignore', 'inherit', 'ignore'], variant });
    });
}

function main() {
  const familyIndex = process.argv.indexOf('--family');
  const family = familyIndex > -1 ? process.argv[familyIndex + 1] : undefined;

  listBakedVariants(family).forEach(bakeVariantBlocks);
}

main();
