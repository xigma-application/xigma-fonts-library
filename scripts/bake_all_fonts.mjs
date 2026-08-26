#!/usr/bin/env node
/**
 * Batch-bakes the real MSDF atlas for every (family, weight, style) in
 * data/google-fonts-catalog.json — the full local "package" of everything, not just the previews.
 *
 * Source TTF comes from scripts/lib/googleFontsCss.mjs (Google's CSS2 API), not
 * scripts/lib/googleFontsSource.mjs (GitHub) — that file is already instanced to the exact
 * requested weight/style by Google's own servers, so this skips scripts/freeze_variable_font.py
 * entirely (nothing to freeze, it's already a static single-weight TTF) and, unlike the
 * GitHub/variable-font path, works uniformly for static-only families too — full catalog
 * coverage instead of only the ~half that ship a variable font.
 *
 * Skips any (family, weight, style) already baked on disk, so it's safe to re-run/resume.
 * Continues past a single entry's failure rather than aborting the whole run.
 *
 * Usage:
 *   node scripts/bake_all_fonts.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureInstancedTtf } from './lib/googleFontsCss.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONTS_DIR = path.join(REPO_ROOT, 'fonts');
const CATALOG_PATH = path.join(REPO_ROOT, 'data', 'google-fonts-catalog.json');
const CACHE_DIR = path.join(REPO_ROOT, '.cache');
const DEFAULT_CHARSET_PATH = path.join(FONTS_DIR, 'Inter', 'Inter-400', 'charset.txt');

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function ensureCharset(variantDir) {
  const charsetPath = path.join(variantDir, 'charset.txt');

  if (!fs.existsSync(charsetPath)) {
    fs.mkdirSync(variantDir, { recursive: true });
    fs.copyFileSync(DEFAULT_CHARSET_PATH, charsetPath);
  }
}

function isAlreadyBaked(variantDir, variantName) {
  return (
    fs.existsSync(path.join(variantDir, `${variantName}-msdf.json`)) &&
    fs.existsSync(path.join(variantDir, `${variantName}-msdf.png`))
  );
}

async function bakeOne(family, weight, italic) {
  const variantName = `${family}-${weight}${italic ? '-Italic' : ''}`;
  const variantDir = path.join(FONTS_DIR, family, variantName);

  if (isAlreadyBaked(variantDir, variantName)) {
    return 'skipped';
  }

  const ttfPath = await ensureInstancedTtf(CACHE_DIR, family, weight, italic);

  ensureCharset(variantDir);

  execFileSync('node', [
    path.join(REPO_ROOT, 'scripts', 'bake_atlas.cjs'),
    '--font', ttfPath,
    '--charset', path.join(variantDir, 'charset.txt'),
    '--out-dir', variantDir,
    '--name', `${variantName}-msdf`,
  ]);

  return 'baked';
}

function flattenJobs(catalog) {
  return catalog.flatMap((entry) =>
    entry.weights.map((weight) => ({ family: entry.family, weight, italic: entry.italic, label: `${entry.name} ${weight}` })),
  );
}

async function main() {
  const catalog = loadCatalog();
  const jobs = flattenJobs(catalog);
  const failures = [];
  let baked = 0;
  let skipped = 0;

  console.log(`${jobs.length} (family, weight, style) combinations to bake`);

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];

    // eslint-disable-next-line no-await-in-loop
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await bakeOne(job.family, job.weight, job.italic);

      if (result === 'baked') {
        baked += 1;
        console.log(`[${i + 1}/${jobs.length}] baked: ${job.label}`);
      } else {
        skipped += 1;
      }
    } catch (error) {
      failures.push({ label: job.label, message: error.message });
      console.error(`[${i + 1}/${jobs.length}] FAILED: ${job.label} — ${error.message}`);
    }
  }

  console.log('');
  console.log(`done: ${baked} baked, ${skipped} already present, ${failures.length} failed`);

  if (failures.length > 0) {
    const failuresPath = path.join(CACHE_DIR, 'bake-failures.json');

    fs.mkdirSync(path.dirname(failuresPath), { recursive: true });
    fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
    console.log(`failure details: ${failuresPath}`);
  }

  execFileSync('node', [path.join(REPO_ROOT, 'scripts', 'generate_manifest.mjs')], { stdio: 'inherit' });
}

main();
