import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_CHARSET_PATH, FONTS_DIR } from './repoPaths.mjs';

/** The baking unit's name, also its directory under fonts/<Family>/: `<family>-<weight>[-Italic]`. */
export function getVariantName(family, weight, italic) {
  return `${family}-${weight}${italic ? '-Italic' : ''}`;
}

export function getVariantDir(family, variant) {
  return path.join(FONTS_DIR, family, variant);
}

/** The variant's static TTF in fonts/, which flattening and export outline. */
export function getVariantTtfPath(family, variant) {
  return path.join(getVariantDir(family, variant), 'source', `${variant}.ttf`);
}

/** Whether both the atlas and its texture are on disk. */
export function isAtlasBaked(family, variant) {
  const variantDir = getVariantDir(family, variant);

  return fs.existsSync(path.join(variantDir, `${variant}-msdf.json`)) && fs.existsSync(path.join(variantDir, `${variant}-msdf.png`));
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
