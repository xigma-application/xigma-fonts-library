#!/usr/bin/env node
/**
 * Re-bakes the MSDF atlas of every (family, weight, style) whose font has small caps (OpenType
 * `smcp`), so xigma-app can draw them.
 *
 * Google's CSS2 API instances that scripts/bake_all_fonts.mjs bakes from have their `smcp` feature
 * stripped, so this starts from the family's full variable-font source in google/fonts
 * (scripts/lib/googleFontsSource.mjs). scripts/build_small_caps_ttf.py freezes it to the weight and
 * maps each small cap to U+E000 + its lower case codepoint; the atlas is then baked from that TTF
 * with the charset plus those codepoints, replacing the plain atlas, and the TTF is written to the
 * variant's source/ folder, so flattening and export outline the same small caps. Families with no
 * `smcp` are skipped; a family with no variable font is read from its static file for each weight.
 *
 * Every variant baked this way is listed in data/small-caps.json, which scripts/generate_manifest.mjs
 * turns into `smallCaps: true` on that weight. Variants already listed there with an atlas on disk
 * are skipped, so the run is safe to stop and resume; one family failing never aborts it.
 *
 * Usage:
 *   node scripts/bake_small_caps.mjs                              — every family in the catalog
 *   node scripts/bake_small_caps.mjs --family Roboto --family "Alegreya Sans"
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ensureWeightSourceTtf } from './lib/googleFontsSource.mjs';
import { CACHE_DIR, FONTS_DIR, SMALL_CAPS_PATH, getScriptPath } from './lib/repoPaths.mjs';
import { loadCatalog, loadFamilySet } from './lib/catalog.mjs';
import { ensureCharset, getVariantName } from './lib/variants.mjs';

const NO_SMALL_CAPS_EXIT_CODE = 3;

function parseFamilies(argv) {
  return argv.flatMap((arg, index) => (arg === '--family' && argv[index + 1] ? [argv[index + 1]] : []));
}

function saveSmallCaps(smallCaps) {
  fs.writeFileSync(SMALL_CAPS_PATH, `${JSON.stringify([...smallCaps].sort(), null, 2)}\n`);
}

function isAlreadyBaked(smallCaps, variantDir, variant) {
  return smallCaps.has(variant) && fs.existsSync(path.join(variantDir, `${variant}-msdf.json`));
}

function bakeVariant(sourceTtf, family, weight, italic) {
  const variant = getVariantName(family, weight, italic);
  const variantDir = path.join(FONTS_DIR, family, variant);
  const staticTtf = path.join(variantDir, 'source', `${variant}.ttf`);
  const bakeCharset = path.join(CACHE_DIR, 'small-caps', `${variant}.txt`);
  const build = spawnSync(
    'python3',
    [getScriptPath('build_small_caps_ttf.py'), sourceTtf, staticTtf, ensureCharset(variantDir), bakeCharset, `wght=${weight}`],
    { encoding: 'utf8' },
  );

  if (build.status === NO_SMALL_CAPS_EXIT_CODE) {
    return null;
  }

  if (build.status !== 0) {
    throw new Error(build.stderr.trim() || `build_small_caps_ttf.py exited with ${build.status}`);
  }

  execFileSync('node', [
    getScriptPath('bake_atlas.cjs'),
    '--font',
    staticTtf,
    '--charset',
    bakeCharset,
    '--out-dir',
    variantDir,
    '--name',
    `${variant}-msdf`,
  ]);

  return variant;
}

async function bakeEntry(entry, smallCaps) {
  const pending = entry.weights.filter((weight) => {
    const variant = getVariantName(entry.family, weight, entry.italic);

    return !isAlreadyBaked(smallCaps, path.join(FONTS_DIR, entry.family, variant), variant);
  });

  if (pending.length === 0) {
    return 'skipped';
  }

  let result = 'none';

  for (const weight of pending) {
    // eslint-disable-next-line no-await-in-loop
    const sourceTtf = await ensureWeightSourceTtf(CACHE_DIR, entry.family, weight, entry.italic);
    const variant = sourceTtf ? bakeVariant(sourceTtf, entry.family, weight, entry.italic) : null;

    if (!variant) {
      return result;
    }

    smallCaps.add(variant);
    saveSmallCaps(smallCaps);
    result = 'baked';
  }

  return result;
}

async function main() {
  const families = parseFamilies(process.argv.slice(2));
  const catalog = loadCatalog();
  const entries =
    families.length > 0 ? catalog.filter(({ family, name }) => families.includes(family) || families.includes(name)) : catalog;
  const smallCaps = loadFamilySet(SMALL_CAPS_PATH);
  const failures = [];
  const counts = { baked: 0, none: 0, skipped: 0 };

  console.log(`${entries.length} font group(s) to check for small caps`);

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await bakeEntry(entry, smallCaps);

      counts[result] += 1;

      if (result === 'baked') {
        console.log(`[${i + 1}/${entries.length}] baked: ${entry.name}`);
      }
    } catch (error) {
      failures.push({ label: entry.name, message: error.message });
      console.error(`[${i + 1}/${entries.length}] FAILED: ${entry.name} — ${error.message}`);
    }
  }

  console.log('');
  console.log(`done: ${counts.baked} baked, ${counts.none} without small caps, ${counts.skipped} already baked, ${failures.length} failed`);

  if (failures.length > 0) {
    const failuresPath = path.join(CACHE_DIR, 'small-caps-failures.json');

    fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
    console.log(`failure details: ${failuresPath}`);
  }

  execFileSync('node', [getScriptPath('generate_manifest.mjs')], { stdio: 'inherit' });
}

main();
