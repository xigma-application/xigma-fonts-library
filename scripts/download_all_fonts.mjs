#!/usr/bin/env node
/**
 * Downloads the source TTF for every (family, weight, style) in data/google-fonts-catalog.json
 * into .cache/css-instances/ — the same files scripts/bake_all_fonts.mjs bakes from, without
 * baking any atlas. Useful to fetch everything up front (e.g. before going offline) and bake later.
 *
 * Skips any TTF already cached, so it's safe to re-run/resume.
 * Continues past a single entry's failure rather than aborting the whole run.
 *
 * Usage:
 *   node scripts/download_all_fonts.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureInstancedTtf } from './lib/googleFontsCss.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CATALOG_PATH = path.join(REPO_ROOT, 'data', 'google-fonts-catalog.json');
const CACHE_DIR = path.join(REPO_ROOT, '.cache');
const CONCURRENCY = 8;

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function getCachedTtfPath(family, weight, italic) {
  return path.join(CACHE_DIR, 'css-instances', family, `${family}-${weight}${italic ? '-Italic' : ''}.ttf`);
}

function flattenJobs(catalog) {
  return catalog.flatMap((entry) =>
    entry.weights.map((weight) => ({ family: entry.family, weight, italic: entry.italic, label: `${entry.name} ${weight}` })),
  );
}

async function main() {
  const jobs = flattenJobs(loadCatalog());
  const pending = jobs.filter((job) => !fs.existsSync(getCachedTtfPath(job.family, job.weight, job.italic)));
  const failures = [];
  let downloaded = 0;
  let next = 0;

  console.log(`${jobs.length} (family, weight, style) combinations, ${jobs.length - pending.length} already cached`);

  async function worker() {
    while (next < pending.length) {
      const index = next;
      const job = pending[index];

      next += 1;

      try {
        // eslint-disable-next-line no-await-in-loop
        await ensureInstancedTtf(CACHE_DIR, job.family, job.weight, job.italic);
        downloaded += 1;
        console.log(`[${index + 1}/${pending.length}] downloaded: ${job.label}`);
      } catch (error) {
        failures.push({ label: job.label, message: error.message });
        console.error(`[${index + 1}/${pending.length}] FAILED: ${job.label} — ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log('');
  console.log(`done: ${downloaded} downloaded, ${jobs.length - pending.length} already cached, ${failures.length} failed`);

  if (failures.length > 0) {
    const failuresPath = path.join(CACHE_DIR, 'download-failures.json');

    fs.mkdirSync(path.dirname(failuresPath), { recursive: true });
    fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
    console.log(`failure details: ${failuresPath}`);
  }
}

main();
