#!/usr/bin/env node
/**
 * Assembles dist/ — a static, upload-ready copy of everything a consumer (xigma-app) fetches from
 * the font host (PROD_URLS['xigma-fonts-library'] in @xigma/utils, https://fonts.xigma.app):
 *
 *   dist/_headers                                                  — CORS + cache rules (Cloudflare Pages / Netlify syntax)
 *   dist/fonts/manifest.json                                       — only fonts with at least one baked weight
 *   dist/fonts/<Family>/<name>.svg                                 — picker previews
 *   dist/fonts/<Family>/<variant>/<variant>-msdf.json|png          — MSDF atlas + texture
 *   dist/fonts/<Family>/<variant>/source/<variant>.ttf             — static TTF for vector outlines
 *
 * Paths are exactly the ones fonts/manifest.json and scripts/serve.mjs use, so a consumer resolves
 * the same `fonts/...` paths against localhost:7720 in development and against the host in
 * production. Files are hard-linked (falling back to a copy across filesystems), so building dist/
 * costs no extra disk space next to the ~2.6 GB fonts/. dist/ is rebuilt from scratch every run.
 *
 * Usage:
 *   node scripts/build_deploy.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveVariantTtf } from './lib/fontSourcePaths.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONTS_DIR = path.join(REPO_ROOT, 'fonts');
const CACHE_DIR = path.join(REPO_ROOT, '.cache');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const MANIFEST_PATH = path.join(FONTS_DIR, 'manifest.json');

const HEADERS = `/fonts/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400

/fonts/manifest.json
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400
`;

function linkFile(source, manifestPath) {
  const target = path.join(DIST_DIR, manifestPath);

  fs.mkdirSync(path.dirname(target), { recursive: true });

  try {
    fs.linkSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
  }
}

function deployWeight(weight) {
  const [, family, variant] = weight.atlas.split(path.sep);
  const ttf = resolveVariantTtf(FONTS_DIR, CACHE_DIR, family, variant);

  linkFile(path.join(REPO_ROOT, weight.atlas), weight.atlas);
  linkFile(path.join(REPO_ROOT, weight.texture), weight.texture);

  if (ttf) {
    linkFile(ttf, weight.font);
  }

  return { atlas: weight.atlas, baked: true, font: ttf ? weight.font : null, texture: weight.texture, weight: weight.weight };
}

function deployEntry(entry) {
  const previewSource = path.join(REPO_ROOT, entry.preview);
  const hasPreview = fs.existsSync(previewSource);

  if (hasPreview) {
    linkFile(previewSource, entry.preview);
  }

  return {
    name: entry.name,
    preview: hasPreview ? entry.preview : null,
    weights: entry.weights.filter((weight) => weight.baked).map(deployWeight),
  };
}

function main() {
  execFileSync('node', [path.join(REPO_ROOT, 'scripts', 'generate_manifest.mjs')], { stdio: 'inherit' });
  fs.rmSync(DIST_DIR, { force: true, recursive: true });
  fs.mkdirSync(path.join(DIST_DIR, 'fonts'), { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const deployed = manifest.filter((entry) => entry.weights.some((weight) => weight.baked)).map(deployEntry);
  const weightCount = deployed.reduce((count, entry) => count + entry.weights.length, 0);
  const missingFonts = deployed.reduce((count, entry) => count + entry.weights.filter((weight) => !weight.font).length, 0);

  fs.writeFileSync(path.join(DIST_DIR, 'fonts', 'manifest.json'), `${JSON.stringify(deployed)}\n`);
  fs.writeFileSync(path.join(DIST_DIR, '_headers'), HEADERS);
  console.log(`dist/: ${deployed.length} font group(s), ${weightCount} weight(s), ${missingFonts} without a source TTF`);
}

main();
