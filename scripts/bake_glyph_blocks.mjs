#!/usr/bin/env node
/**
 * Bake every Unicode glyph block (scripts/lib/glyphBlocks.cjs) of every baked variant, so the deploy
 * build (scripts/build_deploy.mjs) can publish them — the static host cannot bake a block on demand the
 * way scripts/serve.mjs does in development. Only blocks the font has at least one character in are
 * baked; blocks already on disk are skipped, so it is safe to stop and re-run.
 *
 * Usage:
 *   node scripts/bake_glyph_blocks.mjs [--family Inter]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import glyphBlocks from './lib/glyphBlocks.cjs';
import { resolveVariantTtf } from './lib/fontSourcePaths.mjs';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONTS_DIR = path.join(REPO_ROOT, 'fonts');
const CACHE_DIR = path.join(REPO_ROOT, '.cache');

function listVariants(family) {
  const families = family ? [family] : fs.readdirSync(FONTS_DIR).filter((name) => fs.statSync(path.join(FONTS_DIR, name)).isDirectory());

  return families.flatMap((name) =>
    fs
      .readdirSync(path.join(FONTS_DIR, name), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(FONTS_DIR, name, entry.name, `${entry.name}-msdf.json`)))
      .map((entry) => ({ family: name, variant: entry.name })),
  );
}

function bakeVariantBlocks({ family, variant }) {
  const ttf = resolveVariantTtf(FONTS_DIR, CACHE_DIR, family, variant);
  const outDir = glyphBlocks.getGlyphBlockDir(FONTS_DIR, family, variant);

  if (!ttf) {
    console.warn(`skip ${variant}: no source TTF`);
    return;
  }

  glyphBlocks
    .getFontBlockStarts(opentype.loadSync(ttf))
    .filter((blockStart) => !fs.existsSync(path.join(outDir, `${glyphBlocks.getGlyphBlockName(variant, blockStart)}.json`)))
    .forEach((blockStart) => {
      execFileSync(
        'node',
        [
          path.join(REPO_ROOT, 'scripts', 'bake_glyph_block.cjs'),
          '--font',
          ttf,
          '--block',
          blockStart.toString(16),
          '--out-dir',
          outDir,
          '--name',
          variant,
        ],
        { stdio: ['ignore', 'inherit', 'ignore'] },
      );
    });
}

function main() {
  const familyIndex = process.argv.indexOf('--family');
  const family = familyIndex > -1 ? process.argv[familyIndex + 1] : undefined;

  listVariants(family).forEach(bakeVariantBlocks);
}

main();
