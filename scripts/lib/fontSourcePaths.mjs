import fs from 'node:fs';
import path from 'node:path';

/**
 * Where a baked variant's static source TTF lives on disk: `fonts/<Family>/<variant>/source/` when the
 * variant was baked through scripts/bake_font.sh (serve.mjs, manual bakes), otherwise
 * `.cache/css-instances/<Family>/` when it came from scripts/bake_all_fonts.mjs, which bakes straight
 * from Google's pre-instanced TTFs without copying them into fonts/. Returns null when neither exists.
 */
export function resolveVariantTtf(fontsDir, cacheDir, family, variant) {
  const candidates = [
    path.join(fontsDir, family, variant, 'source', `${variant}.ttf`),
    path.join(cacheDir, 'css-instances', family, `${variant}.ttf`),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}
