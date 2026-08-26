#!/usr/bin/env node
/**
 * Fetches the full Google Fonts family list (name + available weights/styles) from Google's own
 * public metadata endpoint and writes a lean, committed reference file: data/google-fonts-catalog.json.
 *
 * This is the "what could we offer" catalog — scripts/generate_manifest.mjs turns every entry here
 * into a fonts/manifest.json entry with computed (not conditional) atlas/texture/preview paths,
 * plus a `baked` flag per weight for whether that path is actually on disk right now.
 *
 * Re-run this occasionally to refresh the catalog as Google adds/changes fonts — it's not tied to
 * any bake, so there's no reason to run it as part of scripts/bake_font.sh.
 *
 * Usage:
 *   node scripts/fetch_google_fonts_catalog.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'google-fonts-catalog.json');
const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const STYLE_KEY_PATTERN = /^(\d{1,4})(i)?$/;

// Explicit locale + base sensitivity: case and accents don't affect ordering (so "Inter"/"inter"/
// "Íntér" would sort together) — deterministic regardless of the runtime's default ICU locale,
// unlike a bare a.localeCompare(b).
const alphabetically = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

async function fetchMetadata() {
  const response = await fetch(METADATA_URL);

  if (!response.ok) {
    throw new Error(`${METADATA_URL} responded ${response.status}`);
  }

  const text = await response.text();
  // Google's endpoint prefixes the JSON body with an XSSI-protection line, e.g. ")]}'"
  const jsonText = text.startsWith(")]}'") ? text.split('\n').slice(1).join('\n') : text;

  return JSON.parse(jsonText);
}

function parseStyleKeys(styleKeys) {
  const weights = new Set();
  const italicWeights = new Set();

  styleKeys.forEach((key) => {
    const match = key.match(STYLE_KEY_PATTERN);

    if (match) {
      const [, weightText, italicSuffix] = match;
      (italicSuffix ? italicWeights : weights).add(Number(weightText));
    }
  });

  return { weights, italicWeights };
}

function buildCatalog(metadata) {
  const entries = [];

  metadata.familyMetadataList.forEach((family) => {
    const { weights, italicWeights } = parseStyleKeys(Object.keys(family.fonts ?? {}));

    if (weights.size > 0) {
      entries.push({
        name: family.family,
        family: family.family,
        italic: false,
        weights: Array.from(weights).sort((a, b) => a - b),
      });
    }

    if (italicWeights.size > 0) {
      entries.push({
        name: `${family.family} Italic`,
        family: family.family,
        italic: true,
        weights: Array.from(italicWeights).sort((a, b) => a - b),
      });
    }
  });

  return entries.sort((a, b) => alphabetically(a.name, b.name));
}

async function main() {
  const metadata = await fetchMetadata();
  const catalog = buildCatalog(metadata);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`wrote ${catalog.length} catalog entries to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
