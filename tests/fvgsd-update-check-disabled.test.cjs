'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { checkLatestVersion, CHECK_REASON } = require('../get-shit-done/bin/check-latest-version.cjs');

const WORKER = path.join(__dirname, '..', 'hooks', 'fvgsd', 'check-update-worker.js');

test('checkLatestVersion is disabled and never spawns npm', () => {
  let spawned = false;
  const result = checkLatestVersion({ spawn: () => { spawned = true; return { status: 0, stdout: '9.9.9\n' }; } });
  assert.equal(spawned, false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, CHECK_REASON.DISABLED);
});

test('update worker never runs npm and reports no update', (t) => {
  const dir = createTempDir('fvgsd-worker-');
  t.after(() => cleanup(dir));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  const marker = path.join(dir, 'npm-called');
  const npm = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  fs.writeFileSync(npm, process.platform === 'win32' ? `@echo called> "${marker}"\r\n` : `#!/bin/sh\necho called > "${marker}"\n`);
  fs.chmodSync(npm, 0o755);
  const versionFile = path.join(dir, 'config', 'fvgsd', 'VERSION');
  fs.mkdirSync(path.dirname(versionFile), { recursive: true });
  fs.writeFileSync(versionFile, '1.51.0\n');
  const cacheFile = path.join(dir, 'update-check.json');
  const r = spawnSync(process.execPath, [WORKER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FVGSD_CACHE_FILE: cacheFile,
      FVGSD_PROJECT_VERSION_FILE: path.join(dir, 'missing', 'VERSION'),
      FVGSD_GLOBAL_VERSION_FILE: versionFile,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(marker), false);
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.equal(cache.update_available, false);
  assert.equal(cache.latest, 'unknown');
});
