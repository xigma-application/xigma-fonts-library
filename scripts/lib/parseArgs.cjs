/** `--key value` pairs from a script's argv into an object. */
function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function requireArg(args, key) {
  const value = args[key];

  if (!value) {
    throw new Error(`missing required --${key}`);
  }

  return value;
}

module.exports = { parseArgs, requireArg };
