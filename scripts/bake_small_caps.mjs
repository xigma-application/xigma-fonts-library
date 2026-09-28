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
 * `smcp`, or with no variable-font source (static-only families), are skipped.
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
import { fileURLToPath } from 'node:url';

import { ensureSourceTtf } from './lib/googleFontsSource.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONTS_DIR = path.join(REPO_ROOT, 'fonts');
const CATALOG_PATH = path.join(REPO_ROOT, 'data', 'google-fonts-catalog.json');
const SMALL_CAPS_PATH = path.join(REPO_ROOT, 'data', 'small-caps.json');
const CACHE_DIR = path.join(REPO_ROOT, '.cache');
const DEFAULT_CHARSET_PATH = path.join(FONTS_DIR, 'Inter', 'Inter-400', 'charset.txt');
const NO_SMALL_CAPS_EXIT_CODE = 3;

function parseFamilies(argv) {
  return argv.flatMap((arg, index) => (arg === '--family' && argv[index + 1] ? [argv[index + 1]] : []));
}

function loadSmallCaps() {
  return new Set(fs.existsSync(SMALL_CAPS_PATH) ? JSON.parse(fs.readFileSync(SMALL_CAPS_PATH, 'utf8')) : []);
}

function saveSmallCaps(smallCaps) {
  fs.writeFileSync(SMALL_CAPS_PATH, `${JSON.stringify([...smallCaps].sort(), null, 2)}\n`);
}

function ensureCharset(variantDir) {
  const charsetPath = path.join(variantDir, 'charset.txt');

  if (!fs.existsSync(charsetPath)) {
    fs.mkdirSync(variantDir, { recursive: true });
    fs.copyFileSync(DEFAULT_CHARSET_PATH, charsetPath);
  }

  return charsetPath;
}

function isAlreadyBaked(smallCaps, variantDir, variant) {
  return smallCaps.has(variant) && fs.existsSync(path.join(variantDir, `${variant}-msdf.json`));
}

function bakeVariant(sourceTtf, family, weight, italic) {
  const variant = `${family}-${weight}${italic ? '-Italic' : ''}`;
  const variantDir = path.join(FONTS_DIR, family, variant);
  const staticTtf = path.join(variantDir, 'source', `${variant}.ttf`);
  const bakeCharset = path.join(CACHE_DIR, 'small-caps', `${variant}.txt`);
  const build = spawnSync(
    'python3',
    [
      path.join(REPO_ROOT, 'scripts', 'build_small_caps_ttf.py'),
      sourceTtf,
      staticTtf,
      ensureCharset(variantDir),
      bakeCharset,
      `wght=${weight}`,
    ],
    { encoding: 'utf8' },
  );

  if (build.status === NO_SMALL_CAPS_EXIT_CODE) {
    return null;
  }

  if (build.status !== 0) {
    throw new Error(build.stderr.trim() || `build_small_caps_ttf.py exited with ${build.status}`);
  }

  execFileSync('node', [
    path.join(REPO_ROOT, 'scripts', 'bake_atlas.cjs'),
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
    const variant = `${entry.family}-${weight}${entry.italic ? '-Italic' : ''}`;

    return !isAlreadyBaked(smallCaps, path.join(FONTS_DIR, entry.family, variant), variant);
  });

  if (pending.length === 0) {
    return 'skipped';
  }

  const sourceTtf = await ensureSourceTtf(CACHE_DIR, entry.family, entry.italic);

  for (const weight of pending) {
    const variant = bakeVariant(sourceTtf, entry.family, weight, entry.italic);

    if (!variant) {
      return 'none';
    }

    smallCaps.add(variant);
    saveSmallCaps(smallCaps);
  }

  return 'baked';
}

async function main() {
  const families = parseFamilies(process.argv.slice(2));
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const entries =
    families.length > 0 ? catalog.filter(({ family, name }) => families.includes(family) || families.includes(name)) : catalog;
  const smallCaps = loadSmallCaps();
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
        console.log(`[${i + 1}/${entries.length}] small caps baked: ${entry.name}`);
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

  execFileSync('node', [path.join(REPO_ROOT, 'scripts', 'generate_manifest.mjs')], { stdio: 'inherit' });
}

main();
