#!/usr/bin/env node
/**
 * Re-bakes the MSDF atlas of every (family, weight, style) whose font has small caps (OpenType
 * `smcp`), so xigma-app can draw them.
 *
 * Google's CSS2 API instances that scripts/atlas/bake_all_fonts.mjs bakes from have their `smcp` feature
 * stripped, so this starts from the family's full variable-font source in google/fonts
 * (scripts/lib/googleFontsSource.mjs). scripts/atlas/build_small_caps_ttf.py freezes it to the weight and
 * maps each small cap to U+E000 + its lower case codepoint; the atlas is then baked from that TTF
 * with the charset plus those codepoints, replacing the plain atlas, and the TTF is written to the
 * variant's source/ folder, so flattening and export outline the same small caps. Families with no
 * `smcp` are skipped; a family with no variable font is read from its static file for each weight.
 *
 * Every variant baked this way is listed in data/small-caps.json, which scripts/catalog/generate_manifest.mjs
 * turns into `smallCaps: true` on that weight. Variants already listed there with an atlas on disk
 * are skipped, so the run is safe to stop and resume; one family failing never aborts it.
 *
 * Usage:
 *   node scripts/atlas/bake_small_caps.mjs                              — every family in the catalog
 *   node scripts/atlas/bake_small_caps.mjs --family Roboto --family "Alegreya Sans"
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { reportFailures, runBatch } from '../lib/batch.mjs';
import { loadCatalog, loadFamilySet, parseFamilyArgs } from '../lib/catalog.mjs';
import { ensureWeightSourceTtf } from '../lib/googleFontsSource.mjs';
import { CACHE_DIR, SCRIPTS, SMALL_CAPS_PATH } from '../lib/repoPaths.mjs';
import { regenerateManifest, runBakeAtlas } from '../lib/runScripts.mjs';
import { ensureCharset, getVariantDir, getVariantName, getVariantTtfPath } from '../lib/variants.mjs';

// build_small_caps_ttf.py's exit code for a font without `smcp`.
const NO_SMALL_CAPS_EXIT_CODE = 3;

function saveSmallCaps(smallCaps) {
  fs.writeFileSync(SMALL_CAPS_PATH, `${JSON.stringify([...smallCaps].sort(), null, 2)}\n`);
}

function isAlreadyBaked(smallCaps, family, variant) {
  return smallCaps.has(variant) && fs.existsSync(path.join(getVariantDir(family, variant), `${variant}-msdf.json`));
}

/** Bakes the variant with its small caps; returns false when the font has none. */
function bakeVariant(sourceTtf, family, weight, italic) {
  const variant = getVariantName(family, weight, italic);
  const variantDir = getVariantDir(family, variant);
  const staticTtf = getVariantTtfPath(family, variant);
  const bakeCharset = path.join(CACHE_DIR, 'small-caps', `${variant}.txt`);
  const build = spawnSync(
    'python3',
    [SCRIPTS.buildSmallCapsTtf, sourceTtf, staticTtf, ensureCharset(variantDir), bakeCharset, `wght=${weight}`],
    { encoding: 'utf8' },
  );

  if (build.status === NO_SMALL_CAPS_EXIT_CODE) {
    return false;
  }

  if (build.status !== 0) {
    throw new Error(build.stderr.trim() || `build_small_caps_ttf.py exited with ${build.status}`);
  }

  runBakeAtlas({ charset: bakeCharset, font: staticTtf, outDir: variantDir, variant });

  return true;
}

/** 'baked', 'none' when the font has no small caps, or 'skipped' when every weight is already baked with them. */
async function bakeEntry({ family, italic, weights }, smallCaps) {
  const pending = weights.filter((weight) => !isAlreadyBaked(smallCaps, family, getVariantName(family, weight, italic)));

  if (pending.length === 0) {
    return 'skipped';
  }

  let result = 'none';

  for (const weight of pending) {
    // eslint-disable-next-line no-await-in-loop
    const sourceTtf = await ensureWeightSourceTtf(family, weight, italic);

    if (!sourceTtf || !bakeVariant(sourceTtf, family, weight, italic)) {
      return result;
    }

    smallCaps.add(getVariantName(family, weight, italic));
    saveSmallCaps(smallCaps);
    result = 'baked';
  }

  return result;
}

async function main() {
  const families = parseFamilyArgs(process.argv.slice(2));
  const catalog = loadCatalog();
  const entries =
    families.length > 0 ? catalog.filter(({ family, name }) => families.includes(family) || families.includes(name)) : catalog;
  const smallCaps = loadFamilySet(SMALL_CAPS_PATH);

  console.log(`${entries.length} font group(s) to check for small caps`);

  const { counts, failures } = await runBatch(entries, {
    getLabel: ({ name }) => name,
    logged: ['baked'],
    run: (entry) => bakeEntry(entry, smallCaps),
  });

  console.log('');
  console.log(
    `done: ${counts.baked ?? 0} baked, ${counts.none ?? 0} without small caps, ${counts.skipped ?? 0} already baked, ${failures.length} failed`,
  );
  reportFailures('small-caps-failures.json', failures);
  regenerateManifest();
}

main();
