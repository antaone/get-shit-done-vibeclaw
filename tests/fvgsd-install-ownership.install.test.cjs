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

// Seeded before install, so each test also shows that install leaves them alone,
// including the foreign hook next to hooks/fvgsd/.
const FOREIGN = [
  'commands/gsd/help.md',
  'commands/gsd/dev-preferences.md',
  'commands/vgsd/help.md',
  'skills/gsd-help/SKILL.md',
  'skills/vgsd-help/SKILL.md',
  'skills/gsd/help/SKILL.md',
  'command/gsd-help.md',
  'hooks/lib/git-cmd.js',
  'hooks/gsd-statusline.js',
];

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

      // An fvgsd hook registered for another config dir belongs to that install.
      const otherInstallCommand = `node "${path.join(root, 'other', 'hooks', IDENTITY.hooksDir, 'check-update.js').replace(/\\/g, '/')}"`;
      const settings = readSettings(configDir);
      settings.hooks.SessionStart = [...(settings.hooks.SessionStart || []), { hooks: [{ type: 'command', command: otherInstallCommand }] }];
      fs.writeFileSync(path.join(configDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

      runInstaller(root, [`--${runtime}`, '--global', '--config-dir', configDir, '--uninstall']);
      assert.deepEqual(snapshot(configDir, FOREIGN), seeded);
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

    runInstaller(root, ['--claude', '--local', '--uninstall']);
    assert.deepEqual(snapshot(configDir, FOREIGN), seeded);
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

  test('cline --global: fvgsd records the .clinerules it writes, updates it on reinstall while unchanged, and removes it on uninstall', (t) => {
    const root = tempRoot(t, 'cline');
    const configDir = path.join(root, 'config');
    const clinerules = path.join(configDir, '.clinerules');
    const manifestPath = path.join(configDir, IDENTITY.manifestFile);

    runInstaller(root, ['--cline', '--global', '--config-dir', configDir]);
    const written = fs.readFileSync(clinerules, 'utf8');
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files['.clinerules'], snapshot(configDir, ['.clinerules'])['.clinerules']);

    // Rules an older fvgsd wrote, still as its manifest recorded them, are replaced on reinstall.
    fs.writeFileSync(clinerules, 'older fvgsd rules\n');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files['.clinerules'] = snapshot(configDir, ['.clinerules'])['.clinerules'];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    runInstaller(root, ['--cline', '--global', '--config-dir', configDir]);
    assert.equal(fs.readFileSync(clinerules, 'utf8'), written);

    runInstaller(root, ['--cline', '--global', '--config-dir', configDir, '--uninstall']);
    assert.equal(fs.existsSync(clinerules), false);
    assert.equal(fs.existsSync(manifestPath), false);
  });

  test('cline --global: a .clinerules fvgsd did not write stays byte-identical through install and uninstall', (t) => {
    const root = tempRoot(t, 'cline-foreign');
    const configDir = path.join(root, 'config');
    const foreign = seed(configDir, ['.clinerules']);

    runInstaller(root, ['--cline', '--global', '--config-dir', configDir]);
    assert.deepEqual(snapshot(configDir, ['.clinerules']), foreign);
    assert.equal('.clinerules' in JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.manifestFile), 'utf8')).files, false);

    runInstaller(root, ['--cline', '--global', '--config-dir', configDir, '--uninstall']);
    assert.deepEqual(snapshot(configDir, ['.clinerules']), foreign);
  });

  describe('Gemini experimental.enableAgents: fvgsd takes back only the flag it set', () => {
    function gemini(root, configDir, extra = []) {
      runInstaller(root, ['--gemini', '--global', '--config-dir', configDir, ...extra]);
    }
    function flagRecord(configDir) {
      const manifestPath = path.join(configDir, IDENTITY.manifestFile);
      return fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).geminiAgentsFlag : undefined;
    }
    function seedSettings(configDir, settings) {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
      return readSettings(configDir);
    }

    test('fvgsd alone: install adds the flag and its record, reinstall keeps the record, uninstall removes both', (t) => {
      const root = tempRoot(t, 'gemini-flag-alone');
      const configDir = path.join(root, 'config');
      const before = seedSettings(configDir, { theme: 'Dracula' });

      gemini(root, configDir);
      assert.deepEqual(readSettings(configDir).experimental, { enableAgents: true });
      assert.deepEqual(flagRecord(configDir), { createdExperimental: true });

      gemini(root, configDir);
      assert.deepEqual(flagRecord(configDir), { createdExperimental: true });

      gemini(root, configDir, ['--uninstall']);
      assert.equal(flagRecord(configDir), undefined);
      assert.deepEqual(readSettings(configDir), before);
    });

    for (const enableAgents of [true, false]) {
      test(`enableAgents already ${enableAgents}: install and uninstall leave it as written and record nothing`, (t) => {
        const root = tempRoot(t, `gemini-flag-${enableAgents}`);
        const configDir = path.join(root, 'config');
        const before = seedSettings(configDir, { experimental: { enableAgents } });

        gemini(root, configDir);
        assert.deepEqual(readSettings(configDir).experimental, before.experimental);
        assert.equal(flagRecord(configDir), undefined);

        gemini(root, configDir, ['--uninstall']);
        assert.deepEqual(readSettings(configDir), before);
      });
    }

    for (const foreign of ['agents/gsd-planner.md', 'get-shit-done/VERSION']) {
      test(`fvgsd set the flag, then ${foreign} appears: uninstall keeps the flag`, (t) => {
        const root = tempRoot(t, 'gemini-flag-kept');
        const configDir = path.join(root, 'config');

        gemini(root, configDir);
        assert.deepEqual(flagRecord(configDir), { createdExperimental: true });
        seed(configDir, [foreign]);

        gemini(root, configDir, ['--uninstall']);
        assert.deepEqual(readSettings(configDir).experimental, { enableAgents: true });
      });
    }
  });
});
