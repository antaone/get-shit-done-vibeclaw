'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runMinimalInstall } = require('./helpers/install-shared.cjs');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');

test('install records where fvgsd came from', (t) => {
  const { configDir, root } = runMinimalInstall({ runtime: 'claude', scope: 'global' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.installDir, IDENTITY.sourceFile), 'utf8'));
  assert.equal(record.repo, path.resolve(__dirname, '..'));
  assert.deepEqual(record.runtimes, ['claude']);
  assert.equal(record.scope, 'global');
  assert.equal(typeof record.commit, 'string');
});
