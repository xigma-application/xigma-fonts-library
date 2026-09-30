import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CHARSET_PATH } from './repoPaths.mjs';

/** The baking unit's name, also its directory under fonts/<Family>/: `<family>-<weight>[-Italic]`. */
export function getVariantName(family, weight, italic) {
  return `${family}-${weight}${italic ? '-Italic' : ''}`;
}

/** Gives a variant directory Inter's charset.txt unless it already has its own; returns the charset path. */
export function ensureCharset(variantDir) {
  const charsetPath = path.join(variantDir, 'charset.txt');

  if (!fs.existsSync(charsetPath)) {
    fs.mkdirSync(variantDir, { recursive: true });
    fs.copyFileSync(DEFAULT_CHARSET_PATH, charsetPath);
  }

  return charsetPath;
}
