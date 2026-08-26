#!/usr/bin/env node
/**
 * Scans fonts/<FontName>/<FontName>-<weight>[-Italic]/ and writes fonts/manifest.json — the list
 * of available font groups (family, or family+italic as its own entry), each weight carrying the
 * actual atlas/texture paths (relative to fonts/), for xigma-app's text-properties panel to fetch
 * and populate a font picker from without guessing any folder-naming convention itself (Etap 9 of
 * xigma-app/docs/ROADMAP.md: "manifest/katalog dostępnych fontów (...) do wyboru w panelu
 * właściwości tekstu"). `name` is a display name ("Inter", "Inter Italic"), not a folder slug.
 *
 * Each group also gets an optional `preview` path if fonts/<Family>/<name-with-dashes>.svg exists
 * — a lightweight, pre-rendered vector snapshot of the family's own display name in its own
 * glyph outlines (scripts/generate_preview_svg.py), the same trick Figma's font picker uses to
 * show 1600+ font rows without loading a real webfont per row. One per family/style is enough
 * (unlike the atlas, this doesn't need to be per weight) — currently generated manually, not
 * wired into bake_font.sh.
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

function findVariantDirs(fontsDir) {
  const familyDirNames = listDirs(fontsDir);

  return familyDirNames.flatMap((familyDirName) =>
    listDirs(path.join(fontsDir, familyDirName)).map((variantDirName) => ({
      familyDirName,
      variantDirName,
    })),
  );
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

// bake_font.sh/bake_atlas.cjs always name outputs `${variantDirName}-msdf.{json,png}` inside the
// variant's own dir — asserted here (not just assumed) so an inconsistent bake fails loudly
// instead of shipping a manifest with paths that don't resolve.
function resolveOutputPaths(fontsDir, familyDirName, variantDirName) {
  const baseName = `${variantDirName}-msdf`;
  const atlasRelative = path.join(familyDirName, variantDirName, `${baseName}.json`);
  const textureRelative = path.join(familyDirName, variantDirName, `${baseName}.png`);

  [atlasRelative, textureRelative].forEach((relativePath) => {
    if (!fs.existsSync(path.join(fontsDir, relativePath))) {
      throw new Error(`expected baked output missing: fonts/${relativePath}`);
    }
  });

  return { atlas: atlasRelative, texture: textureRelative };
}

function findPreviewPath(fontsDir, familyDirName, name) {
  const previewRelative = path.join(familyDirName, `${name.replace(/ /g, '-')}.svg`);

  return fs.existsSync(path.join(fontsDir, previewRelative)) ? previewRelative : undefined;
}

function buildManifest(fontsDir, variantDirs) {
  const entriesByName = new Map();

  variantDirs.forEach(({ familyDirName, variantDirName }) => {
    const { family, weight, italic } = parseVariantDirName(variantDirName);
    const name = italic ? `${family} Italic` : family;
    const { atlas, texture } = resolveOutputPaths(fontsDir, familyDirName, variantDirName);

    if (!entriesByName.has(name)) {
      entriesByName.set(name, { familyDirName, weightsByValue: new Map() });
    }

    entriesByName.get(name).weightsByValue.set(weight, { weight, atlas, texture });
  });

  return Array.from(entriesByName.entries())
    .map(([name, { familyDirName, weightsByValue }]) => {
      const preview = findPreviewPath(fontsDir, familyDirName, name);

      return {
        name,
        ...(preview ? { preview } : {}),
        weights: Array.from(weightsByValue.values()).sort((a, b) => a.weight - b.weight),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const variantDirs = findVariantDirs(FONTS_DIR);
  const manifest = buildManifest(FONTS_DIR, variantDirs);

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${manifest.length} font group(s) to ${MANIFEST_PATH}`);
}

main();
