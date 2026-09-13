#!/usr/bin/env node
/**
 * bin/fvgsd-sdk.js — back-compat shim for external callers of `fvgsd-sdk`.
 *
 * When the parent package is installed globally (`npm install -g fvgsd`)
 * npm creates a `fvgsd-sdk` symlink in the global bin directory pointing at this
 * file. npm correctly chmods bin entries from a tarball, so the execute-bit
 * problem that afflicted the sub-install approach (issue #2453) cannot occur here.
 *
 * NOTE (#2775): `npx fvgsd` does NOT link this shim — npx only
 * exposes the package's primary bin (`fvgsd`). For npx-based usage,
 * the installer (`bin/install.js#installSdkIfNeeded`) self-symlinks `fvgsd-sdk`
 * into `~/.local/bin` when needed and verifies PATH callability before
 * reporting `✓ GSD SDK ready`.
 *
 * This shim resolves sdk/dist/cli.js relative to its own location and delegates
 * to it via `node`, so `fvgsd-sdk <args>` behaves identically to
 * `node <packageDir>/sdk/dist/cli.js <args>`.
 *
 * Call sites (slash commands, agent prompts, hook scripts) continue to work without
 * changes because `fvgsd-sdk` still resolves on PATH — it just comes from this shim
 * in the parent package rather than from a separately installed @fvgsd/sdk.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const cliPath = path.resolve(__dirname, '..', 'sdk', 'dist', 'cli.js');

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
