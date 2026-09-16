#!/usr/bin/env node
'use strict';

// Keeps sdk/dist in step with the SDK sources: `prepare` (every root `npm install`) builds the SDK
// when sdk/dist/cli.js is missing or the build inputs changed since the last build, and
// `npm run build:sdk` (--force) always builds. The fingerprint of the inputs a build used is
// written to sdk/dist/.build-fingerprint only after that build succeeded.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * What the SDK build compiles: sdk/package.json's `build` is plain `tsc`, which reads
 * sdk/tsconfig.json. sdkBuildInputs mirrors this include and exclude;
 * tests/ensure-local-sdk.test.cjs fails when the tsconfig changes.
 */
const SDK_TSCONFIG = {
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts', 'src/**/*.integration.test.ts', 'dist', 'node_modules'],
};

const TRIGGER_TEXT = {
  forced: 'requested',
  dist_missing: 'sdk/dist/cli.js is missing',
  fingerprint_missing: 'no build fingerprint recorded yet',
  fingerprint_changed: 'SDK sources changed since the last build',
};

function sdkPaths(repoRoot = path.resolve(__dirname, '..')) {
  const sdkRoot = path.join(repoRoot, 'sdk');
  return {
    repoRoot,
    sdkRoot,
    cli: path.join(sdkRoot, 'dist', 'cli.js'),
    fingerprint: path.join(sdkRoot, 'dist', '.build-fingerprint'),
    packageJson: path.join(sdkRoot, 'package.json'),
    lockfile: path.join(sdkRoot, 'package-lock.json'),
  };
}

/** The SDK build inputs, relative to sdkRoot with `/` separators, sorted. */
function sdkBuildInputs(sdkRoot) {
  const inputs = ['package.json', 'package-lock.json', 'tsconfig.json'];
  const walk = (relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(sdkRoot, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) inputs.push(rel);
    }
  };
  walk('src');
  return inputs.sort();
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** sha256 over every build input's path and content; independent of sdk/dist, node_modules and git. */
function sdkBuildFingerprint(sdkRoot) {
  const lines = sdkBuildInputs(sdkRoot).map((rel) => {
    let digest = 'missing';
    try {
      digest = sha256(fs.readFileSync(path.join(sdkRoot, rel)));
    } catch {
      // A missing input is part of the fingerprint too.
    }
    return `${digest}  ${rel}`;
  });
  return sha256(lines.join('\n'));
}

function readRecordedFingerprint(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function npmInvocation(args, env = process.env) {
  if (env.npm_execpath) return { program: process.execPath, args: [env.npm_execpath, ...args] };
  return { program: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

function runNpm(args, cwd, options = {}) {
  const env = options.env || process.env;
  const invocation = npmInvocation(args, env);
  const result = (options.spawn || spawnSync)(invocation.program, invocation.args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`npm ${args.join(' ')} failed while preparing the local SDK`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

/**
 * Build the SDK when it is missing or stale, or always with `force`.
 * Options: repoRoot, force, env (default process.env), spawn and log (for tests).
 */
function ensureLocalSdk(options = {}) {
  const env = options.env || process.env;
  const log = options.log || ((line) => process.stdout.write(line));
  const paths = sdkPaths(options.repoRoot);
  if (!options.force && env.FVGSD_SKIP_LOCAL_SDK_BUILD === '1') {
    return { built: false, reason: 'explicitly_skipped', cli: paths.cli };
  }

  const fingerprint = sdkBuildFingerprint(paths.sdkRoot);
  let trigger;
  if (options.force) {
    trigger = 'forced';
  } else if (!fs.existsSync(paths.cli)) {
    trigger = 'dist_missing';
  } else {
    const recorded = readRecordedFingerprint(paths.fingerprint);
    if (recorded === fingerprint) return { built: false, reason: 'sdk_dist_current', cli: paths.cli };
    trigger = recorded === null ? 'fingerprint_missing' : 'fingerprint_changed';
  }

  if (!fs.existsSync(paths.packageJson) || !fs.existsSync(paths.lockfile)) {
    throw new Error('Cannot build the local SDK because sdk/package.json or sdk/package-lock.json is missing');
  }
  log(`Building the local GSD SDK (${TRIGGER_TEXT[trigger]})...\n`);
  // Until this build succeeds, no fingerprint may claim that dist matches the sources.
  fs.rmSync(paths.fingerprint, { force: true });
  runNpm(['ci'], paths.sdkRoot, options);
  runNpm(['run', 'build'], paths.sdkRoot, options);
  if (!fs.existsSync(paths.cli)) {
    throw new Error(`SDK build completed without producing ${paths.cli}`);
  }
  fs.writeFileSync(paths.fingerprint, `${fingerprint}\n`);
  return { built: true, reason: 'sdk_dist_built', trigger, cli: paths.cli };
}

function parseArgs(argv) {
  const parsed = { force: false };
  for (const arg of argv) {
    if (arg !== '--force') throw new Error(`unknown argument: ${arg} (only --force is accepted)`);
    parsed.force = true;
  }
  return parsed;
}

if (require.main === module) {
  try {
    ensureLocalSdk(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`Local SDK preparation failed: ${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  }
}

module.exports = {
  SDK_TSCONFIG,
  sdkPaths,
  sdkBuildInputs,
  sdkBuildFingerprint,
  npmInvocation,
  runNpm,
  ensureLocalSdk,
  parseArgs,
};
