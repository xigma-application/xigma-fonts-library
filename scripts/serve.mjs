#!/usr/bin/env node
/**
 * Local dev server: serves fonts/ as static files, and bakes on demand for anything from
 * data/google-fonts-catalog.json that isn't baked yet — "if it's not there, bake it; if it is,
 * serve it immediately." No CDN, no queue, no locking: this is a single local process for one
 * developer, requests are handled one at a time, so there's nothing to deduplicate.
 *
 * Routes:
 *   GET /fonts/manifest.json                                          — regenerated fresh each request
 *   GET /fonts/<Family>/<Family>-<weight>[-Italic]/<...>-msdf.json|png — atlas/texture, baked on miss
 *   GET /fonts/<Family>/<Family>[-Italic].svg                         — preview, baked on miss
 *   GET /fonts/<Family>/<variant>/source/<variant>.ttf                — static TTF, from fonts/ or .cache/css-instances/
 *   GET /fonts/<Family>/<variant>/glyphs/<variant>-glyphs-uXXXX-msdf.json|png
 *                                                                     — Unicode glyph block, baked on miss from the static TTF
 *                                                                       (scripts/lib/glyphBlocks.cjs); 404 for the texture of a
 *                                                                       block the font has no character in
 *
 * Baking on demand needs the family's source variable-font TTF, which isn't in this repo — it's
 * downloaded from google/fonts on first request per family and cached under .cache/ (gitignored),
 * so a second weight of an already-seen family doesn't re-download it. Only variable-font families
 * are supported this way; a family that ships only static per-weight files (no `[...]` variable
 * font) fails with a clear error rather than silently 404ing.
 *
 * Usage:
 *   node scripts/serve.mjs [port]   # default: DEV_PORTS['xigma-fonts-library'] from @xigma/utils (7720)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

import { DEV_PORTS } from '@xigma/utils';

import glyphBlocks from './lib/glyphBlocks.cjs';
import { resolveVariantTtf } from './lib/fontSourcePaths.mjs';
import { ensureSourceTtf } from './lib/googleFontsSource.mjs';
import { CACHE_DIR, FONTS_DIR, getScriptPath } from './lib/repoPaths.mjs';
import { loadCatalog } from './lib/catalog.mjs';
import { ensureCharset, getVariantName } from './lib/variants.mjs';

const DEFAULT_OPSZ = 14; // matches xigma-app's own pin, see README

const ATLAS_PATH_PATTERN = /^([^/]+)\/([^/]+)-(\d{1,4})(-Italic)?\/\2-\3\4-msdf\.(json|png)$/;
// Preview filenames are named after the display name verbatim ("Inter Italic.svg", space —
// matching scripts/generate_all_previews.mjs), not the dash convention atlas variant dirs use.
const PREVIEW_PATH_PATTERN = /^([^/]+)\/\1( Italic)?\.svg$/;
const SOURCE_TTF_PATH_PATTERN = /^([^/]+)\/([^/]+)\/source\/\2\.ttf$/;

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

const GZIP_EXTENSIONS = new Set(['.json', '.svg']);

async function bakeVariant(family, weight, italic) {
  const sourceTtf = await ensureSourceTtf(CACHE_DIR, family, italic);
  const variantDir = path.join(FONTS_DIR, family, getVariantName(family, weight, italic));

  ensureCharset(variantDir);

  execFileSync('bash', [getScriptPath('bake_font.sh'), variantDir, sourceTtf, `wght=${weight}`, `opsz=${DEFAULT_OPSZ}`], {
    stdio: 'inherit',
  });
}

function bakeGlyphBlock(family, variant, blockHex) {
  const ttf = resolveVariantTtf(FONTS_DIR, CACHE_DIR, family, variant);

  if (ttf) {
    execFileSync(
      'node',
      [
        getScriptPath('bake_glyph_block.cjs'),
        '--font',
        ttf,
        '--block',
        blockHex,
        '--out-dir',
        glyphBlocks.getGlyphBlockDir(FONTS_DIR, family, variant),
        '--name',
        variant,
      ],
      { stdio: 'inherit' },
    );
  }

  return Boolean(ttf);
}

async function bakePreview(family, italic, name) {
  // Reuses whichever weight/style static TTF is already on disk for this family+style; freezes a
  // fresh Regular/400 instance only if none exists yet (cheaper than requiring a full atlas bake
  // just to get a preview).
  const styleSuffix = italic ? '-Italic' : '';
  const familyDir = path.join(FONTS_DIR, family);
  const existingVariantDir = fs.existsSync(familyDir)
    ? fs
        .readdirSync(familyDir, { withFileTypes: true })
        .find((entry) => entry.isDirectory() && entry.name.endsWith(styleSuffix) && (italic || !entry.name.includes('-Italic')))
    : undefined;

  let staticTtf;

  if (existingVariantDir) {
    staticTtf = path.join(FONTS_DIR, family, existingVariantDir.name, 'source', `${existingVariantDir.name}.ttf`);
  } else {
    const sourceTtf = await ensureSourceTtf(CACHE_DIR, family, italic);
    const variantName = `${family}-400${styleSuffix}`;
    staticTtf = path.join(CACHE_DIR, 'preview-instances', `${variantName}.ttf`);

    if (!fs.existsSync(staticTtf)) {
      fs.mkdirSync(path.dirname(staticTtf), { recursive: true });
      execFileSync('python3', [getScriptPath('freeze_variable_font.py'), sourceTtf, staticTtf, 'wght=400', `opsz=${DEFAULT_OPSZ}`]);
    }
  }

  const outputPath = path.join(FONTS_DIR, family, `${name}.svg`);

  execFileSync('python3', [getScriptPath('generate_preview_svg.py'), staticTtf, name, outputPath]);
}

function sendFile(req, res, filePath) {
  const extension = path.extname(filePath);
  const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';
  const gzip = GZIP_EXTENSIONS.has(extension) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': contentType, Vary: 'Accept-Encoding' };

  if (gzip) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  }
}

function sendError(res, status, message) {
  console.error(`error: ${message}`);
  res.writeHead(status, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(message);
}

function findCatalogEntry(catalog, family, italic) {
  const name = italic ? `${family} Italic` : family;

  return catalog.find((entry) => entry.name === name);
}

async function handleFontsRequest(req, res, relativePath) {
  const filePath = path.join(FONTS_DIR, relativePath);

  if (fs.existsSync(filePath)) {
    sendFile(req, res, filePath);
    return;
  }

  const glyphBlockMatch = relativePath.match(glyphBlocks.GLYPH_BLOCK_PATH_PATTERN);

  if (glyphBlockMatch) {
    const [, family, variant, blockHex] = glyphBlockMatch;
    const blockJson = path.join(glyphBlocks.getGlyphBlockDir(FONTS_DIR, family, variant), `${variant}-glyphs-u${blockHex}-msdf.json`);

    if (!fs.existsSync(blockJson) && !bakeGlyphBlock(family, variant, blockHex)) {
      sendError(res, 404, `no source TTF for ${family}/${variant}`);
      return;
    }

    if (fs.existsSync(filePath)) {
      sendFile(req, res, filePath);
    } else {
      sendError(res, 404, `no glyphs in block: fonts/${relativePath}`);
    }

    return;
  }

  const catalog = loadCatalog();

  const atlasMatch = relativePath.match(ATLAS_PATH_PATTERN);

  if (atlasMatch) {
    const [, family, , weightText, italicSuffix] = atlasMatch;
    const weight = Number(weightText);
    const entry = findCatalogEntry(catalog, family, Boolean(italicSuffix));

    // catalog weights are plain numbers (data/google-fonts-catalog.json), unlike
    // fonts/manifest.json's {weight, atlas, texture, baked} objects — don't confuse the two.
    if (!entry || !entry.weights.includes(weight)) {
      sendError(res, 404, `not in catalog: ${family}${italicSuffix ? ' Italic' : ''} weight ${weight}`);
      return;
    }

    await bakeVariant(family, weight, Boolean(italicSuffix));
    sendFile(req, res, filePath);
    return;
  }

  const previewMatch = relativePath.match(PREVIEW_PATH_PATTERN);

  if (previewMatch) {
    const [, family, italicSuffix] = previewMatch;
    const entry = findCatalogEntry(catalog, family, Boolean(italicSuffix));

    if (!entry) {
      sendError(res, 404, `not in catalog: ${family}${italicSuffix ? ' Italic' : ''}`);
      return;
    }

    await bakePreview(family, Boolean(italicSuffix), entry.name);
    sendFile(req, res, filePath);
    return;
  }

  const sourceMatch = relativePath.match(SOURCE_TTF_PATH_PATTERN);
  const sourceTtf = sourceMatch && resolveVariantTtf(FONTS_DIR, CACHE_DIR, sourceMatch[1], sourceMatch[2]);

  if (sourceTtf) {
    sendFile(req, res, sourceTtf);
    return;
  }

  sendError(res, 404, `not found: fonts/${relativePath}`);
}

function regenerateManifest() {
  execFileSync('node', [getScriptPath('generate_manifest.mjs')], { stdio: 'inherit' });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    // URL#pathname keeps percent-encoding as-is (WHATWG URL doesn't auto-decode it) — family
    // names with spaces ("Abhaya Libre") arrive as "%20" and must be decoded before use.
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/fonts/manifest.json') {
      regenerateManifest();
      sendFile(req, res, path.join(FONTS_DIR, 'manifest.json'));
      return;
    }

    if (pathname.startsWith('/fonts/')) {
      await handleFontsRequest(req, res, pathname.slice('/fonts/'.length));
      return;
    }

    sendError(res, 404, `not found: ${pathname}`);
  } catch (error) {
    sendError(res, 500, error.message);
  }
}

function main() {
  const port = Number(process.argv[2]) || DEV_PORTS['xigma-fonts-library'];

  http
    .createServer((req, res) => {
      handleRequest(req, res);
    })
    .listen(port, () => {
      console.log(`xigma-fonts-library dev server on http://localhost:${port}`);
      console.log(`  manifest: http://localhost:${port}/fonts/manifest.json`);
    });
}

main();
