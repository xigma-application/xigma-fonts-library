#!/usr/bin/env node
/**
 * Re-bakes the MSDF atlas of every weight of the given families (Inter by default) with every glyph of
 * the font, and writes its OpenType feature data next to it, so xigma-app can draw what the Type
 * settings Details tab turns on (stylistic sets, character variants, fractions, ligatures, kerning...).
 *
 * scripts/atlas/build_full_glyph_ttf.py maps every glyph of the variant's static TTF to a codepoint, writes
 * the charset of all of them and `<variant>-features.json`; the atlas is then baked from that TTF on a
 * 4096 texture without kernings (the features file carries them), replacing the plain atlas, and the
 * TTF replaces the variant's source/ one, so flattening and export outline the same glyphs. The first
 * run keeps the original TTF in .cache/full-glyphs/originals/, which later runs start from.
 *
 * Every variant baked this way is listed in data/full-glyphs.json, which scripts/catalog/generate_manifest.mjs
 * turns into a `features` path on that weight.
 *
 * Usage:
 *   node scripts/atlas/bake_full_glyphs.mjs                         — every weight of Inter
 *   node scripts/atlas/bake_full_glyphs.mjs --family Roboto --family Inter
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadCatalog, loadFamilySet, parseFamilyArgs } from '../lib/catalog.mjs';
import { CACHE_DIR, FULL_GLYPHS_PATH, SCRIPTS } from '../lib/repoPaths.mjs';
import { regenerateManifest, runBakeAtlas } from '../lib/runScripts.mjs';
import { getVariantDir, getVariantName, getVariantTtfPath } from '../lib/variants.mjs';

const FULL_GLYPHS_CACHE_DIR = path.join(CACHE_DIR, 'full-glyphs');
const DEFAULT_FAMILIES = ['Inter'];
const TEXTURE_SIZE = 4096;

function saveFullGlyphs(fullGlyphs) {
  fs.writeFileSync(FULL_GLYPHS_PATH, `${JSON.stringify([...fullGlyphs].sort(), null, 2)}\n`);
}

function getOriginalTtfPath(variant) {
  return path.join(FULL_GLYPHS_CACHE_DIR, 'originals', `${variant}.ttf`);
}

/** The variant's TTF as it was before its first full-glyph bake, which every later bake starts from. */
function ensureOriginalTtf(variant, staticTtf) {
  const original = getOriginalTtfPath(variant);

  if (!fs.existsSync(original)) {
    fs.mkdirSync(path.dirname(original), { recursive: true });
    fs.copyFileSync(staticTtf, original);
  }

  return original;
}

function bakeVariant(family, weight, italic) {
  const variant = getVariantName(family, weight, italic);
  const variantDir = getVariantDir(family, variant);
  const staticTtf = getVariantTtfPath(family, variant);
  const charset = path.join(FULL_GLYPHS_CACHE_DIR, 'charsets', `${variant}.txt`);

  if (!fs.existsSync(staticTtf) && !fs.existsSync(getOriginalTtfPath(variant))) {
    throw new Error(`${staticTtf} not found — bake the variant first (npm run fonts:bake-all)`);
  }

  execFileSync('python3', [
    SCRIPTS.buildFullGlyphTtf,
    ensureOriginalTtf(variant, staticTtf),
    staticTtf,
    charset,
    path.join(variantDir, `${variant}-features.json`),
  ]);
  runBakeAtlas({ charset, font: staticTtf, noKerning: true, outDir: variantDir, textureSize: TEXTURE_SIZE, variant });

  return variant;
}

function main() {
  const familyArgs = parseFamilyArgs(process.argv.slice(2));
  const families = familyArgs.length > 0 ? familyArgs : DEFAULT_FAMILIES;
  const fullGlyphs = loadFamilySet(FULL_GLYPHS_PATH);
  const variants = loadCatalog()
    .filter(({ family }) => families.includes(family))
    .flatMap(({ family, italic, weights }) => weights.map((weight) => ({ family, italic, weight })));

  variants.forEach(({ family, italic, weight }, index) => {
    const variant = bakeVariant(family, weight, italic);

    fullGlyphs.add(variant);
    saveFullGlyphs(fullGlyphs);
    console.log(`[${index + 1}/${variants.length}] baked every glyph of ${variant}`);
  });

  regenerateManifest();
}

main();
