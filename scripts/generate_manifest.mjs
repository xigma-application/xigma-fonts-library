#!/usr/bin/env node
/**
 * Scans fonts/<FontName>/<FontName>-<weight>[-Italic]/ and writes fonts/manifest.json — the list
 * of available font groups (family, or family+italic as its own entry) with their weights, for
 * xigma-app's text-properties panel to fetch and populate a font picker from (Etap 9 of
 * xigma-app/docs/ROADMAP.md: "manifest/katalog dostępnych fontów (...) do wyboru w panelu
 * właściwości tekstu"). Names are display names ("Inter", "Inter Italic"), not folder slugs.
 *
 * Usage:
 *   node scripts/generate_manifest.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved relative to this file, not process.cwd() — bake_font.sh may invoke this from anywhere.
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONTS_DIR = path.join(REPO_ROOT, 'fonts');
const MANIFEST_PATH = path.join(FONTS_DIR, 'manifest.json');
const VARIANT_NAME_PATTERN = /^(.+)-(\d{1,4})(-Italic)?$/;

function listDirs(dirPath) {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function findVariantDirNames(fontsDir) {
  const familyNames = listDirs(fontsDir);

  return familyNames.flatMap((familyName) => listDirs(path.join(fontsDir, familyName)));
}

function parseVariantDirName(variantDirName) {
  const match = variantDirName.match(VARIANT_NAME_PATTERN);

  if (!match) {
    throw new Error(
      `variant folder name doesn't match <FontName>-<weight>[-Italic]: ${variantDirName}`,
    );
  }

  const [, family, weight, italicSuffix] = match;

  return { family, weight: Number(weight), italic: Boolean(italicSuffix) };
}

function buildManifest(variantDirNames) {
  const weightsByName = new Map();

  variantDirNames.forEach((variantDirName) => {
    const { family, weight, italic } = parseVariantDirName(variantDirName);
    const name = italic ? `${family} Italic` : family;

    if (!weightsByName.has(name)) {
      weightsByName.set(name, new Set());
    }

    weightsByName.get(name).add(weight);
  });

  return Array.from(weightsByName.entries())
    .map(([name, weights]) => ({ name, weights: Array.from(weights).sort((a, b) => a - b) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const variantDirNames = findVariantDirNames(FONTS_DIR);
  const manifest = buildManifest(variantDirNames);

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${manifest.length} font group(s) to ${MANIFEST_PATH}`);
}

main();
