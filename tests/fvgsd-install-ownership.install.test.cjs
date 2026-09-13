'use strict';

// Installs fvgsd into a temp config dir (HOME overridden) next to fake gsd and vgsd
// files, then uninstalls it, and checks that only fvgsd's own files, folders and
// settings.json hook entries go away.

process.env.FVGSD_TEST_MODE = '1';

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const { cleanup } = require('./helpers.cjs');
const { snapshot } = require('./helpers/foreign-installs.cjs');
const { INSTALL_SCRIPT, BUILD_SCRIPT, HOOKS_DIST, installerEnv } = require('./helpers/install-shared.cjs');

// Seeded before install.
const FOREIGN = [
  'commands/gsd/help.md',
  'commands/gsd/dev-preferences.md',
  'commands/vgsd/help.md',
  'skills/gsd-help/SKILL.md',
  'skills/vgsd-help/SKILL.md',
  'skills/gsd/help/SKILL.md',
  'command/gsd-help.md',
  'hooks/lib/git-cmd.js',
];
// Seeded after install, since what this file checks is uninstall; how install treats
// foreign hook files is covered by the coexistence test.
const FOREIGN_HOOK = 'hooks/gsd-statusline.js';

function tempRoot(t, name) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${IDENTITY.tempPrefix}ownership-${name}-`)));
  t.after(() => cleanup(root));
  return root;
}

function seed(configDir, rels) {
  for (const rel of rels) {
    fs.mkdirSync(path.dirname(path.join(configDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(configDir, rel), `${rel}\n`);
  }
  return snapshot(configDir, rels);
}

function runInstaller(root, args) {
  const result = spawnSync(process.execPath, [INSTALL_SCRIPT, ...args, '--no-sdk'], {
    cwd: root,
    encoding: 'utf8',
    env: installerEnv({ HOME: root, USERPROFILE: root }),
  });
  assert.equal(result.status, 0, `install.js ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
}

function readSettings(configDir) {
  const settingsPath = path.join(configDir, 'settings.json');
  return fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
}

function hookCommands(settings) {
  const commands = [];
  for (const entries of Object.values(settings.hooks || {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) {
        if (typeof hook.command === 'string') commands.push(hook.command);
      }
    }
  }
  return commands;
}

describe('fvgsd uninstall removes only what fvgsd installed', () => {
  before(() => {
    if (!fs.existsSync(path.join(HOOKS_DIST, IDENTITY.hooksDir))) {
      execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: 'pipe' });
    }
  });

  for (const runtime of ['claude', 'gemini', 'hermes', 'qwen']) {
    test(`${runtime} --global: uninstall removes every fvgsd hook and leaves gsd and vgsd files byte-identical`, (t) => {
      const root = tempRoot(t, runtime);
      const configDir = path.join(root, 'config');
      const ownHooksDir = path.join(configDir, 'hooks', IDENTITY.hooksDir);
      const seeded = seed(configDir, FOREIGN);

      runInstaller(root, [`--${runtime}`, '--global', '--config-dir', configDir]);
      assert.deepEqual(snapshot(configDir, FOREIGN), seeded);
      assert.equal(fs.existsSync(path.join(ownHooksDir, 'check-update-worker.js')), true);
      const ownHookPrefix = `${ownHooksDir.replace(/\\/g, '/')}/`;
      assert.equal(hookCommands(readSettings(configDir)).some((command) => command.includes(ownHookPrefix)), true);

      const foreign = { ...seeded, ...seed(configDir, [FOREIGN_HOOK]) };
      // An fvgsd hook registered for another config dir belongs to that install.
      const otherInstallCommand = `node "${path.join(root, 'other', 'hooks', IDENTITY.hooksDir, 'check-update.js').replace(/\\/g, '/')}"`;
      const settings = readSettings(configDir);
      settings.hooks.SessionStart = [...(settings.hooks.SessionStart || []), { hooks: [{ type: 'command', command: otherInstallCommand }] }];
      fs.writeFileSync(path.join(configDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

      runInstaller(root, [`--${runtime}`, '--global', '--config-dir', configDir, '--uninstall']);
      assert.deepEqual(snapshot(configDir, [...FOREIGN, FOREIGN_HOOK]), foreign);
      assert.equal(fs.existsSync(ownHooksDir), false);
      assert.deepEqual(hookCommands(readSettings(configDir)), [otherInstallCommand]);
    });
  }

  test('claude --local: uninstall removes fvgsd commands, hooks and hook entries and leaves gsd and vgsd files byte-identical', (t) => {
    const root = tempRoot(t, 'claude-local');
    const configDir = path.join(root, '.claude');
    const seeded = seed(configDir, FOREIGN);

    runInstaller(root, ['--claude', '--local']);
    assert.deepEqual(snapshot(configDir, FOREIGN), seeded);
    assert.equal(hookCommands(readSettings(configDir)).some((command) => command.includes(`/hooks/${IDENTITY.hooksDir}/`)), true);

    const foreign = { ...seeded, ...seed(configDir, [FOREIGN_HOOK]) };
    runInstaller(root, ['--claude', '--local', '--uninstall']);
    assert.deepEqual(snapshot(configDir, [...FOREIGN, FOREIGN_HOOK]), foreign);
    assert.equal(fs.existsSync(path.join(configDir, 'commands', IDENTITY.commandPrefix)), false);
    assert.equal(fs.existsSync(path.join(configDir, 'hooks', IDENTITY.hooksDir)), false);
    assert.deepEqual(hookCommands(readSettings(configDir)), []);
  });

  test('claude --portable-hooks: uninstall removes hook entries written with $HOME-relative paths', (t) => {
    const root = tempRoot(t, 'claude-portable');
    const configDir = path.join(root, '.claude');

    runInstaller(root, ['--claude', '--global', '--config-dir', configDir, '--portable-hooks']);
    assert.equal(hookCommands(readSettings(configDir)).some((command) => command.includes(`$HOME/.claude/hooks/${IDENTITY.hooksDir}/`)), true);

    runInstaller(root, ['--claude', '--global', '--config-dir', configDir, '--uninstall']);
    assert.deepEqual(hookCommands(readSettings(configDir)), []);
  });
});
