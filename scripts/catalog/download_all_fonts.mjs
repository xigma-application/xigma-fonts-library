#!/usr/bin/env node
/**
 * Downloads the source TTF for every (family, weight, style) in data/google-fonts-catalog.json
 * into .cache/css-instances/ — the same files scripts/atlas/bake_all_fonts.mjs bakes from, without
 * baking any atlas. Useful to fetch everything up front (e.g. before going offline) and bake later.
 *
 * Skips any TTF already cached, so it's safe to re-run/resume.
 * Continues past a single entry's failure rather than aborting the whole run.
 *
 * Usage:
 *   node scripts/catalog/download_all_fonts.mjs
 */

import fs from 'node:fs';

import { reportFailures } from '../lib/batch.mjs';
import { listCatalogVariants, loadCatalog } from '../lib/catalog.mjs';
import { getInstancedTtfPath } from '../lib/fontSourcePaths.mjs';
import { ensureInstancedTtf } from '../lib/googleFontsCss.mjs';
import { getVariantName } from '../lib/variants.mjs';

const CONCURRENCY = 8;

async function main() {
  const variants = listCatalogVariants(loadCatalog());
  const pending = variants.filter(
    ({ family, weight, italic }) => !fs.existsSync(getInstancedTtfPath(family, getVariantName(family, weight, italic))),
  );
  const cachedCount = variants.length - pending.length;
  const failures = [];
  let downloaded = 0;
  let next = 0;

  console.log(`${variants.length} (family, weight, style) combinations, ${cachedCount} already cached`);

  async function worker() {
    while (next < pending.length) {
      const index = next;
      const { family, weight, italic, label } = pending[index];

      next += 1;

      try {
        // eslint-disable-next-line no-await-in-loop
        await ensureInstancedTtf(family, weight, italic);
        downloaded += 1;
        console.log(`[${index + 1}/${pending.length}] downloaded: ${label}`);
      } catch (error) {
        failures.push({ label, message: error.message });
        console.error(`[${index + 1}/${pending.length}] FAILED: ${label} — ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log('');
  console.log(`done: ${downloaded} downloaded, ${cachedCount} already cached, ${failures.length} failed`);
  reportFailures('download-failures.json', failures);
}

main();
