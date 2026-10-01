/**
 * Shared "find and download a family's source variable-font TTF from google/fonts, with a local
 * disk cache" logic — used by scripts/serve.mjs (bake-on-miss), scripts/previews/generate_all_previews.mjs
 * (batch preview generation) and scripts/atlas/bake_small_caps.mjs, so they don't drift.
 *
 * The file listing of every family comes from the google/fonts git trees (one request per license
 * folder, cached per family in .cache/index/), so going through the whole catalog stays well under
 * GitHub's 60 unauthenticated API requests an hour. GITHUB_TOKEN (optional, from the environment or
 * the repo's .env, see .env.example) is sent along when set.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CACHE_DIR, REPO_ROOT } from './repoPaths.mjs';

const ENV_PATH = path.join(REPO_ROOT, '.env');

if (fs.existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

const GITHUB_API_BASE = 'https://api.github.com/repos/google/fonts';
const LICENSE_DIRS = ['ofl', 'apache', 'ufl'];
const INDEX_COMPLETE_MARKER = '.complete';
const GITHUB_HEADERS = {
  'User-Agent': 'xigma-fonts-library',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

export function familySlug(family) {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchGithubJson(url) {
  const response = await fetch(url, { headers: GITHUB_HEADERS });

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }

  return response.json();
}

async function buildFamilyIndex(indexDir) {
  const root = await fetchGithubJson(`${GITHUB_API_BASE}/git/trees/main`);

  fs.mkdirSync(indexDir, { recursive: true });

  for (const licenseDir of LICENSE_DIRS) {
    const { sha } = root.tree.find((entry) => entry.path === licenseDir);
    // eslint-disable-next-line no-await-in-loop
    const { tree, truncated } = await fetchGithubJson(`${GITHUB_API_BASE}/git/trees/${sha}?recursive=1`);

    if (truncated) {
      throw new Error(`the google/fonts ${licenseDir} tree came back truncated`);
    }

    const families = new Map();

    tree
      .filter((entry) => entry.type === 'blob' && entry.path.split('/').length === 2)
      .forEach((entry) => {
        const [slug, fileName] = entry.path.split('/');

        families.set(slug, [...(families.get(slug) ?? []), fileName]);
      });

    families.forEach((fileNames, slug) => {
      const cachePath = path.join(indexDir, `${slug}.json`);

      if (!fs.existsSync(cachePath)) {
        fs.writeFileSync(cachePath, JSON.stringify({ licenseDir, fileNames }));
      }
    });
  }

  fs.writeFileSync(path.join(indexDir, INDEX_COMPLETE_MARKER), '');
}

export async function listFamilyFiles(family) {
  const indexDir = path.join(CACHE_DIR, 'index');
  const cachePath = path.join(indexDir, `${familySlug(family)}.json`);

  if (!fs.existsSync(cachePath) && !fs.existsSync(path.join(indexDir, INDEX_COMPLETE_MARKER))) {
    await buildFamilyIndex(indexDir);
  }

  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }

  throw new Error(`"${family}" not found under ofl/apache/ufl in google/fonts`);
}

export function pickVariableFileName(fileNames, italic) {
  const variableFiles = fileNames.filter((name) => name.endsWith('.ttf') && name.includes('['));
  const italicFiles = variableFiles.filter((name) => /-italic\[/i.test(name));
  const romanFiles = variableFiles.filter((name) => !/-italic\[/i.test(name));

  return (italic ? italicFiles : romanFiles)[0];
}

const STATIC_STYLE_NAMES = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

export function pickStaticFileName(fileNames, weight, italic) {
  const style = STATIC_STYLE_NAMES[weight];
  const suffix = italic ? `${weight === 400 ? '' : style}Italic` : style;

  return fileNames.find((name) => name.endsWith(`-${suffix}.ttf`));
}

async function ensureFamilyFile(family, licenseDir, fileName) {
  const cachedPath = path.join(CACHE_DIR, 'sources', familySlug(family), fileName);

  if (!fs.existsSync(cachedPath)) {
    const url = `https://raw.githubusercontent.com/google/fonts/main/${licenseDir}/${familySlug(family)}/${encodeURIComponent(fileName)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`failed to download ${url}: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    fs.mkdirSync(path.dirname(cachedPath), { recursive: true });
    fs.writeFileSync(cachedPath, buffer);
  }

  return cachedPath;
}

export async function ensureSourceTtf(family, italic) {
  const { licenseDir, fileNames } = await listFamilyFiles(family);
  const fileName = pickVariableFileName(fileNames, italic);

  if (!fileName) {
    throw new Error(
      `"${family}"${italic ? ' Italic' : ''} has no variable-font file in google/fonts — ` +
        'static-only families are not supported by on-demand baking yet',
    );
  }

  return ensureFamilyFile(family, licenseDir, fileName);
}

/**
 * The full source TTF of one (family, weight, style): the family's variable font when it has one,
 * otherwise its static file for that weight (`<Family>-Bold.ttf`, `<Family>-LightItalic.ttf`...).
 * Returns null when google/fonts has neither.
 */
export async function ensureWeightSourceTtf(family, weight, italic) {
  const { licenseDir, fileNames } = await listFamilyFiles(family);
  const fileName = pickVariableFileName(fileNames, italic) ?? pickStaticFileName(fileNames, weight, italic);

  return fileName ? ensureFamilyFile(family, licenseDir, fileName) : null;
}
