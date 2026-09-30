import fs from 'node:fs';

import { CATALOG_PATH } from './repoPaths.mjs';

/** data/google-fonts-catalog.json — every family Google Fonts offers, with its weights (plain numbers). */
export function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`${CATALOG_PATH} not found — run scripts/fetch_google_fonts_catalog.mjs first`);
  }

  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

/** A data/*.json list of family names (small-caps.json, full-glyphs.json) as a Set, empty while the file is missing. */
export function loadFamilySet(listPath) {
  return new Set(fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, 'utf8')) : []);
}
