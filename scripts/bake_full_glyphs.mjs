#!/usr/bin/env node
/**
 * Re-bakes the MSDF atlas of every weight of the given families (Inter by default) with every glyph of
 * the font, and writes its OpenType feature data next to it, so xigma-app can draw what the Type
 * settings Details tab turns on (stylistic sets, character variants, fractions, ligatures, kerning...).
 *
 * scripts/build_full_glyph_ttf.py maps every glyph of the variant's static TTF to a codepoint, writes
 * the charset of all of them and `<variant>-features.json`; the atlas is then baked from that TTF on a
 * 4096 texture without kernings (the features file carries them), replacing the plain atlas, and the
 * TTF replaces the variant's source/ one, so flattening and export outline the same glyphs. The first
 * run keeps the original TTF in .cache/full-glyphs/originals/, which later runs start from.
 *
 * Every variant baked this way is listed in data/full-glyphs.json, which scripts/generate_manifest.mjs
 * turns into a `features` path on that weight.
 *
 * Usage:
 *   node scripts/bake_full_glyphs.mjs                         — every weight of Inter
 *   node scripts/bake_full_glyphs.mjs --family Roboto --family Inter
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, FONTS_DIR, FULL_GLYPHS_PATH, getScriptPath } from './lib/repoPaths.mjs';
import { loadCatalog, loadFamilySet } from './lib/catalog.mjs';
import { getVariantName } from './lib/variants.mjs';

const FULL_GLYPHS_CACHE_DIR = path.join(CACHE_DIR, 'full-glyphs');
const DEFAULT_FAMILIES = ['Inter'];
const TEXTURE_SIZE = '4096';

function parseFamilies(argv) {
  const families = argv.flatMap((arg, index) => (arg === '--family' && argv[index + 1] ? [argv[index + 1]] : []));

  return families.length > 0 ? families : DEFAULT_FAMILIES;
}

function saveFullGlyphs(fullGlyphs) {
  fs.writeFileSync(FULL_GLYPHS_PATH, `${JSON.stringify([...fullGlyphs].sort(), null, 2)}\n`);
}

function ensureOriginalTtf(variant, staticTtf) {
  const original = path.join(FULL_GLYPHS_CACHE_DIR, 'originals', `${variant}.ttf`);

  if (!fs.existsSync(original)) {
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.copyFileSync(staticTtf, original);
  }

  return original;
}

function bakeVariant(family, weight, italic) {
  const variant = getVariantName(family, weight, italic);
  const variantDir = path.join(FONTS_DIR, family, variant);
  const staticTtf = path.join(variantDir, 'source', `${variant}.ttf`);
  const charset = path.join(FULL_GLYPHS_CACHE_DIR, 'charsets', `${variant}.txt`);

  if (!fs.existsSync(staticTtf) && !fs.existsSync(path.join(FULL_GLYPHS_CACHE_DIR, 'originals', `${variant}.ttf`))) {
    throw new Error(`${staticTtf} not found — bake the variant first (npm run fonts:bake-all)`);
  }

  execFileSync('python3', [
    getScriptPath('build_full_glyph_ttf.py'),
    ensureOriginalTtf(variant, staticTtf),
    staticTtf,
    charset,
    path.join(variantDir, `${variant}-features.json`),
  ]);
  execFileSync('node', [
    getScriptPath('bake_atlas.cjs'),
    '--font',
    staticTtf,
    '--charset',
    charset,
    '--out-dir',
    variantDir,
    '--name',
    `${variant}-msdf`,
    '--texture-size',
    TEXTURE_SIZE,
    '--no-kerning',
    'true',
  ]);

  return variant;
}

function main() {
  const families = parseFamilies(process.argv.slice(2));
  const catalog = loadCatalog();
  const entries = catalog.filter(({ family }) => families.includes(family));
  const fullGlyphs = loadFamilySet(FULL_GLYPHS_PATH);
  const variants = entries.flatMap(({ family, italic, weights }) => weights.map((weight) => ({ family, italic, weight })));

  variants.forEach(({ family, italic, weight }, index) => {
    const variant = bakeVariant(family, weight, italic);

    fullGlyphs.add(variant);
    saveFullGlyphs(fullGlyphs);
    console.log(`[${index + 1}/${variants.length}] baked every glyph of ${variant}`);
  });

  execFileSync('node', [getScriptPath('generate_manifest.mjs')], { stdio: 'inherit' });
}

main();
