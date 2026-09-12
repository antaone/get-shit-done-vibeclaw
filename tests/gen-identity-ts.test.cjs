'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'gen-identity-ts.cjs');

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--json'], { encoding: 'utf8' });
  return { status: r.status, report: JSON.parse(r.stdout) };
}

test('generates a fresh identity.ts and detects drift', (t) => {
  const dir = createTempDir('fvgsd-identity-ts-');
  t.after(() => cleanup(dir));
  const out = path.join(dir, 'identity.ts');

  const generated = run(['--out', out]);
  assert.equal(generated.status, 0);
  assert.deepEqual(generated.report, { ok: true, fresh: true, path: out });

  const fresh = run(['--check', '--out', out]);
  assert.equal(fresh.status, 0);
  assert.equal(fresh.report.fresh, true);

  fs.writeFileSync(out, 'export const IDENTITY = {} as const;\n');
  const stale = run(['--check', '--out', out]);
  assert.equal(stale.status, 1);
  assert.deepEqual(stale.report, { ok: false, fresh: false, path: out });
});

test('the committed sdk/src/identity.ts is fresh', () => {
  const r = run(['--check']);
  assert.equal(r.status, 0);
  assert.equal(r.report.fresh, true);
});
