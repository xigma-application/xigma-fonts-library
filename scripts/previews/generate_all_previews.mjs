#!/usr/bin/env node
/**
 * Batch-generates the Figma-style name-preview SVG (scripts/previews/generate_preview_svg.py) for every
 * entry in data/google-fonts-catalog.json that doesn't have one yet — deliberately NOT the full
 * MSDF atlas (that's scripts/atlas/bake_font.sh, a much heavier per-weight operation with no reason to
 * run for all 2292 entries up front). A picker list needs every row's preview available at once
 * (unlike the atlas, which is only needed once a specific font is actually selected), so unlike
 * the atlas this can't be left to bake-on-miss in scripts/serve.mjs.
 *
 * Source of the font file: Google's own CSS2 API (fonts.googleapis.com, scripts/lib/googleFontsCss.mjs),
 * not the google/fonts GitHub source repo. It serves the font already instanced to the exact weight/style requested, so no fontTools freezing
 * step is needed here at all. This also works uniformly for both variable and static-only
 * families, and isn't subject to GitHub's 60-req/hour unauthenticated API limit, which
 * scripts/lib/googleFontsSource.mjs (per-family Contents API calls) hit almost immediately during
 * a full-catalog run — that's specific to on-demand atlas baking in scripts/serve.mjs, which needs
 * the actual variable font to freeze arbitrary weights from; this script only ever wants Regular/400.
 *
 * Continues past a single entry's failure rather than aborting the whole run; failures are
 * collected and summarized at the end, not silently dropped.
 *
 * Usage:
 *   node scripts/previews/generate_all_previews.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { reportFailures, runBatch } from '../lib/batch.mjs';
import { loadCatalog } from '../lib/catalog.mjs';
import { ensureInstancedTtfAt } from '../lib/googleFontsCss.mjs';
import { CACHE_DIR, FONTS_DIR, SCRIPTS } from '../lib/repoPaths.mjs';

const PREVIEW_SOURCES_DIR = path.join(CACHE_DIR, 'preview-sources');
const PREVIEW_WEIGHT = 400;

async function generatePreview({ family, italic, name }) {
  const outputPath = path.join(FONTS_DIR, family, `${name}.svg`);

  if (fs.existsSync(outputPath)) {
    return 'skipped';
  }

  const ttfPath = path.join(PREVIEW_SOURCES_DIR, `${family}${italic ? '-Italic' : ''}.ttf`);

  await ensureInstancedTtfAt(ttfPath, family, PREVIEW_WEIGHT, italic);
  execFileSync('python3', [SCRIPTS.generatePreviewSvg, ttfPath, name, outputPath]);

  return 'generated';
}

async function main() {
  const { counts, failures } = await runBatch(loadCatalog(), {
    getLabel: ({ name }) => name,
    logged: ['generated'],
    run: generatePreview,
  });

  console.log('');
  console.log(`done: ${counts.generated ?? 0} generated, ${counts.skipped ?? 0} already present, ${failures.length} failed`);
  reportFailures(
    'preview-failures.json',
    failures.map(({ label, message }) => ({ name: label, message })),
  );
}

main();
