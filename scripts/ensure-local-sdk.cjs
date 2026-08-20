#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function sdkPaths(repoRoot = path.resolve(__dirname, '..')) {
  const sdkRoot = path.join(repoRoot, 'sdk');
  return {
    repoRoot,
    sdkRoot,
    cli: path.join(sdkRoot, 'dist', 'cli.js'),
    packageJson: path.join(sdkRoot, 'package.json'),
    lockfile: path.join(sdkRoot, 'package-lock.json'),
  };
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

function ensureLocalSdk(options = {}) {
  const paths = sdkPaths(options.repoRoot);
  if (fs.existsSync(paths.cli)) {
    return { built: false, reason: 'sdk_dist_present', cli: paths.cli };
  }
  if (process.env.GSD_SKIP_LOCAL_SDK_BUILD === '1') {
    return { built: false, reason: 'explicitly_skipped', cli: paths.cli };
  }
  if (!fs.existsSync(paths.packageJson) || !fs.existsSync(paths.lockfile)) {
    throw new Error('Cannot build the local SDK because sdk/package.json or sdk/package-lock.json is missing');
  }
  process.stdout.write('Preparing local GSD SDK (first clone only)...\n');
  runNpm(['ci'], paths.sdkRoot, options);
  runNpm(['run', 'build'], paths.sdkRoot, options);
  if (!fs.existsSync(paths.cli)) {
    throw new Error(`SDK build completed without producing ${paths.cli}`);
  }
  return { built: true, reason: 'sdk_dist_built', cli: paths.cli };
}

if (require.main === module) {
  try {
    ensureLocalSdk();
  } catch (error) {
    process.stderr.write(`Local SDK preparation failed: ${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  }
}

module.exports = { sdkPaths, npmInvocation, runNpm, ensureLocalSdk };
