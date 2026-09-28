#!/usr/bin/env node
/**
 * Writes fonts/manifest.json from data/google-fonts-catalog.json (the full "what could we offer"
 * list — 2292 entries, fetched via scripts/fetch_google_fonts_catalog.mjs).
 *
 * Every weight gets `atlas`/`texture`/`font` paths, always — computed from this repo's own
 * naming convention (`fonts/<Family>/<Family>-<weight>[-Italic]/...`), the same convention
 * `scripts/bake_font.sh` writes to. These are deterministic, not conditional: a consumer always
 * knows the URL/path a font *would* live at, whether or not it's been baked in this checkout yet
 * — no branching on "does this entry have an atlas field." `font` is the variant's static TTF,
 * which a consumer needs for real vector outlines (flatten, booleans, SVG/PDF export) since an MSDF
 * atlas holds none. Each weight also carries `baked: bool`,
 * set by actually checking the file exists on disk right now, so a consumer can tell a guaranteed
 * hit from a path that needs baking-on-demand first (see README's "bake once, cache on CDN forever"
 * discussion) without doing a network round-trip just to find out. `preview` is the one exception:
 * preview SVGs are committed for the whole catalog, so a missing file means the font has no glyphs to
 * write its own name with (Khmer, Myanmar, emoji...), not that it still needs baking — it is null then,
 * and a picker shows the name in its own UI font instead. `smallCaps` is true for a weight whose atlas
 * scripts/bake_small_caps.mjs baked with the font's small caps (listed in data/small-caps.json).
 * `features` is the path of the OpenType feature data of a weight scripts/bake_full_glyphs.mjs baked with
 * every glyph of its font (listed in data/full-glyphs.json), null for the others.
 *
 * This is the "manifest/katalog dostępnych fontów" from xigma-app/docs/ROADMAP.md Etap 9 — what a
 * font picker in xigma-app's text-properties panel would fetch to know what's offerable.
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
const CATALOG_PATH = path.join(REPO_ROOT, 'data', 'google-fonts-catalog.json');
const MANIFEST_PATH = path.join(FONTS_DIR, 'manifest.json');
const SMALL_CAPS_PATH = path.join(REPO_ROOT, 'data', 'small-caps.json');
const FULL_GLYPHS_PATH = path.join(REPO_ROOT, 'data', 'full-glyphs.json');

// Explicit locale + base sensitivity: case and accents don't affect ordering, and it's
// deterministic regardless of the runtime's default ICU locale, unlike a bare a.localeCompare(b).
const alphabetically = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`${CATALOG_PATH} not found — run scripts/fetch_google_fonts_catalog.mjs first`);
  }

  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

// Paths in the manifest are rooted at "fonts/", not at fonts/manifest.json's own directory — a
// consumer resolves them against the repo (or wherever fonts/ was published), not against wherever
// the manifest file itself happens to live.
function toManifestPath(...segments) {
  return path.join('fonts', ...segments);
}

// Mirrors the exact convention scripts/bake_font.sh writes to: variant dir name is
// `<family>-<weight>[-Italic]`, its outputs are `<variant>-msdf.{json,png}` inside it.
function variantDirName(family, weight, italic) {
  return `${family}-${weight}${italic ? '-Italic' : ''}`;
}

function loadSmallCaps() {
  return new Set(fs.existsSync(SMALL_CAPS_PATH) ? JSON.parse(fs.readFileSync(SMALL_CAPS_PATH, 'utf8')) : []);
}

function loadFullGlyphs() {
  return new Set(fs.existsSync(FULL_GLYPHS_PATH) ? JSON.parse(fs.readFileSync(FULL_GLYPHS_PATH, 'utf8')) : []);
}

function resolveWeightPaths(family, weight, italic, smallCaps, fullGlyphs) {
  const variant = variantDirName(family, weight, italic);
  const baseName = `${variant}-msdf`;

  const atlas = toManifestPath(family, variant, `${baseName}.json`);
  const texture = toManifestPath(family, variant, `${baseName}.png`);
  const font = toManifestPath(family, variant, 'source', `${variant}.ttf`);
  const baked =
    fs.existsSync(path.join(FONTS_DIR, family, variant, `${baseName}.json`)) &&
    fs.existsSync(path.join(FONTS_DIR, family, variant, `${baseName}.png`));

  const features = baked && fullGlyphs.has(variant) ? toManifestPath(family, variant, `${variant}-features.json`) : null;

  return { weight, atlas, texture, font, baked, smallCaps: baked && smallCaps.has(variant), features };
}

// Matches scripts/generate_all_previews.mjs and scripts/serve.mjs's bakePreview: the file is
// named after `name` verbatim (spaces and all), not dash-replaced.
function resolvePreviewPath(family, name) {
  return fs.existsSync(path.join(FONTS_DIR, family, `${name}.svg`)) ? toManifestPath(family, `${name}.svg`) : null;
}

function buildManifest(catalog) {
  const smallCaps = loadSmallCaps();
  const fullGlyphs = loadFullGlyphs();

  return catalog
    .map(({ name, family, italic, weights }) => ({
      name,
      preview: resolvePreviewPath(family, name),
      weights: weights.map((weight) => resolveWeightPaths(family, weight, italic, smallCaps, fullGlyphs)),
    }))
    .sort((a, b) => alphabetically(a.name, b.name));
}

function main() {
  const catalog = loadCatalog();
  const manifest = buildManifest(catalog);
  const bakedCount = manifest.filter((entry) => entry.weights.some((w) => w.baked)).length;

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${manifest.length} font group(s) to ${MANIFEST_PATH} (${bakedCount} with at least one baked weight)`);
}

main();
