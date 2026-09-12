// allow-test-rule: structural-regression-guard
// Name-safety guard: fvgsd's installed names must not contain the prefixes and
// substrings that the gsd and vgsd installers use to find their own entries.

'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { spawnSync } = require('node:child_process');

const { INSTALL_SCRIPT, RUNTIME_META, installerEnv } = require('./helpers/install-shared.cjs');
const { seedForeignInstalls, listFiles, snapshot } = require('./helpers/foreign-installs.cjs');
const MATCHERS = require('./fixtures/foreign-installer-matchers.json');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const installer = require('../bin/install.js');

const STRUCTURED = new Set(['settings.json', 'hooks.json', 'opencode.json', 'kilo.json', 'gsd-file-manifest.json', 'config.toml']);

function runInstaller(runtime, root, configDir, extra = []) {
  const r = spawnSync(process.execPath, [INSTALL_SCRIPT, `--${runtime}`, '--global', '--config-dir', configDir, ...extra], {
    cwd: root,
    encoding: 'utf8',
    env: installerEnv({ HOME: root, USERPROFILE: root }),
  });
  assert.equal(r.status, 0, `${runtime} ${extra.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
}

function parsed(configDir, rel) {
  const text = fs.readFileSync(path.join(configDir, rel), 'utf8');
  return rel === 'config.toml' ? installer.parseTomlToObject(text) : JSON.parse(text);
}

function hookCommands(settings) {
  const out = [];
  for (const entries of Object.values((settings && settings.hooks) || {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) if (typeof hook.command === 'string') out.push(hook.command);
    }
  }
  return out;
}

function matchesForeignInstaller(value) {
  const base = path.posix.basename(value.replace(/\\/g, '/'));
  return MATCHERS.fileNamePrefixes.some((prefix) => base.startsWith(prefix))
    || MATCHERS.hookCommandSubstrings.some((needle) => value.includes(needle))
    || MATCHERS.codexSectionPrefixes.some((prefix) => value.startsWith(prefix))
    || MATCHERS.permissionKeySubstrings.some((needle) => value.includes(needle));
}

describe('fvgsd installs next to gsd and vgsd', () => {
  for (const runtime of Object.keys(RUNTIME_META)) {
    test(`${runtime}: install and uninstall leave gsd and vgsd untouched`, { todo: 'passes after Task 9' }, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `${IDENTITY.tempPrefix}coexist-${runtime}-`));
      try {
        const configDir = path.join(root, 'config');
        const seeded = seedForeignInstalls(configDir, runtime);
        const plain = seeded.filter((rel) => !STRUCTURED.has(rel));
        const before = {
          files: listFiles(configDir),
          hashes: snapshot(configDir, plain),
          parsed: Object.fromEntries(seeded.filter((rel) => STRUCTURED.has(rel)).map((rel) => [rel, parsed(configDir, rel)])),
        };

        runInstaller(runtime, root, configDir);

        assert.deepEqual(snapshot(configDir, plain), before.hashes);
        assert.deepEqual(parsed(configDir, 'gsd-file-manifest.json'), before.parsed['gsd-file-manifest.json']);
        const settings = parsed(configDir, 'settings.json');
        assert.deepEqual(settings.statusLine, before.parsed['settings.json'].statusLine);
        const seededCommands = hookCommands(before.parsed['settings.json']);
        const commands = hookCommands(settings);
        for (const command of seededCommands) assert.equal(commands.includes(command), true, `lost ${command}`);

        const manifest = JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.manifestFile), 'utf8'));
        const owned = [...Object.keys(manifest.files), ...commands.filter((command) => !seededCommands.includes(command))];

        if (runtime === 'codex') {
          const config = parsed(configDir, 'config.toml');
          assert.deepEqual(config.agents['gsd-planner'], before.parsed['config.toml'].agents['gsd-planner']);
          owned.push(...Object.keys(config.agents).filter((name) => name !== 'gsd-planner').map((name) => `agents.${name}`));
          const layout = installer.codexConfigLayout(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
          const gsdMarker = layout.markers.find((marker) => marker.owner === 'gsd');
          const ownSections = layout.agentSections.filter((section) => section.name.startsWith(IDENTITY.agentPrefix));
          assert.equal(ownSections.length > 0, true);
          for (const section of ownSections) assert.equal(section.line < gsdMarker.line, true, `${section.name} is below the GSD marker`);
          const hooksJsonCommands = hookCommands(parsed(configDir, 'hooks.json'));
          for (const command of hookCommands(before.parsed['hooks.json'])) {
            assert.equal(hooksJsonCommands.includes(command), true, `hooks.json lost ${command}`);
          }
        }

        if (runtime === 'opencode' || runtime === 'kilo') {
          const config = parsed(configDir, `${runtime}.json`);
          const seededKeys = Object.keys(before.parsed[`${runtime}.json`].permission.read);
          for (const key of seededKeys) assert.equal(config.permission.read[key], 'allow');
          for (const table of Object.values(config.permission || {})) {
            owned.push(...Object.keys(table).filter((key) => !seededKeys.includes(key)));
          }
        }

        assert.deepEqual(owned.filter(matchesForeignInstaller), [], `${runtime}: fvgsd names collide with gsd/vgsd matchers`);

        runInstaller(runtime, root, configDir, ['--uninstall']);

        assert.deepEqual(listFiles(configDir), before.files);
        assert.deepEqual(snapshot(configDir, plain), before.hashes);
        for (const [rel, value] of Object.entries(before.parsed)) {
          assert.equal(isDeepStrictEqual(parsed(configDir, rel), value), true, `${rel} differs after uninstall`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
