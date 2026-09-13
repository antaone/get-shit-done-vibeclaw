'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { listFiles, snapshot } = require('./helpers/foreign-installs.cjs');
const { BUILD_SCRIPT, HOOKS_DIST } = require('./helpers/install-shared.cjs');
const {
  installRuntimeArtifacts,
  uninstallRuntimeArtifacts,
  listOwnHookFiles,
  buildCodexHookWindowsShimIR,
} = require('../bin/install.js');
const { isManagedHookCommand, isManagedHookBasename } = require('../get-shit-done/bin/lib/shell-command-projection.cjs');
const { loadSkillsManifest, resolveProfile } = require('../get-shit-done/bin/lib/install-profiles.cjs');

const PROFILE = resolveProfile({ modes: ['core'], manifest: loadSkillsManifest(path.join(__dirname, '..', 'commands', 'gsd')) });
const FOREIGN = [
  'commands/gsd/help.md',
  'commands/vgsd/help.md',
  'skills/gsd-help/SKILL.md',
  'skills/vgsd-help/SKILL.md',
  'skills/gsd/help/SKILL.md',
  'command/gsd-help.md',
  'command/vgsd-help.md',
];

test('only commands under hooks/fvgsd/ count as managed hooks', () => {
  const settings = { surface: 'settings-json' };
  assert.equal(isManagedHookCommand('node "/h/.claude/hooks/fvgsd/statusline.js"', settings), true);
  assert.equal(isManagedHookCommand('node "/h/.claude/hooks/statusline.js"', settings), false);
  assert.equal(isManagedHookCommand('node "/h/.claude/hooks/gsd-statusline.js"', settings), false);
  assert.equal(isManagedHookCommand('node "/h/.codex/hooks/gsd-update-check.js"', { surface: 'codex-hooks-json', includeLegacyAliases: true }), false);
  assert.equal(isManagedHookBasename('/h/.claude/hooks/fvgsd/context-monitor.js'), true);
  assert.equal(isManagedHookBasename('/h/.claude/hooks/context-monitor.js'), false);
  // An fvgsd folder outside hooks/ is not a hook, and there are no legacy aliases.
  assert.equal(isManagedHookCommand('node "/h/.claude/fvgsd/statusline.js"', settings), false);
  assert.equal(isManagedHookCommand('node "/h/.codex/hooks/fvgsd-update-check.js"', { surface: 'codex-hooks-json', includeLegacyAliases: true }), false);
});

for (const runtime of ['claude', 'hermes', 'gemini', 'opencode']) {
  test(`${runtime}: install and uninstall of artifacts never touch gsd or vgsd files`, (t) => {
    const configDir = createTempDir(`fvgsd-own-${runtime}-`);
    t.after(() => cleanup(configDir));
    for (const rel of FOREIGN) {
      fs.mkdirSync(path.dirname(path.join(configDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(configDir, rel), `${rel}\n`);
    }
    const before = snapshot(configDir, FOREIGN);
    installRuntimeArtifacts(runtime, configDir, 'global', PROFILE);
    assert.deepEqual(snapshot(configDir, FOREIGN), before);
    uninstallRuntimeArtifacts(runtime, configDir, 'global');
    assert.deepEqual(snapshot(configDir, FOREIGN), before);
  });
}

test('the uninstall hook list is every file install writes under hooks/fvgsd/', () => {
  if (!fs.existsSync(path.join(HOOKS_DIST, IDENTITY.hooksDir))) {
    execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: 'pipe' });
  }
  // install copies the built hooks tree (lib/ included) and, on Windows, writes a
  // .cmd shim next to Codex's update-check hook.
  const codexShim = buildCodexHookWindowsShimIR(`${IDENTITY.hooksDir}/check-update.js`, '"node"').cmdPath;
  const expected = [...new Set([...listFiles(HOOKS_DIST, IDENTITY.hooksDir), codexShim])].sort();
  const ownHookFiles = listOwnHookFiles();
  assert.deepEqual(ownHookFiles, expected);
  assert.equal(ownHookFiles.includes(`${IDENTITY.hooksDir}/check-update-worker.js`), true);
});
