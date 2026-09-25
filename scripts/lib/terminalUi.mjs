/**
 * Small ANSI helpers for scripts/pipeline.mjs: truecolor gradients, a redrawable live area, and
 * duration formatting. macOS/Linux terminals only (truecolor + Unicode assumed).
 */

const ESC = '\x1b[';
// oxlint-disable-next-line no-control-regex -- matching ANSI escape codes is the point
const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const GRADIENT_FROM = [124, 92, 255];
export const GRADIENT_TO = [0, 209, 255];

export const paint = {
  bold: (text) => `${ESC}1m${text}${ESC}22m`,
  cyan: (text) => `${ESC}36m${text}${ESC}39m`,
  dim: (text) => `${ESC}2m${text}${ESC}22m`,
  green: (text) => `${ESC}32m${text}${ESC}39m`,
  red: (text) => `${ESC}31m${text}${ESC}39m`,
  rgb: ([r, g, b], text) => `${ESC}38;2;${r};${g};${b}m${text}${ESC}39m`,
  yellow: (text) => `${ESC}33m${text}${ESC}39m`,
};

function mix(from, to, t) {
  return from.map((channel, i) => Math.round(channel + (to[i] - channel) * t));
}

export function gradientText(text, from = GRADIENT_FROM, to = GRADIENT_TO) {
  const chars = [...text];

  return chars.map((char, i) => paint.rgb(mix(from, to, chars.length > 1 ? i / (chars.length - 1) : 0), char)).join('');
}

export function progressBar(ratio, width, tick) {
  const filled = Math.round(Math.min(Math.max(ratio, 0), 1) * width);
  const shimmer = filled > 0 ? tick % (filled + 6) : -1;
  let bar = '';

  for (let i = 0; i < width; i += 1) {
    if (i < filled) {
      const color = mix(GRADIENT_FROM, GRADIENT_TO, i / Math.max(width - 1, 1));

      bar += paint.rgb(Math.abs(i - shimmer) <= 1 ? mix(color, [255, 255, 255], 0.55) : color, '█');
    } else {
      bar += paint.dim('░');
    }
  }

  return bar;
}

export function visibleLength(text) {
  return [...text.replace(ANSI_PATTERN, '')].length;
}

export function truncate(text, width) {
  if (visibleLength(text) <= width) {
    return text;
  }

  let visible = 0;
  let result = '';

  // oxlint-disable-next-line no-control-regex -- matching ANSI escape codes is the point
  for (const part of text.split(/(\x1b\[[0-9;]*[A-Za-z])/)) {
    if (part.startsWith('\x1b[')) {
      result += part;
    } else {
      for (const char of part) {
        if (visible < width - 1) {
          result += char;
          visible += 1;
        }
      }
    }
  }

  return `${result}…${ESC}0m`;
}

export function padEnd(text, width) {
  return text + ' '.repeat(Math.max(width - visibleLength(text), 0));
}

export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  }

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function createLiveArea(stream) {
  let renderedLines = 0;

  return {
    clear() {
      if (renderedLines > 0) {
        stream.write(`${ESC}${renderedLines}F${ESC}0J`);
        renderedLines = 0;
      }
    },
    hideCursor() {
      stream.write(`${ESC}?25l`);
    },
    render(lines) {
      const width = Math.max((stream.columns ?? 80) - 1, 20);
      const output = lines.map((line) => truncate(line, width)).join(`${ESC}0K\n`);

      stream.write(`${renderedLines > 0 ? `${ESC}${renderedLines}F` : ''}${output}${ESC}0K\n${ESC}0J`);
      renderedLines = lines.length;
    },
    showCursor() {
      stream.write(`${ESC}?25h`);
    },
  };
}
