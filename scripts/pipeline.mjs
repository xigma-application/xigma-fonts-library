#!/usr/bin/env node
/**
 * Interactive terminal UI that runs the font pipeline steps (font list, TTF download, atlas
 * baking, preview SVGs, manifest) one after another, with spinners, live gradient progress bars,
 * counters and ETA parsed from each script's own output. Ctrl+C stops cleanly — every step is
 * resumable, so re-running picks up where it left off.
 *
 * macOS/Linux terminals only. Without a TTY (CI, pipes) it just runs the steps with plain output.
 *
 * Usage:
 *   node scripts/pipeline.mjs                         # pick the steps from a menu
 *   node scripts/pipeline.mjs --steps=download,bake   # skip the menu
 *   node scripts/pipeline.mjs --all                   # every step
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { cancel, intro, isCancel, multiselect, outro } from '@clack/prompts';

import { PIPELINE_STEPS } from './lib/pipelineSteps.mjs';
import {
  GRADIENT_FROM,
  GRADIENT_TO,
  SPINNER_FRAMES,
  createLiveArea,
  formatDuration,
  gradientText,
  padEnd,
  paint,
  progressBar,
} from './lib/terminalUi.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FRAME_MS = 80;
const LABEL_WIDTH = 15;
const BAR_WIDTH = 28;
const MAX_ERROR_LINES = 4;

function parseStepArgs(argv) {
  if (argv.includes('--all')) {
    return PIPELINE_STEPS.map((step) => step.id);
  }

  const stepsArg = argv.find((arg) => arg.startsWith('--steps='));

  if (stepsArg) {
    const ids = stepsArg.slice('--steps='.length).split(',');
    const unknown = ids.filter((id) => !PIPELINE_STEPS.some((step) => step.id === id));

    if (unknown.length > 0) {
      console.error(`unknown step(s): ${unknown.join(', ')} — available: ${PIPELINE_STEPS.map((step) => step.id).join(', ')}`);
      process.exit(1);
    }

    return ids;
  }

  return null;
}

async function pickSteps() {
  const selected = await multiselect({
    initialValues: PIPELINE_STEPS.filter((step) => step.defaultSelected).map((step) => step.id),
    message: 'What should run? (space to toggle, enter to start)',
    options: PIPELINE_STEPS.map((step) => ({ hint: step.hint, label: step.label, value: step.id })),
    required: true,
  });

  if (isCancel(selected)) {
    cancel('Nothing ran.');
    process.exit(0);
  }

  return selected;
}

function createStepState(step) {
  return {
    alreadyDone: 0,
    done: 0,
    endedAt: null,
    errorLines: [],
    failures: 0,
    lastLabel: null,
    processed: 0,
    startedAt: null,
    status: 'pending',
    step,
    summary: null,
    total: null,
  };
}

function applyUpdate(state, update) {
  if (update.total !== undefined && update.index === undefined) {
    state.total = update.total;
    state.alreadyDone = update.alreadyDone ?? 0;
    state.done = state.alreadyDone;
  }

  if (update.index !== undefined) {
    if (state.step.mode === 'index') {
      state.total = update.total;
    }

    state.lastLabel = update.failed ? `${update.label} ${paint.red('✖')}` : update.label;
    state.done = state.step.mode === 'count' ? state.done + 1 : Math.max(state.done, update.index);

    if (update.failed) {
      state.failures += 1;
    } else {
      state.processed += 1;
    }
  }

  if (update.summary !== undefined) {
    state.summary = update.summary;
  }
}

function getEta(state, now) {
  const progressed = state.done - state.alreadyDone;
  const elapsed = now - state.startedAt;

  if (progressed > 0 && elapsed > 1500 && state.total) {
    return formatDuration(((state.total - state.done) / progressed) * elapsed);
  }

  return '…';
}

function renderStep(state, tick, now) {
  const label = padEnd(state.step.label, LABEL_WIDTH);
  const took = state.startedAt ? paint.dim(formatDuration((state.endedAt ?? now) - state.startedAt)) : '';

  switch (state.status) {
    case 'pending':
      return [`  ${paint.dim('○')} ${paint.dim(label)} ${paint.dim('waiting')}`];
    case 'done':
      return [`  ${paint.green('✔')} ${label} ${state.summary ?? paint.dim('done')}  ${took}`];
    case 'failed':
      return [
        `  ${paint.red('✖')} ${label} ${paint.red('failed')}  ${took}`,
        ...state.errorLines.map((line) => `    ${paint.dim('│')} ${paint.red(line)}`),
      ];
    case 'stopped':
      return [`  ${paint.yellow('■')} ${label} ${paint.yellow('stopped')} ${paint.dim(`at ${state.done}/${state.total ?? '?'}`)}  ${took}`];
    case 'skipped':
      return [`  ${paint.dim('–')} ${paint.dim(label)} ${paint.dim('skipped')}`];
    default:
      return renderRunningStep(state, label, tick, now, took);
  }
}

function renderRunningStep(state, label, tick, now, took) {
  const spinnerColor = [...GRADIENT_FROM].map((channel, i) => {
    const t = (Math.sin(tick / 4) + 1) / 2;

    return Math.round(channel + (GRADIENT_TO[i] - channel) * t);
  });
  const spinner = paint.rgb(spinnerColor, SPINNER_FRAMES[tick % SPINNER_FRAMES.length]);

  if (!state.step.mode || !state.total) {
    return [`  ${spinner} ${paint.bold(label)} ${paint.dim('working…')}  ${took}`];
  }

  const ratio = state.done / state.total;
  const percent = `${(ratio * 100).toFixed(1).padStart(5)}%`;
  const counts = [
    paint.bold(`${state.done}/${state.total}`),
    paint.green(`✚ ${state.processed}`),
    state.failures > 0 ? paint.red(`✖ ${state.failures}`) : null,
    paint.dim(`ETA ${getEta(state, now)}`),
  ]
    .filter(Boolean)
    .join('  ');

  return [
    `  ${spinner} ${paint.bold(label)} ${progressBar(ratio, BAR_WIDTH, tick)} ${paint.bold(percent)}  ${counts}  ${took}`,
    `    ${paint.dim('╰─')} ${state.lastLabel ? paint.cyan(state.lastLabel) : paint.dim('skipping what is already on disk…')}`,
  ];
}

function renderHeader(startedAt, now) {
  return [`  ${gradientText('✦ xigma fonts pipeline ✦')}  ${paint.dim(formatDuration(now - startedAt))}`, ''];
}

function runStep(state, onLine) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', state.step.script)], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderrTail = [];

    readline.createInterface({ input: child.stdout }).on('line', (line) => onLine(state, line));
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      onLine(state, line);
      stderrTail.push(line);
      stderrTail.splice(0, Math.max(stderrTail.length - MAX_ERROR_LINES, 0));
    });

    child.on('close', (code, signal) => resolve({ code, signal, stderrTail }));
    state.child = child;
  });
}

function handleLine(state, line) {
  const update = state.step.parse(line);

  if (update) {
    applyUpdate(state, update);
  }
}

async function runInteractive(stepIds) {
  const states = PIPELINE_STEPS.filter((step) => stepIds.includes(step.id)).map(createStepState);
  const live = createLiveArea(process.stdout);
  const startedAt = Date.now();
  let tick = 0;
  let stopping = false;

  const draw = () => {
    const now = Date.now();

    live.render([...renderHeader(startedAt, now), ...states.flatMap((state) => renderStep(state, tick, now))]);
    tick += 1;
  };

  const onSigint = () => {
    stopping = true;
    states.find((state) => state.status === 'running')?.child?.kill('SIGINT');
  };

  process.on('SIGINT', onSigint);
  live.hideCursor();

  const timer = setInterval(draw, FRAME_MS);

  for (const state of states) {
    if (stopping) {
      state.status = 'skipped';
    } else {
      state.status = 'running';
      state.startedAt = Date.now();

      const { code, stderrTail } = await runStep(state, handleLine);

      state.endedAt = Date.now();

      if (stopping) {
        state.status = 'stopped';
      } else if (code === 0) {
        state.status = 'done';
      } else {
        state.status = 'failed';
        state.errorLines = stderrTail;
        stopping = true;
      }
    }
  }

  clearInterval(timer);
  draw();
  live.showCursor();
  process.off('SIGINT', onSigint);

  return { states, took: Date.now() - startedAt };
}

function printOutro({ states, took }) {
  const failedStep = states.find((state) => state.status === 'failed');
  const stoppedStep = states.find((state) => state.status === 'stopped');
  const itemFailures = states.reduce((sum, state) => sum + state.failures, 0);

  console.log('');

  if (failedStep) {
    outro(paint.red(`✖ ${failedStep.step.label} failed after ${formatDuration(took)} — fix the error above and re-run`));
    process.exitCode = 1;
  } else if (stoppedStep) {
    outro(paint.yellow(`■ Stopped after ${formatDuration(took)} — re-run anytime, everything already on disk is skipped`));
    process.exitCode = 130;
  } else {
    const failureNote =
      itemFailures > 0
        ? paint.dim(` (${itemFailures} item(s) failed — details in .cache/*-failures.json, usually unavailable weights)`)
        : '';

    outro(`${gradientText(`✨ All done in ${formatDuration(took)}`)}${failureNote}`);
  }
}

function runPlain(stepIds) {
  for (const step of PIPELINE_STEPS.filter((candidate) => stepIds.includes(candidate.id))) {
    console.log(`\n== ${step.label} (${step.script})`);

    const { status } = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', step.script)], { cwd: REPO_ROOT, stdio: 'inherit' });

    if (status !== 0) {
      process.exit(status ?? 1);
    }
  }
}

async function main() {
  const stepIds = parseStepArgs(process.argv.slice(2));

  if (!process.stdout.isTTY) {
    runPlain(stepIds ?? PIPELINE_STEPS.filter((step) => step.defaultSelected).map((step) => step.id));

    return;
  }

  console.log('');
  intro(paint.bold(gradientText('xigma fonts — MSDF atlas pipeline')));

  const selected = stepIds ?? (await pickSteps());

  console.log('');
  printOutro(await runInteractive(selected));
}

main();
