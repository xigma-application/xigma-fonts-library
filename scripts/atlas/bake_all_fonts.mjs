#!/usr/bin/env node
/**
 * Batch-bakes the real MSDF atlas for every (family, weight, style) in
 * data/google-fonts-catalog.json — the full local "package" of everything, not just the previews.
 *
 * Source TTF comes from scripts/lib/googleFontsCss.mjs (Google's CSS2 API), not
 * scripts/lib/googleFontsSource.mjs (GitHub) — that file is already instanced to the exact
 * requested weight/style by Google's own servers, so this skips scripts/atlas/freeze_variable_font.py
 * entirely (nothing to freeze, it's already a static single-weight TTF) and, unlike the
 * GitHub/variable-font path, works uniformly for static-only families too — full catalog
 * coverage instead of only the ~half that ship a variable font.
 *
 * Skips any (family, weight, style) already baked on disk, so it's safe to re-run/resume.
 * Continues past a single entry's failure rather than aborting the whole run.
 *
 * Then re-bakes the fonts that have small caps with them (scripts/atlas/bake_small_caps.mjs), so this one
 * command leaves every atlas complete; --without-small-caps skips that (the pipeline UI runs it as
 * its own step).
 *
 * Usage:
 *   node scripts/atlas/bake_all_fonts.mjs
 *   node scripts/atlas/bake_all_fonts.mjs --without-small-caps
 */

import { execFileSync } from 'node:child_process';

import { reportFailures, runBatch } from '../lib/batch.mjs';
import { listCatalogVariants, loadCatalog } from '../lib/catalog.mjs';
import { ensureInstancedTtf } from '../lib/googleFontsCss.mjs';
import { SCRIPTS } from '../lib/repoPaths.mjs';
import { regenerateManifest, runBakeAtlas } from '../lib/runScripts.mjs';
import { ensureCharset, getVariantDir, getVariantName, isAtlasBaked } from '../lib/variants.mjs';

async function bakeVariant({ family, weight, italic }) {
  const variant = getVariantName(family, weight, italic);
  const variantDir = getVariantDir(family, variant);

  if (isAtlasBaked(family, variant)) {
    return 'skipped';
  }

  const font = await ensureInstancedTtf(family, weight, italic);

  runBakeAtlas({ charset: ensureCharset(variantDir), font, outDir: variantDir, variant });

  return 'baked';
}

async function main() {
  const variants = listCatalogVariants(loadCatalog());

  console.log(`${variants.length} (family, weight, style) combinations to bake`);

  const { counts, failures } = await runBatch(variants, { getLabel: ({ label }) => label, logged: ['baked'], run: bakeVariant });

  console.log('');
  console.log(`done: ${counts.baked ?? 0} baked, ${counts.skipped ?? 0} already present, ${failures.length} failed`);
  reportFailures('bake-failures.json', failures);

  if (!process.argv.includes('--without-small-caps')) {
    console.log('');
    execFileSync('node', [SCRIPTS.bakeSmallCaps], { stdio: 'inherit' });
  }

  regenerateManifest();
}

main();
