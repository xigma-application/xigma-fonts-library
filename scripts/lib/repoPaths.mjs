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

export function getScriptPath(name) {
  return path.join(SCRIPTS_DIR, name);
}
