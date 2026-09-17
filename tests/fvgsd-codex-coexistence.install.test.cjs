'use strict';

// Spawns real Codex installs next to a seeded GSD config. Uses gsd names on
// purpose, so it is excluded from scripts/rename-identity.cjs.

process.env.FVGSD_TEST_MODE = '1';

const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { INSTALL_SCRIPT, installerEnv } = require('./helpers/install-shared.cjs');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const { codexConfigLayout, ensureCodexHooksJsonSessionStart, parseTomlToObject, stripStaleGsdHookBlocks } = require('../bin/install.js');

// Codex install copies fvgsd/check-update.js from hooks/dist, which only the build step fills.
before(() => {
  const hooksDist = path.join(__dirname, '..', 'hooks', 'dist');
  if (!fs.existsSync(hooksDist) || fs.readdirSync(hooksDist).length === 0) {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-hooks.js')], { stdio: 'pipe' });
  }
});

function tempCodexHome(t, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${IDENTITY.tempPrefix}codex-${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  return { root, configDir };
}

function runCodexInstaller(root, configDir, extra = []) {
  const r = spawnSync(process.execPath, [INSTALL_SCRIPT, '--codex', '--global', '--config-dir', configDir, ...extra], {
    cwd: root,
    encoding: 'utf8',
    env: installerEnv({ HOME: root, USERPROFILE: root }),
  });
  assert.equal(r.status, 0, `codex ${extra.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
}

function gsdCheckUpdateCommand(configDir) {
  return `node ${configDir.replace(/\\/g, '/')}/hooks/gsd-check-update.js`;
}

// GSD 1.42.3 as found in a real ~/.codex: its config.toml block ends with a bare
// [hooks] table, and its hooks.json keeps SessionStart at the top level. Current
// Codex skips that hooks.json ("unknown field `SessionStart`"), but both files are
// GSD's to change, not fvgsd's.
function seedGsd1423Codex(configDir) {
  const dir = configDir.replace(/\\/g, '/');
  const userPart = 'model = "gpt-5"\n\n[features]\ncodex_hooks = true\n\n';
  const gsdPart = [
    '# GSD Agent Configuration — managed by get-shit-done installer',
    '# GSD codex_hooks ownership: section',
    '',
    '[agents.gsd-verifier]',
    'description = "Verifies phase goal achievement."',
    `config_file = "${dir}/agents/gsd-verifier.toml"`,
    '',
    '',
    '# GSD Hooks',
    '[hooks]',
    'event = "SessionStart"',
    `command = "${gsdCheckUpdateCommand(configDir)}"`,
    '',
  ].join('\n');
  const hookCommand = `"${process.execPath.replace(/\\/g, '/')}" "${dir}/hooks/gsd-check-update.js"`;
  const hooksJson = `${JSON.stringify({ SessionStart: [{ hooks: [{ type: 'command', command: hookCommand }] }] }, null, 2)}\n`;
  fs.writeFileSync(path.join(configDir, 'config.toml'), userPart + gsdPart);
  fs.writeFileSync(path.join(configDir, 'hooks.json'), hooksJson);
  return { userPart, gsdPart, hooksJson };
}

test('GSD 1.42.3\'s [hooks] table and top-level hooks.json layout stay byte-identical through fvgsd install', (t) => {
  const { root, configDir } = tempCodexHome(t, 'gsd-1423-install');
  const { gsdPart, hooksJson } = seedGsd1423Codex(configDir);

  runCodexInstaller(root, configDir);

  const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
  assert.equal(content.slice(-gsdPart.length), gsdPart, 'GSD marker, sections and [hooks] table are unchanged');
  assert.deepEqual(codexConfigLayout(content).markers.map((marker) => marker.owner), ['fvgsd', 'gsd']);
  assert.equal(Object.keys(parseTomlToObject(content).agents).some((name) => name.startsWith(IDENTITY.agentPrefix)), true, 'fvgsd agents are configured');
  assert.equal(fs.readFileSync(path.join(configDir, 'hooks.json'), 'utf8'), hooksJson, 'hooks.json keeps GSD\'s layout and entry');
});

test('fvgsd reports its SessionStart hook as skipped while hooks.json keeps GSD 1.42.3\'s top-level layout', (t) => {
  const { configDir } = tempCodexHome(t, 'gsd-1423-hooks-json');
  const { hooksJson } = seedGsd1423Codex(configDir);

  const result = ensureCodexHooksJsonSessionStart(configDir, { absoluteRunner: JSON.stringify(process.execPath), platform: 'linux' });

  assert.equal(result.skipped, 'foreign-root-layout');
  assert.equal(result.wrote, false);
  assert.equal(fs.readFileSync(path.join(configDir, 'hooks.json'), 'utf8'), hooksJson);
});

test('uninstall next to GSD 1.42.3\'s Codex layout restores config.toml and hooks.json exactly', (t) => {
  const { root, configDir } = tempCodexHome(t, 'gsd-1423-uninstall');
  const { userPart, gsdPart, hooksJson } = seedGsd1423Codex(configDir);

  runCodexInstaller(root, configDir);
  runCodexInstaller(root, configDir, ['--uninstall']);

  assert.equal(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'), userPart + gsdPart);
  assert.equal(fs.readFileSync(path.join(configDir, 'hooks.json'), 'utf8'), hooksJson);
});

test('a GSD hook block in config.toml stays byte-identical through fvgsd install', (t) => {
  const { root, configDir } = tempCodexHome(t, 'gsd-hook-block');
  const configPath = path.join(configDir, 'config.toml');
  const userPart = 'model = "gpt-5"\n\n[features]\ncodex_hooks = true\n\n';
  const gsdPart = [
    '# GSD Agent Configuration — managed by get-shit-done installer',
    '',
    '[agents.gsd-planner]',
    'description = "GSD planner"',
    'config_file = "agents/gsd-planner.toml"',
    '',
    '# GSD Hooks',
    '[[hooks.SessionStart]]',
    '',
    '[[hooks.SessionStart.hooks]]',
    'type = "command"',
    `command = "${gsdCheckUpdateCommand(configDir)}"`,
    '',
  ].join('\n');
  fs.writeFileSync(configPath, userPart + gsdPart);

  assert.equal(stripStaleGsdHookBlocks(userPart + gsdPart, { configDir }), userPart + gsdPart, 'the stale-hook matcher ignores GSD hook names');

  runCodexInstaller(root, configDir);

  const content = fs.readFileSync(configPath, 'utf8');
  assert.equal(content.slice(-gsdPart.length), gsdPart, 'GSD marker, sections and hook block are unchanged');
  assert.deepEqual(codexConfigLayout(content).markers.map((marker) => marker.owner), ['fvgsd', 'gsd']);
  const parsed = parseTomlToObject(content);
  assert.equal(parsed.features.codex_hooks, true);
  assert.equal(Object.keys(parsed.agents).some((name) => name.startsWith(IDENTITY.agentPrefix)), true);
});

test('a stale fvgsd hook block for another config dir stays byte-identical through fvgsd install', (t) => {
  const { root, configDir } = tempCodexHome(t, 'other-dir-hook-block');
  const configPath = path.join(configDir, 'config.toml');
  const userPart = 'model = "gpt-5"\n\n[features]\ncodex_hooks = true\n\n';
  const hookBlock = (dir) => [
    '# GSD Hooks',
    '[[hooks.SessionStart]]',
    '',
    '[[hooks.SessionStart.hooks]]',
    'type = "command"',
    `command = "node ${dir.replace(/\\/g, '/')}/hooks/fvgsd/check-update.js"`,
    '',
  ].join('\n');
  const otherBlock = hookBlock(path.join(root, 'other', '.codex'));
  fs.writeFileSync(configPath, userPart + otherBlock);

  assert.equal(stripStaleGsdHookBlocks(userPart + otherBlock, { configDir }), userPart + otherBlock, 'another config dir\'s block is not stale here');
  assert.equal(parseTomlToObject(stripStaleGsdHookBlocks(userPart + hookBlock(configDir), { configDir })).hooks, undefined, 'this config dir\'s block is still removed');

  runCodexInstaller(root, configDir);

  const content = fs.readFileSync(configPath, 'utf8');
  assert.equal(content.slice(0, userPart.length + otherBlock.length), userPart + otherBlock, 'the other config dir\'s hook block is unchanged');
});

test('uninstall keeps the hooks feature fvgsd added while hooks.json still runs another SessionStart hook', (t) => {
  const { root, configDir } = tempCodexHome(t, 'foreign-session-start');
  const configPath = path.join(configDir, 'config.toml');
  const hooksJsonPath = path.join(configDir, 'hooks.json');
  const foreignHooks = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: gsdCheckUpdateCommand(configDir) }] }] } };
  fs.writeFileSync(configPath, 'model = "gpt-5"\n');
  fs.writeFileSync(hooksJsonPath, `${JSON.stringify(foreignHooks, null, 2)}\n`);

  runCodexInstaller(root, configDir);
  assert.equal(parseTomlToObject(fs.readFileSync(configPath, 'utf8')).features.hooks, true, 'install enables the hooks feature');

  runCodexInstaller(root, configDir, ['--uninstall']);

  assert.deepEqual(parseTomlToObject(fs.readFileSync(configPath, 'utf8')), { model: 'gpt-5', features: { hooks: true } });
  assert.deepEqual(JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')), foreignHooks);
});

test('uninstall removes the hooks feature fvgsd added when no other SessionStart hook remains', (t) => {
  const { root, configDir } = tempCodexHome(t, 'own-session-start');
  const configPath = path.join(configDir, 'config.toml');
  fs.writeFileSync(configPath, 'model = "gpt-5"\n');

  runCodexInstaller(root, configDir);
  assert.equal(parseTomlToObject(fs.readFileSync(configPath, 'utf8')).features.hooks, true, 'install enables the hooks feature');

  runCodexInstaller(root, configDir, ['--uninstall']);

  assert.deepEqual(parseTomlToObject(fs.readFileSync(configPath, 'utf8')), { model: 'gpt-5' });
});

test('uninstall keeps multi_agent, default_mode_request_user_input and their [features] table, which fvgsd never writes', (t) => {
  const { root, configDir } = tempCodexHome(t, 'user-feature-keys');
  const configPath = path.join(configDir, 'config.toml');
  const original = 'model = "gpt-5"\n\n[features]\nmulti_agent = true\ndefault_mode_request_user_input = true\n';
  fs.writeFileSync(configPath, original);

  runCodexInstaller(root, configDir);
  runCodexInstaller(root, configDir, ['--uninstall']);

  const content = fs.readFileSync(configPath, 'utf8');
  assert.deepEqual(parseTomlToObject(content), {
    model: 'gpt-5',
    features: { multi_agent: true, default_mode_request_user_input: true },
  });
  assert.equal(content, original);
});
