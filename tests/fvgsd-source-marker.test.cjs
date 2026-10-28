'use strict';

// The installed surface engine lives in <config>/fvgsd/bin/lib, where walking up
// never reaches commands/gsd. It must find the clone through the JSON record the
// installer writes beside it, <config>/fvgsd/.fvgsd-source, while an engine run
// from a clone (the installer itself) keeps using its own tree.

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const clone = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');

const LIB_DIR = path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib');
const CLONE_COMMANDS = path.join(__dirname, '..', 'commands', 'gsd');

describe('install source markers', () => {
  let tmp;
  let config;
  let repo;
  let installed;

  beforeEach(() => {
    tmp = createTempDir('fvgsd-source-marker-');
    config = path.join(tmp, 'config');
    repo = path.join(tmp, 'clone');
    fs.mkdirSync(path.join(repo, 'commands', 'gsd'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'agents'), { recursive: true });
    const installedLib = path.join(config, 'fvgsd', 'bin', 'lib');
    fs.cpSync(LIB_DIR, installedLib, { recursive: true });
    installed = require(path.join(installedLib, 'runtime-artifact-layout.cjs'));
  });

  afterEach(() => cleanup(tmp));

  function writeRecord(record) {
    fs.writeFileSync(path.join(config, 'fvgsd', '.fvgsd-source'), typeof record === 'string' ? record : JSON.stringify(record));
  }

  test('an installed engine without a record cannot find commands/gsd', () => {
    assert.throws(() => installed.findInstallSourceRoot(config), /could not locate commands\/gsd/);
  });

  test("an installed engine reads the installer's record for commands and agents", () => {
    writeRecord({ repo, remote: null, commit: null, runtimes: ['claude'], scope: 'global' });
    assert.equal(installed.findInstallSourceRoot(config), path.join(repo, 'commands', 'gsd'));
    assert.equal(installed.findAgentsSourceRoot(config), path.join(repo, 'agents'));
  });

  test('the plain marker in the config dir still wins', () => {
    const other = path.join(tmp, 'other', 'commands', 'gsd');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(config, '.fvgsd-source'), other);
    writeRecord({ repo });
    assert.equal(installed.findInstallSourceRoot(config), other);
  });

  test('a record for a missing clone or malformed JSON is ignored', () => {
    writeRecord({ repo: path.join(tmp, 'gone') });
    assert.throws(() => installed.findInstallSourceRoot(config), /could not locate commands\/gsd/);
    writeRecord('{not json');
    assert.throws(() => installed.findInstallSourceRoot(config), /could not locate commands\/gsd/);
  });

  test("an installed engine loads the clone's installer for its rewrites", () => {
    const staged = path.join(tmp, 'staged', 'fvgsd-demo');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'SKILL.md'), 'guard --runtime __FVGSD_RUNTIME__\n');
    const layout = { runtime: 'claude', configDir: config, scope: 'global', kinds: [] };
    assert.throws(() => installed.rewriteStagedArtifacts(layout, path.dirname(staged)), /Cannot find module/);
    writeRecord({ repo: path.join(__dirname, '..') });
    installed.rewriteStagedArtifacts(layout, path.dirname(staged));
    assert.equal(fs.readFileSync(path.join(staged, 'SKILL.md'), 'utf8'), 'guard --runtime claude\n');
  });

  test("an engine run from a clone ignores an earlier install's record and uses its own tree", () => {
    writeRecord({ repo });
    assert.equal(clone.findInstallSourceRoot(config), CLONE_COMMANDS);
    assert.equal(clone.findAgentsSourceRoot(config), path.join(__dirname, '..', 'agents'));
  });
});
