/**
 * Shared "find and download a family's source variable-font TTF from google/fonts, with a local
 * disk cache" logic — used by both scripts/serve.mjs (bake-on-miss) and
 * scripts/generate_all_previews.mjs (batch preview generation), so the two don't drift.
 */

import fs from 'node:fs';
import path from 'node:path';

const GITHUB_CONTENTS_BASE = 'https://api.github.com/repos/google/fonts/contents';
const LICENSE_DIRS = ['ofl', 'apache', 'ufl'];

export function familySlug(family) {
  return family.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function listFamilyFiles(cacheDir, family) {
  const cachePath = path.join(cacheDir, 'index', `${familySlug(family)}.json`);

  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }

  for (const licenseDir of LICENSE_DIRS) {
    const url = `${GITHUB_CONTENTS_BASE}/${licenseDir}/${familySlug(family)}`;
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(url, { headers: { 'User-Agent': 'xigma-fonts-library' } });

    if (response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const files = await response.json();
      const result = { licenseDir, fileNames: files.map((file) => file.name) };

      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(result));

      return result;
    }
  }

  throw new Error(`"${family}" not found under ofl/apache/ufl in google/fonts`);
}

export function pickVariableFileName(fileNames, italic) {
  const variableFiles = fileNames.filter((name) => name.endsWith('.ttf') && name.includes('['));
  const italicFiles = variableFiles.filter((name) => /-italic\[/i.test(name));
  const romanFiles = variableFiles.filter((name) => !/-italic\[/i.test(name));

  return (italic ? italicFiles : romanFiles)[0];
}

export async function ensureSourceTtf(cacheDir, family, italic) {
  const { licenseDir, fileNames } = await listFamilyFiles(cacheDir, family);
  const fileName = pickVariableFileName(fileNames, italic);

  if (!fileName) {
    throw new Error(
      `"${family}"${italic ? ' Italic' : ''} has no variable-font file in google/fonts — ` +
        'static-only families are not supported by on-demand baking yet',
    );
  }

  const cachedPath = path.join(cacheDir, 'sources', familySlug(family), fileName);

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
