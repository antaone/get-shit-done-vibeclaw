'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('bug #3091: sdk install guidance and agent fallbacks use query-capable CLI', () => {
  test('quick workflow install hint references fvgsd (not @fvgsd/sdk)', () => {
    const content = read('get-shit-done/workflows/quick.md');
    assert.ok(content.includes('npm install -g fvgsd'));
    assert.ok(!content.includes('npm install -g @fvgsd/sdk'));
  });

  test('agent docs no longer reference node_modules/@fvgsd/sdk/dist/cli.js query fallback', () => {
    const files = [
      'agents/fvgsd-planner.md',
      'agents/fvgsd-executor.md',
      'agents/fvgsd-plan-checker.md',
      'agents/fvgsd-roadmapper.md',
    ];

    const offenders = files.filter((f) => read(f).includes('@fvgsd/sdk/dist/cli.js query'));
    assert.deepStrictEqual(offenders, [], `stale @fvgsd/sdk query fallback references: ${offenders.join(', ')}`);
  });
});
