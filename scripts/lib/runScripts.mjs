/**
 * The child-process calls several scripts share, so the argument lists of scripts/atlas/bake_atlas.cjs
 * and scripts/atlas/bake_glyph_block.cjs live in one place.
 */

import { execFileSync } from 'node:child_process';

import { SCRIPTS } from './repoPaths.mjs';

/** Bakes `<outDir>/<variant>-msdf.json|png` from a static TTF; `textureSize` and `noKerning` are for a full-glyph bake. */
export function runBakeAtlas({ charset, font, noKerning = false, outDir, textureSize, variant }) {
  execFileSync('node', [
    SCRIPTS.bakeAtlas,
    '--font',
    font,
    '--charset',
    charset,
    '--out-dir',
    outDir,
    '--name',
    `${variant}-msdf`,
    ...(textureSize ? ['--texture-size', String(textureSize)] : []),
    ...(noKerning ? ['--no-kerning', 'true'] : []),
  ]);
}

/** Bakes one Unicode glyph block (its first code point in hex) of a variant into `outDir`. */
export function runBakeGlyphBlock({ blockHex, font, outDir, stdio, variant }) {
  execFileSync('node', [SCRIPTS.bakeGlyphBlock, '--font', font, '--block', blockHex, '--out-dir', outDir, '--name', variant], { stdio });
}

export function regenerateManifest() {
  execFileSync('node', [SCRIPTS.generateManifest], { stdio: 'inherit' });
}
