import fs from 'node:fs';
import path from 'node:path';

import { CACHE_DIR } from './repoPaths.mjs';
import { getVariantTtfPath } from './variants.mjs';

/** Where scripts/lib/googleFontsCss.mjs caches the TTF Google instanced for a variant. */
export function getInstancedTtfPath(family, variant) {
  return path.join(CACHE_DIR, 'css-instances', family, `${variant}.ttf`);
}

/**
 * Where a baked variant's static source TTF lives on disk: `fonts/<Family>/<variant>/source/` when the
 * variant was baked through scripts/atlas/bake_font.sh (serve.mjs, manual bakes), otherwise
 * `.cache/css-instances/<Family>/` when it came from scripts/atlas/bake_all_fonts.mjs, which bakes straight
 * from Google's pre-instanced TTFs without copying them into fonts/. Returns null when neither exists.
 */
export function resolveVariantTtf(family, variant) {
  const candidates = [getVariantTtfPath(family, variant), getInstancedTtfPath(family, variant)];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}
