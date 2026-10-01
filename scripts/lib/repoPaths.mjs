/**
 * Paths every script resolves against the repo root — from this file's own location, not
 * process.cwd(), since bake_font.sh and the pipeline UI run scripts from anywhere.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
export const FONTS_DIR = path.join(REPO_ROOT, 'fonts');
export const CACHE_DIR = path.join(REPO_ROOT, '.cache');
export const DIST_DIR = path.join(REPO_ROOT, 'dist');
export const CATALOG_PATH = path.join(REPO_ROOT, 'data', 'google-fonts-catalog.json');
export const SMALL_CAPS_PATH = path.join(REPO_ROOT, 'data', 'small-caps.json');
export const FULL_GLYPHS_PATH = path.join(REPO_ROOT, 'data', 'full-glyphs.json');
export const MANIFEST_PATH = path.join(FONTS_DIR, 'manifest.json');
export const DEFAULT_CHARSET_PATH = path.join(FONTS_DIR, 'Inter', 'Inter-400', 'charset.txt');

/**
 * Every script another script runs as a child process. scripts/ is grouped by what a script works on:
 * catalog/ (the font list, its source TTFs, the manifest), atlas/ (MSDF atlases and the TTFs they are
 * baked from) and previews/ (picker preview SVGs).
 */
export const SCRIPTS = {
  bakeAllFonts: path.join(SCRIPTS_DIR, 'atlas', 'bake_all_fonts.mjs'),
  bakeAtlas: path.join(SCRIPTS_DIR, 'atlas', 'bake_atlas.cjs'),
  bakeFont: path.join(SCRIPTS_DIR, 'atlas', 'bake_font.sh'),
  bakeGlyphBlock: path.join(SCRIPTS_DIR, 'atlas', 'bake_glyph_block.cjs'),
  bakeSmallCaps: path.join(SCRIPTS_DIR, 'atlas', 'bake_small_caps.mjs'),
  buildFullGlyphTtf: path.join(SCRIPTS_DIR, 'atlas', 'build_full_glyph_ttf.py'),
  buildSmallCapsTtf: path.join(SCRIPTS_DIR, 'atlas', 'build_small_caps_ttf.py'),
  downloadAllFonts: path.join(SCRIPTS_DIR, 'catalog', 'download_all_fonts.mjs'),
  fetchGoogleFontsCatalog: path.join(SCRIPTS_DIR, 'catalog', 'fetch_google_fonts_catalog.mjs'),
  freezeVariableFont: path.join(SCRIPTS_DIR, 'atlas', 'freeze_variable_font.py'),
  generateAllPreviews: path.join(SCRIPTS_DIR, 'previews', 'generate_all_previews.mjs'),
  generateManifest: path.join(SCRIPTS_DIR, 'catalog', 'generate_manifest.mjs'),
  generatePreviewSvg: path.join(SCRIPTS_DIR, 'previews', 'generate_preview_svg.py'),
  generatePreviewsBundle: path.join(SCRIPTS_DIR, 'previews', 'generate_previews_bundle.py'),
};
