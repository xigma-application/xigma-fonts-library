import fs from 'node:fs';

import { CATALOG_PATH } from './repoPaths.mjs';

/** data/google-fonts-catalog.json — every family Google Fonts offers, with its weights (plain numbers). */
export function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`${CATALOG_PATH} not found — run scripts/catalog/fetch_google_fonts_catalog.mjs first`);
  }

  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

/** A data/*.json list of family names (small-caps.json, full-glyphs.json) as a Set, empty while the file is missing. */
export function loadFamilySet(listPath) {
  return new Set(fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, 'utf8')) : []);
}

/** Every (family, weight, style) of the catalog, one per baking unit; `label` is what a script logs it as. */
export function listCatalogVariants(catalog) {
  return catalog.flatMap((entry) =>
    entry.weights.map((weight) => ({ family: entry.family, weight, italic: entry.italic, label: `${entry.name} ${weight}` })),
  );
}

/** Every `--family <name>` of a script's argv. */
export function parseFamilyArgs(argv) {
  return argv.flatMap((arg, index) => (arg === '--family' && argv[index + 1] ? [argv[index + 1]] : []));
}
