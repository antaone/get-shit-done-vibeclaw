'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { rewriteHookCommandReferences } = require('../bin/install.js');
const {
  BUILD_SCRIPT,
  runMinimalInstall,
} = require('./helpers/install-shared.cjs');
const { execFileSync } = require('node:child_process');

// M4: tests/fvgsd-hook-commands.test.cjs only covers the pure function.
// This test proves the wiring: an installed hook file — the actual copy
// templateHook() writes into a fresh global install — must contain no
// remaining /gsd: or /gsd- command literal, for every runtime shape.
before(() => {
  execFileSync(process.execPath, [BUILD_SCRIPT], { encoding: 'utf-8', stdio: 'pipe' });
});

// Hooks installed unconditionally (not opt-in, unlike update-banner.js) that
// carry legacy /gsd:<cmd> / /gsd-<cmd> literals in their source, per the
// brief's facts: workflow-guard.js, context-monitor.js, statusline.js,
// session-state.sh.
const HOOKS_TO_CHECK = [
  'workflow-guard.js',
  'context-monitor.js',
  'statusline.js',
  'session-state.sh',
];

test('installed hooks contain no /gsd: or /gsd- command literal (claude)', (t) => {
  const { configDir, root } = runMinimalInstall({ runtime: 'claude', scope: 'global' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const hook of HOOKS_TO_CHECK) {
    const installedPath = path.join(configDir, 'hooks', 'fvgsd', hook);
    assert.ok(fs.existsSync(installedPath), `expected installed hook at ${installedPath}`);
    const content = fs.readFileSync(installedPath, 'utf8');
    const { references } = rewriteHookCommandReferences(content, 'claude');
    assert.deepEqual(references, [], `${hook} still has a rewritable /gsd: or /gsd- literal after install`);
  }
});

test('installed hooks contain no /gsd: or /gsd- command literal (codex)', (t) => {
  const { configDir, root } = runMinimalInstall({ runtime: 'codex', scope: 'global' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const hook of HOOKS_TO_CHECK) {
    const installedPath = path.join(configDir, 'hooks', 'fvgsd', hook);
    if (!fs.existsSync(installedPath)) continue; // some hooks are runtime-conditional
    const content = fs.readFileSync(installedPath, 'utf8');
    const { references } = rewriteHookCommandReferences(content, 'codex');
    assert.deepEqual(references, [], `${hook} still has a rewritable /gsd: or /gsd- literal after install`);
  }
});
