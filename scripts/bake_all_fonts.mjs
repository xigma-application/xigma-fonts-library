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
 * Then re-bakes the fonts that have small caps with them (scripts/bake_small_caps.mjs), so this one
 * command leaves every atlas complete; --without-small-caps skips that (the pipeline UI runs it as
 * its own step).
 *
 * Usage:
 *   node scripts/bake_all_fonts.mjs
 *   node scripts/bake_all_fonts.mjs --without-small-caps
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ensureInstancedTtf } from './lib/googleFontsCss.mjs';
import { CACHE_DIR, FONTS_DIR, getScriptPath } from './lib/repoPaths.mjs';
import { loadCatalog } from './lib/catalog.mjs';
import { ensureCharset, getVariantName } from './lib/variants.mjs';

function isAlreadyBaked(variantDir, variantName) {
  return (
    fs.existsSync(path.join(variantDir, `${variantName}-msdf.json`)) && fs.existsSync(path.join(variantDir, `${variantName}-msdf.png`))
  );
}

async function bakeOne(family, weight, italic) {
  const variantName = getVariantName(family, weight, italic);
  const variantDir = path.join(FONTS_DIR, family, variantName);

  if (isAlreadyBaked(variantDir, variantName)) {
    return 'skipped';
  }

  const ttfPath = await ensureInstancedTtf(CACHE_DIR, family, weight, italic);

  ensureCharset(variantDir);

  execFileSync('node', [
    getScriptPath('bake_atlas.cjs'),
    '--font',
    ttfPath,
    '--charset',
    path.join(variantDir, 'charset.txt'),
    '--out-dir',
    variantDir,
    '--name',
    `${variantName}-msdf`,
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

  if (!process.argv.includes('--without-small-caps')) {
    console.log('');
    execFileSync('node', [getScriptPath('bake_small_caps.mjs')], { stdio: 'inherit' });
  }

  execFileSync('node', [getScriptPath('generate_manifest.mjs')], { stdio: 'inherit' });
}

main();
