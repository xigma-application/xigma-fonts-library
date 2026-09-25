const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// files/dirs from the package that we don't copy into node_modules/@xigma/*
const IGNORE = new Set(['node_modules', 'tsconfig.json', 'tsup.config.ts', 'src.bak', '.turbo']);

const PROJECT_ROOT = process.cwd();
const NODE_MODULES_XIGMA = path.resolve(PROJECT_ROOT, 'node_modules', '@xigma');

// Lives outside node_modules so `npm install` never prunes it (npm only reconciles node_modules).
// Used to restore @xigma/* quickly after npm wipes it out, without re-cloning/re-building.
const CACHE_DIR = path.resolve(PROJECT_ROOT, '.xigma-cache');
const CACHE_PACKAGES_DIR = path.join(CACHE_DIR, 'packages');
const CACHE_MARKER = path.join(CACHE_DIR, 'state.json');

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function tryGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function copyRecursive(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (IGNORE.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// git@github.com:org/repo.git -> https://github.com/org/repo.git
function toHttpsUrl(repo) {
  const sshMatch = repo.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  return repo;
}

function readConfig() {
  const configPath = path.resolve(PROJECT_ROOT, 'xigma.json');
  if (!fs.existsSync(configPath)) {
    console.error('No xigma.json file in the project root.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const { repo, branch = 'main', packages } = config;

  if (!repo) {
    console.error("xigma.json must contain 'repo'.");
    process.exit(1);
  }

  // packages: array = explicit list; missing / "*" = all packages from the repo
  const explicitPackages = Array.isArray(packages) && packages.length > 0 ? packages : null;

  return { repo, branch, explicitPackages, repoHttps: config.repoHttps || toHttpsUrl(repo) };
}

// returns [url, url?] in the order to try: first the one from xigma.json, then HTTPS as a fallback
function candidateUrls({ repo, repoHttps }) {
  return repo === repoHttps ? [repo] : [repo, repoHttps];
}

function resolveRemoteSha(urls, branch) {
  for (const url of urls) {
    const out = tryGit(['ls-remote', url, branch]);
    if (out) return { sha: out.split(/\s+/)[0], url };
  }
  return null;
}

function packagesPresentIn(baseDir, names) {
  return names.length > 0 && names.every((name) => fs.existsSync(path.join(baseDir, name, 'package.json')));
}

function readCacheState() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_MARKER, 'utf8'));
  } catch {
    return null;
  }
}

function writeCacheState(sha, names) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_MARKER, JSON.stringify({ sha, packages: names }, null, 2));
}

function discoverPackages(repoDir) {
  const packagesDir = path.join(repoDir, 'packages');
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(packagesDir, entry.name, 'package.json')))
    .map((entry) => entry.name)
    .sort();
}

function copyPackages(srcPackagesDir, names, destDir, { hardFailOnMissing }) {
  fs.mkdirSync(destDir, { recursive: true });

  for (const pkgName of names) {
    const src = path.join(srcPackagesDir, pkgName);
    const dest = path.join(destDir, pkgName);

    if (!fs.existsSync(src)) {
      if (hardFailOnMissing) {
        console.error(`! @xigma/${pkgName} from xigma.json does not exist in the repo — aborting.`);
        process.exit(1);
      }
      console.warn(`! Skipped @xigma/${pkgName} — not found in the repo`);
      continue;
    }

    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    copyRecursive(src, dest);
  }
}

// Fast path: restore node_modules/@xigma/* from our own cache (outside node_modules), no clone/build needed.
// This is what heals the common case where `npm install` (any package, even one that fails to resolve)
// pruned node_modules/@xigma/* as "extraneous" before this script's postinstall hook ever ran.
function restoreFromCache(names) {
  if (!packagesPresentIn(CACHE_PACKAGES_DIR, names)) return false;
  copyPackages(CACHE_PACKAGES_DIR, names, NODE_MODULES_XIGMA, { hardFailOnMissing: false });
  for (const name of names) console.log(`> Restored @xigma/${name} from local cache`);
  return true;
}

function main() {
  if (process.env.XIGMA_SKIP_PULL === '1') {
    console.log('> XIGMA_SKIP_PULL=1 — skipping the @xigma/* package pull.');
    return;
  }

  const config = readConfig();
  const urls = candidateUrls(config);
  const cacheState = readCacheState();

  // 1. resolve the remote branch SHA
  const remote = resolveRemoteSha(urls, config.branch);
  const upToDate = Boolean(remote && cacheState && cacheState.sha === remote.sha);

  // 2. already up to date and node_modules/@xigma/* is intact — nothing to do
  if (upToDate && packagesPresentIn(NODE_MODULES_XIGMA, cacheState.packages)) {
    console.log(`> @xigma/* packages are already at ${remote.sha.slice(0, 9)} — skipping.`);
    return;
  }

  // 3. same version but node_modules/@xigma/* got wiped (e.g. npm pruned it during an install) —
  //    restore instantly from the local cache instead of re-cloning/re-building.
  if (upToDate && restoreFromCache(cacheState.packages)) {
    console.log(`> @xigma/* packages restored at ${remote.sha.slice(0, 9)} (from cache).`);
    return;
  }

  // 4. no usable cache for the current remote sha — full clone + build + copy
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xigma-shared-'));

  try {
    const cloneUrls = remote ? [remote.url] : urls;
    let cloned = false;
    for (const url of cloneUrls) {
      try {
        console.log(`> Cloning ${url}#${config.branch}...`);
        run(`git clone --depth 1 --branch "${config.branch}" "${url}" "${tmpDir}"`);
        cloned = true;
        break;
      } catch {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.mkdirSync(tmpDir, { recursive: true });
        console.warn(`! Failed to clone from ${url}`);
      }
    }

    if (!cloned) {
      // offline / unreachable — fall back to whatever cache we have, even if stale
      if (cacheState && restoreFromCache(cacheState.packages)) {
        console.warn('! Failed to fetch xigma-app-shared — restored the last known @xigma/* packages from cache.');
        return;
      }
      if (packagesPresentIn(NODE_MODULES_XIGMA, config.explicitPackages || cacheState?.packages || [])) {
        console.warn('! Failed to fetch xigma-app-shared — using the packages already present in node_modules.');
        return;
      }
      console.error('! Failed to fetch xigma-app-shared and no local @xigma/* packages present.');
      process.exit(1);
    }

    const actualSha = tryGit(['-C', tmpDir, 'rev-parse', 'HEAD']) || (remote && remote.sha) || 'unknown';

    // 5. install + build the workspace
    console.log('> Installing dependencies and building packages...');
    run('npm install --no-audit --no-fund', { cwd: tmpDir });
    run('npm run build --workspaces --if-present', { cwd: tmpDir });

    // 6. package list: explicit from xigma.json or all from the repo
    const names = config.explicitPackages || discoverPackages(tmpDir);
    console.log(`> Packages to copy: ${names.join(', ')}`);

    const repoPackagesDir = path.join(tmpDir, 'packages');
    copyPackages(repoPackagesDir, names, NODE_MODULES_XIGMA, { hardFailOnMissing: Boolean(config.explicitPackages) });

    // refresh the cache too, so future npm installs can self-heal without network access
    fs.rmSync(CACHE_PACKAGES_DIR, { recursive: true, force: true });
    copyPackages(repoPackagesDir, names, CACHE_PACKAGES_DIR, { hardFailOnMissing: false });
    writeCacheState(actualSha, names);

    console.log(`> Done (${actualSha.slice(0, 9)}).`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
