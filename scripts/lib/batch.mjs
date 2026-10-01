/**
 * The loop every catalog-wide batch script shares: one item at a time, one failing item never aborts the
 * run, and the log lines scripts/lib/pipelineSteps.mjs parses its progress from — `[i/N] <result>: <label>`
 * for an item processed, `[i/N] FAILED: <label> — <message>` for a failure and a closing `done: ...`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CACHE_DIR } from './repoPaths.mjs';

/**
 * Runs `run(item)` for every item in order. `run` returns the item's result (e.g. 'baked', 'skipped'),
 * counted in `counts`; only the results in `logged` get a progress line, so skipped items stay silent.
 */
export async function runBatch(items, { getLabel, logged, run }) {
  const counts = {};
  const failures = [];

  for (const [index, item] of items.entries()) {
    const position = `[${index + 1}/${items.length}]`;

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await run(item);

      counts[result] = (counts[result] ?? 0) + 1;

      if (logged.includes(result)) {
        console.log(`${position} ${result}: ${getLabel(item)}`);
      }
    } catch (error) {
      failures.push({ label: getLabel(item), message: error.message });
      console.error(`${position} FAILED: ${getLabel(item)} — ${error.message}`);
    }
  }

  return { counts, failures };
}

/** Writes what a batch run could not process to .cache/<fileName> and says where; nothing when the list is empty. */
export function reportFailures(fileName, failures) {
  if (failures.length === 0) {
    return;
  }

  const failuresPath = path.join(CACHE_DIR, fileName);

  fs.mkdirSync(path.dirname(failuresPath), { recursive: true });
  fs.writeFileSync(failuresPath, `${JSON.stringify(failures, null, 2)}\n`);
  console.log(`failure details: ${failuresPath}`);
}
