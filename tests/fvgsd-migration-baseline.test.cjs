'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const baseline = require('../get-shit-done/bin/lib/installer-migrations/000-first-time-baseline.cjs');

const FOREIGN = [
  'skills/gsd-help/SKILL.md',
  'skills/vgsd-help/SKILL.md',
  'agents/gsd-planner.md',
  'hooks/gsd-statusline.js',
  'hooks/lib/git-cmd.js',
  'get-shit-done/VERSION',
  'commands/gsd/help.md',
];

test('baseline scan proposes nothing for gsd or vgsd files but still scans fvgsd ones', (t) => {
  const configDir = createTempDir('fvgsd-baseline-');
  t.after(() => cleanup(configDir));
  for (const rel of [...FOREIGN, 'agents/fvgsd-retired.md']) {
    fs.mkdirSync(path.dirname(path.join(configDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(configDir, rel), `${rel}\n`);
  }
  const actions = baseline.plan({
    configDir,
    runtime: 'claude',
    baselineScan: true,
    classifyArtifact: () => ({ classification: 'unmanaged', currentHash: 'hash', originalHash: null }),
  });
  assert.deepEqual(actions.filter((action) => FOREIGN.includes(action.relPath)), []);
  assert.deepEqual(
    actions.filter((action) => action.relPath === 'agents/fvgsd-retired.md').map((action) => action.type),
    ['prompt-user'],
  );
});
