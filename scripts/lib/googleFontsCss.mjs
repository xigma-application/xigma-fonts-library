/**
 * Fetches a single, already-instanced static TTF for an exact (family, weight, style) from
 * Google's own CSS2 API + gstatic CDN — no GitHub, no rate limit, works for static-only families
 * too (unlike scripts/lib/googleFontsSource.mjs, which needs an actual variable font to freeze
 * an arbitrary weight from). Used by scripts/atlas/bake_all_fonts.mjs,
 * scripts/catalog/download_all_fonts.mjs and scripts/previews/generate_all_previews.mjs.
 *
 * Old/unrecognized browsers get served a plain .ttf; modern ones get .woff2 — an old-browser
 * User-Agent is the well-known trick for pulling a raw TTF straight out of Google's CSS API.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getInstancedTtfPath } from './fontSourcePaths.mjs';
import { getVariantName } from './variants.mjs';

const OLD_BROWSER_USER_AGENT = 'Mozilla/4.0';
const TTF_URL_PATTERN = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/;

async function fetchInstancedTtfUrl(family, weight, italic) {
  const spec = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${spec}&display=swap`;
  const response = await fetch(url, { headers: { 'User-Agent': OLD_BROWSER_USER_AGENT } });

  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }

  const css = await response.text();
  const match = css.match(TTF_URL_PATTERN);

  if (!match) {
    throw new Error(`no .ttf src in CSS for "${family}"${italic ? ' Italic' : ''} weight ${weight}`);
  }

  return match[1];
}

/** Downloads the instanced TTF to `cachedPath` unless it is already there; returns `cachedPath`. */
export async function ensureInstancedTtfAt(cachedPath, family, weight, italic) {
  if (!fs.existsSync(cachedPath)) {
    const ttfUrl = await fetchInstancedTtfUrl(family, weight, italic);
    const response = await fetch(ttfUrl);

    if (!response.ok) {
      throw new Error(`failed to download ${ttfUrl}: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    fs.mkdirSync(path.dirname(cachedPath), { recursive: true });
    fs.writeFileSync(cachedPath, buffer);
  }

  return cachedPath;
}

export function ensureInstancedTtf(family, weight, italic) {
  return ensureInstancedTtfAt(getInstancedTtfPath(family, getVariantName(family, weight, italic)), family, weight, italic);
}
