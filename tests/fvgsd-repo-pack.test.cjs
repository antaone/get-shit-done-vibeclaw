'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const { validatePackSetting } = require('../get-shit-done/bin/lib/config.cjs');

function configPath(dir) {
  return path.join(dir, '.planning', 'config.json');
}

// Same idea as BUILD_SETTING_CASES in fvgsd-build-settings.test.cjs: config-set
// runs the SDK copy of validatePackSetting (once sdk/dist is built), and the
// parity block calls the CJS copy with the value config-set would have parsed.
const DEPLOY = {
  dev: { kind: 'github', workflows: ['deploy'], after_checks: ['npm run smoke'] },
  prod: { kind: 'command', command: 'make deploy-prod', needs_owner: true, notes: 'owner gate first' },
};
const PACK_CASES = [
  { key: 'pack.name', raw: 'demo-app', expected: 'demo-app', valid: true },
  { key: 'pack.candidates', raw: 'quick-{date}-{slug}', expected: 'quick-{date}-{slug}', valid: true },
  { key: 'pack.message_prefix', raw: 'demo-app:', expected: 'demo-app:', valid: true },
  { key: 'pack.handoff_path', raw: 'notes/handoff.md', expected: 'notes/handoff.md', valid: true },
  { key: 'pack.deploy', raw: JSON.stringify(DEPLOY), expected: DEPLOY, valid: true },
  { key: 'pack.migrations', raw: '{"dir":"db/migrations","scheme":"NNNN_name","lock_timeout":true}', expected: { dir: 'db/migrations', scheme: 'NNNN_name', lock_timeout: true }, valid: true },
  { key: 'pack.name', raw: '42', valid: false },
  { key: 'pack.deploy', raw: '{}', valid: false },
  { key: 'pack.deploy', raw: '{"dev":{"kind":"ftp"}}', valid: false },
  { key: 'pack.deploy', raw: '{"dev":{"kind":"github"}}', valid: false },
  { key: 'pack.deploy', raw: '{"dev":{"kind":"command"}}', valid: false },
  { key: 'pack.deploy', raw: '{"dev":{"kind":"command","command":"x","region":"eu"}}', valid: false },
  { key: 'pack.deploy', raw: '{"Dev":{"kind":"command","command":"x"}}', valid: false },
  { key: 'pack.deploy', raw: '{"prod":{"kind":"command","command":"x","needs_owner":"yes"}}', valid: false },
  { key: 'pack.migrations', raw: '{"scheme":"NNNN"}', valid: false },
  { key: 'pack.migrations', raw: '{"dir":"db","tool":"flyway"}', valid: false },
  { key: 'pack.unknown', raw: 'x', valid: false },
];

function readKey(config, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), config);
}

describe('repo pack: config-set', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(configPath(tmpDir), `${JSON.stringify({ workflow: {} }, null, 2)}\n`);
  });

  afterEach(() => cleanup(tmpDir));

  for (const { key, raw, expected, valid } of PACK_CASES) {
    if (valid) {
      test(`accepts ${key} ${raw}`, () => {
        const result = runGsdTools(['config-set', key, raw], tmpDir, { HOME: tmpDir });
        assert.equal(result.success, true, result.error);
        assert.deepEqual(readKey(JSON.parse(fs.readFileSync(configPath(tmpDir), 'utf8')), key), expected);
      });
    } else {
      test(`rejects ${key} ${raw} and leaves config.json unchanged`, () => {
        const before = fs.readFileSync(configPath(tmpDir));
        const result = runGsdTools(['config-set', key, raw], tmpDir, { HOME: tmpDir });
        assert.equal(result.success, false);
        assert.deepEqual(fs.readFileSync(configPath(tmpDir)), before);
      });
    }
  }

  test('a pack section is a known top-level key: no unknown-key warning on load', () => {
    fs.writeFileSync(configPath(tmpDir), JSON.stringify({ workflow: {}, pack: { name: 'demo-app' } }));
    const result = runGsdTools(['config-get', 'pack.name'], tmpDir, { HOME: tmpDir });
    assert.equal(result.success, true, result.error);
    assert.match(result.output, /demo-app/);
    assert.doesNotMatch(result.error || '', /unknown|unrecognized/i);
  });
});

describe('repo pack: validatePackSetting parity with config-set', () => {
  for (const { key, raw, expected, valid } of PACK_CASES) {
    if (key === 'pack.unknown') continue; // rejected by the key check, not the value check
    let coerced = valid ? expected : raw;
    if (!valid && /^[[{]/.test(raw)) coerced = JSON.parse(raw);
    if (!valid && raw !== '' && !isNaN(raw)) coerced = Number(raw);
    test(`validatePackSetting ${valid ? 'accepts' : 'rejects'} ${key} ${raw}`, () => {
      const message = validatePackSetting(key, coerced);
      if (valid) assert.equal(message, null);
      else assert.match(message, /\S/);
    });
  }

  test('returns null for keys outside pack', () => {
    assert.equal(validatePackSetting('workflow.research', 'anything'), null);
  });
});
