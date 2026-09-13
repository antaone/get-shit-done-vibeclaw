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
const { isDeepStrictEqual } = require('node:util');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const { cleanup } = require('./helpers.cjs');
const { listFiles, snapshot } = require('./helpers/foreign-installs.cjs');
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

function spawnInstaller(root, args) {
  return spawnSync(process.execPath, [INSTALL_SCRIPT, ...args, '--no-sdk'], {
    cwd: root,
    encoding: 'utf8',
    env: installerEnv({ HOME: root, USERPROFILE: root }),
  });
}

function runInstaller(root, args) {
  const result = spawnInstaller(root, args);
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

  test('claude --global: a user statusLine and a hook entry using the flat hooks/statusline.js path stay unchanged through install and uninstall', (t) => {
    const root = tempRoot(t, 'user-statusline');
    const configDir = path.join(root, 'config');
    const userCommand = (name) => ({ type: 'command', command: `node "${path.join(configDir, 'hooks', name).replace(/\\/g, '/')}"` });
    // The user's own statusline script, and one entry mixing another user hook
    // with that same flat-layout path: neither is fvgsd's.
    const statusLine = userCommand('statusline.js');
    const mixedEntry = { hooks: [userCommand('session-note.js'), userCommand('statusline.js')] };
    const seeded = { statusLine, hooks: { SessionStart: [mixedEntry] } };
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'settings.json'), `${JSON.stringify(seeded, null, 2)}\n`);

    runInstaller(root, ['--claude', '--global', '--config-dir', configDir]);
    const installed = readSettings(configDir);
    assert.deepEqual(installed.statusLine, statusLine);
    assert.equal(installed.hooks.SessionStart.some((entry) => isDeepStrictEqual(entry, mixedEntry)), true, 'install changed or dropped the mixed hook entry');

    runInstaller(root, ['--claude', '--global', '--config-dir', configDir, '--uninstall']);
    const uninstalled = readSettings(configDir);
    assert.deepEqual(uninstalled.statusLine, statusLine);
    assert.deepEqual(hookCommands(uninstalled), hookCommands(seeded));
  });

  test('claude --global: the CommonJS marker lives in hooks/fvgsd/, so fvgsd hooks load under an ancestor "type": "module" package.json', (t) => {
    const root = tempRoot(t, 'commonjs-marker');
    const configDir = path.join(root, 'config');
    const ownHooksDir = path.join(configDir, 'hooks', IDENTITY.hooksDir);
    const markerRel = `hooks/${IDENTITY.hooksDir}/package.json`;
    // Node takes a .js file's module type from the nearest package.json above it.
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');

    runInstaller(root, ['--claude', '--global', '--config-dir', configDir]);
    assert.equal(fs.existsSync(path.join(configDir, 'package.json')), false, 'install wrote the config root package.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(configDir, markerRel), 'utf8')), { type: 'commonjs' });
    const manifest = JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.manifestFile), 'utf8'));
    assert.equal(manifest.files[markerRel], snapshot(configDir, [markerRel])[markerRel]);
    // Only .cjs files ship under fvgsd/, and .cjs is CommonJS whatever package.json says,
    // so that folder needs no marker of its own.
    assert.deepEqual(listFiles(configDir, IDENTITY.installDir).filter((rel) => path.extname(rel) === '.js'), []);

    const hook = spawnSync(process.execPath, [path.join(ownHooksDir, 'prompt-guard.js')], {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Read' }),
      env: installerEnv({ HOME: root, USERPROFILE: root }),
    });
    assert.equal(hook.status, 0, `prompt-guard.js exited ${hook.status}\n${hook.stderr}`);

    runInstaller(root, ['--claude', '--global', '--config-dir', configDir, '--uninstall']);
    assert.equal(fs.existsSync(ownHooksDir), false);
    assert.equal(fs.existsSync(path.join(configDir, 'package.json')), false);
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

  test('cline --global: an install that fails after its copy steps writes no .clinerules, so the next install writes and records it', (t) => {
    const root = tempRoot(t, 'cline-failed');
    const configDir = path.join(root, 'config');
    const clinerules = path.join(configDir, '.clinerules');
    // A file where install creates agents/ makes the install throw after Cline's
    // artifact step and before the file manifest is written.
    seed(configDir, ['agents']);

    const failed = spawnInstaller(root, ['--cline', '--global', '--config-dir', configDir]);
    assert.notEqual(failed.status, 0, `the blocked install should fail\n${failed.stdout}\n${failed.stderr}`);
    assert.equal(fs.existsSync(clinerules), false);

    fs.rmSync(path.join(configDir, 'agents'));
    runInstaller(root, ['--cline', '--global', '--config-dir', configDir]);
    const manifest = JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.manifestFile), 'utf8'));
    assert.equal(manifest.files['.clinerules'], snapshot(configDir, ['.clinerules'])['.clinerules']);

    runInstaller(root, ['--cline', '--global', '--config-dir', configDir, '--uninstall']);
    assert.equal(fs.existsSync(clinerules), false);
  });

  describe('~/.gsd/defaults.json: fvgsd adds resolve_model_ids only when the key is absent', () => {
    // ~/.gsd/ is upstream GSD's shared defaults folder; HOME is the temp root here.
    const DEFAULTS_REL = '.gsd/defaults.json';
    function seedDefaults(root, defaults) {
      fs.mkdirSync(path.join(root, '.gsd'), { recursive: true });
      fs.writeFileSync(path.join(root, DEFAULTS_REL), `${JSON.stringify(defaults, null, 2)}\n`);
      return snapshot(root, [DEFAULTS_REL]);
    }

    test('gemini --global: a resolve_model_ids value the user set stays byte-identical through install and uninstall', (t) => {
      const root = tempRoot(t, 'defaults-set');
      const configDir = path.join(root, 'config');
      const before = seedDefaults(root, { resolve_model_ids: true, model_profile: 'quality' });

      runInstaller(root, ['--gemini', '--global', '--config-dir', configDir]);
      assert.deepEqual(snapshot(root, [DEFAULTS_REL]), before);

      runInstaller(root, ['--gemini', '--global', '--config-dir', configDir, '--uninstall']);
      assert.deepEqual(snapshot(root, [DEFAULTS_REL]), before);
    });

    test('gemini --global: a defaults.json without resolve_model_ids gets "omit" and keeps its other keys', (t) => {
      const root = tempRoot(t, 'defaults-absent');
      seedDefaults(root, { model_profile: 'quality' });

      runInstaller(root, ['--gemini', '--global', '--config-dir', path.join(root, 'config')]);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, DEFAULTS_REL), 'utf8')), { model_profile: 'quality', resolve_model_ids: 'omit' });
    });
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

    test('fvgsd set the flag, then a symlinked gsd agent appears: uninstall keeps the flag', { skip: process.platform === 'win32' && 'creating symlinks needs extra rights on Windows' }, (t) => {
      const root = tempRoot(t, 'gemini-flag-symlink');
      const configDir = path.join(root, 'config');

      gemini(root, configDir);
      // Dotfiles managers link agent files in from elsewhere.
      seed(root, ['dotfiles/gsd-planner.md']);
      fs.symlinkSync(path.join(root, 'dotfiles', 'gsd-planner.md'), path.join(configDir, 'agents', 'gsd-planner.md'));

      gemini(root, configDir, ['--uninstall']);
      assert.deepEqual(readSettings(configDir).experimental, { enableAgents: true });
    });

    test('fvgsd set the flag, then the user sets it to false: uninstall leaves false', (t) => {
      const root = tempRoot(t, 'gemini-flag-user-false');
      const configDir = path.join(root, 'config');

      gemini(root, configDir);
      assert.deepEqual(flagRecord(configDir), { createdExperimental: true });
      const settings = readSettings(configDir);
      settings.experimental.enableAgents = false;
      seedSettings(configDir, settings);

      gemini(root, configDir, ['--uninstall']);
      assert.deepEqual(readSettings(configDir).experimental, { enableAgents: false });
    });

    test('an experimental object fvgsd did not create stays after uninstall', (t) => {
      const root = tempRoot(t, 'gemini-flag-user-object');
      const configDir = path.join(root, 'config');
      const before = seedSettings(configDir, { experimental: {} });

      gemini(root, configDir);
      assert.deepEqual(flagRecord(configDir), { createdExperimental: false });

      gemini(root, configDir, ['--uninstall']);
      assert.deepEqual(readSettings(configDir), before);
    });

    test('an experimental object fvgsd created keeps keys added after install through uninstall', (t) => {
      const root = tempRoot(t, 'gemini-flag-grown-object');
      const configDir = path.join(root, 'config');

      gemini(root, configDir);
      assert.deepEqual(flagRecord(configDir), { createdExperimental: true });
      const settings = readSettings(configDir);
      settings.experimental.userFeature = true;
      seedSettings(configDir, settings);

      gemini(root, configDir, ['--uninstall']);
      assert.deepEqual(readSettings(configDir).experimental, { userFeature: true });
    });

    test('an install that fails while writing settings.json leaves no flag record', (t) => {
      if (process.getuid && process.getuid() === 0) {
        t.skip('file permissions do not stop root');
        return;
      }
      const root = tempRoot(t, 'gemini-flag-unwritten');
      const configDir = path.join(root, 'config');
      const before = seedSettings(configDir, { theme: 'Dracula' });
      const settingsPath = path.join(configDir, 'settings.json');

      // Read-only settings.json: install reads it, then fails when it writes it back.
      fs.chmodSync(settingsPath, 0o444);
      let failed;
      try {
        failed = spawnInstaller(root, ['--gemini', '--global', '--config-dir', configDir]);
      } finally {
        fs.chmodSync(settingsPath, 0o644);
      }

      assert.notEqual(failed.status, 0, `the install should fail\n${failed.stdout}\n${failed.stderr}`);
      assert.deepEqual(readSettings(configDir), before);
      assert.equal(flagRecord(configDir), undefined);
    });
  });
});
