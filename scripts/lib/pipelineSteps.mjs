/**
 * The steps scripts/pipeline.mjs can run, each one an existing script (its path, from SCRIPTS) run as a
 * child process.
 * `parse` turns one line of that script's output into a progress update, so the pipeline UI can
 * draw a live progress bar without the scripts knowing anything about it. `args` are passed to the
 * script.
 *
 * Progress modes:
 * - `index`: the script logs `[i/N]` with its position in the whole list (skipped items are
 *   silent), so progress is the highest position seen.
 * - `count`: the script logs `[i/N]` only for items it actually processes (in any order, when
 *   concurrent), so progress is the number of lines seen on top of what was already there.
 */

import { SCRIPTS } from './repoPaths.mjs';

const PROGRESS_LINE = /^\[(\d+)\/(\d+)\] (FAILED|[a-z]+): (.+?)(?: — (.+))?$/;

function parseProgressLine(line) {
  const match = line.match(PROGRESS_LINE);

  if (match) {
    const [, index, total, status, label, message] = match;

    return { failed: status === 'FAILED', index: Number(index), label, message, total: Number(total) };
  }

  return null;
}

function parseDoneLine(line) {
  return line.startsWith('done: ') ? { summary: line.slice('done: '.length) } : null;
}

export const PIPELINE_STEPS = [
  {
    defaultSelected: false,
    hint: 'refresh the font list from Google Fonts',
    id: 'catalog',
    label: 'Font list',
    parse: (line) => {
      const match = line.match(/^wrote (\d+) catalog entries/);

      return match ? { summary: `${match[1]} fonts in the list` } : null;
    },
    script: SCRIPTS.fetchGoogleFontsCatalog,
  },
  {
    defaultSelected: true,
    hint: 'every source TTF into .cache/css-instances/',
    id: 'download',
    label: 'Download TTFs',
    mode: 'count',
    parse: (line) => {
      const header = line.match(/^(\d+) \(family, weight, style\) combinations, (\d+) already cached/);

      if (header) {
        return { alreadyDone: Number(header[2]), total: Number(header[1]) };
      }

      return parseProgressLine(line) ?? parseDoneLine(line);
    },
    script: SCRIPTS.downloadAllFonts,
  },
  {
    args: ['--without-small-caps'],
    defaultSelected: true,
    hint: 'every MSDF atlas into fonts/',
    id: 'bake',
    label: 'Bake atlases',
    mode: 'index',
    parse: (line) => {
      const header = line.match(/^(\d+) \(family, weight, style\) combinations to bake/);

      if (header) {
        return { total: Number(header[1]) };
      }

      return parseProgressLine(line) ?? parseDoneLine(line);
    },
    script: SCRIPTS.bakeAllFonts,
  },
  {
    defaultSelected: true,
    hint: 'atlases of fonts with small caps, from their full google/fonts source',
    id: 'smallCaps',
    label: 'Small caps',
    mode: 'index',
    parse: (line) => {
      const header = line.match(/^(\d+) font group\(s\) to check for small caps/);

      if (header) {
        return { total: Number(header[1]) };
      }

      return parseProgressLine(line) ?? parseDoneLine(line);
    },
    script: SCRIPTS.bakeSmallCaps,
  },
  {
    defaultSelected: false,
    hint: 'picker preview SVG for every font',
    id: 'previews',
    label: 'Preview SVGs',
    mode: 'index',
    parse: (line) => parseProgressLine(line) ?? parseDoneLine(line),
    script: SCRIPTS.generateAllPreviews,
  },
  {
    defaultSelected: true,
    hint: 'fonts/manifest.json with what is actually baked',
    id: 'manifest',
    label: 'Manifest',
    parse: (line) => {
      const match = line.match(/^wrote (\d+) font group\(s\) .*\((\d+) with at least one baked weight\)/);

      return match ? { summary: `${match[1]} fonts, ${match[2]} baked` } : null;
    },
    script: SCRIPTS.generateManifest,
  },
];
