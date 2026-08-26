#!/usr/bin/env node
/**
 * Batch-generates the Figma-style name-preview SVG (scripts/generate_preview_svg.py) for every
 * entry in data/google-fonts-catalog.json that doesn't have one yet — deliberately NOT the full
 * MSDF atlas (that's scripts/bake_font.sh, a much heavier per-weight operation with no reason to
 * run for all 2292 entries up front). A picker list needs every row's preview available at once
 * (unlike the atlas, which is only needed once a specific font is actually selected), so unlike
 * the atlas this can't be left to bake-on-miss in scripts/serve.mjs.
 *
 * Source of the font file: Google's own CSS2 API (fonts.googleapis.com), not the google/fonts
 * GitHub source repo. An old-browser User-Agent makes it serve a plain .ttf instead of .woff2, and
 * — crucially — already instanced to the exact weight/style requested, so no fontTools freezing
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
 *   node scripts/generate_all_previews.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONTS_DIR = path.join(REPO_ROOT, 'fonts');
const CATALOG_PATH = path.join(REPO_ROOT, 'data', 'google-fonts-catalog.json');
const CACHE_DIR = path.join(REPO_ROOT, '.cache', 'preview-sources');

// Old/unrecognized browsers get served a plain .ttf; modern ones get .woff2 — this is the
// well-known trick for pulling a raw TTF straight out of Google's CSS API.
const OLD_BROWSER_USER_AGENT = 'Mozilla/4.0';
const TTF_URL_PATTERN = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/;

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function previewPath(family, name) {
  return path.join(FONTS_DIR, family, `${name}.svg`);
}

async function fetchRegularTtfUrl(family, italic) {
  const spec = italic ? 'ital,wght@1,400' : 'wght@400';
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${spec}&display=swap`;
  const response = await fetch(url, { headers: { 'User-Agent': OLD_BROWSER_USER_AGENT } });

  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }

  const css = await response.text();
  const match = css.match(TTF_URL_PATTERN);

  if (!match) {
    throw new Error(`no .ttf src found in CSS response for "${family}"${italic ? ' Italic' : ''}`);
  }

  return match[1];
}

async function ensureRegularTtf(family, italic) {
  const cachedPath = path.join(CACHE_DIR, `${family}${italic ? '-Italic' : ''}.ttf`);

  if (!fs.existsSync(cachedPath)) {
    const ttfUrl = await fetchRegularTtfUrl(family, italic);
    const response = await fetch(ttfUrl);

    if (!response.ok) {
      throw new Error(`failed to download ${ttfUrl}: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    fs.mkdirSync(path.dirname(cachedPath), { recursive: true });
    fs.writeFileSync(cachedPath, buffer);
  }

  return cachedPath;
}

async function generateOne(entry) {
  const outputPath = previewPath(entry.family, entry.name);

  if (fs.existsSync(outputPath)) {
    return 'skipped';
  }

  const ttfPath = await ensureRegularTtf(entry.family, entry.italic);

  execFileSync('python3', [
    path.join(REPO_ROOT, 'scripts', 'generate_preview_svg.py'),
    ttfPath,
    entry.name,
    outputPath,
  ]);

  return 'generated';
}

async function main() {
  const catalog = loadCatalog();
  const failures = [];
  let generated = 0;
  let skipped = 0;

  for (let i = 0; i < catalog.length; i += 1) {
    const entry = catalog[i];

    // eslint-disable-next-line no-await-in-loop
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await generateOne(entry);

      if (result === 'generated') {
        generated += 1;
        console.log(`[${i + 1}/${catalog.length}] generated: ${entry.name}`);
      } else {
        skipped += 1;
      }
    } catch (error) {
      failures.push({ name: entry.name, message: error.message });
      console.error(`[${i + 1}/${catalog.length}] FAILED: ${entry.name} — ${error.message}`);
    }
  }

  console.log('');
  console.log(`done: ${generated} generated, ${skipped} already present, ${failures.length} failed`);

  if (failures.length > 0) {
    const failuresPath = path.join(REPO_ROOT, '.cache', 'preview-failures.json');

    fs.mkdirSync(path.dirname(failuresPath), { recursive: true });
    fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
    console.log(`failure details: ${failuresPath}`);
  }
}

main();
