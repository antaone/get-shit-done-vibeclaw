'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const { ALLOWED_RUNTIMES } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
const { validateBuildSetting } = require('../get-shit-done/bin/lib/config.cjs');

const CAPABILITY_KEYS = [
  'spawn_agents', 'parallel_agents', 'worktree_isolation', 'per_call_model',
  'agent_effort', 'background_tasks', 'workflow_scripts',
];

function configPath(dir) {
  return path.join(dir, '.planning', 'config.json');
}

// One table drives both validation copies (ruling F5): config-set below runs
// through the CLI, which — once `sdk` is built — dispatches to the SDK copy
// of validateBuildSetting in sdk/src/query/config-mutation.ts via sdk/dist.
// The "validateBuildSetting parity" describe block calls the CJS copy in
// get-shit-done/bin/lib/config.cjs directly with the same coerced values.
// If the two copies ever disagree on one of these cases, one of the two
// blocks fails — they can't silently drift apart.
const BUILD_SETTING_CASES = [
  { key: 'workflow.build_mode', raw: 'false', expected: false, valid: true },
  { key: 'workflow.build_fix_rounds', raw: '0', expected: 0, valid: true },
  { key: 'workflow.build_fix_rounds', raw: '5', expected: 5, valid: true },
  { key: 'workflow.build_human_checks', raw: 'block', expected: 'block', valid: true },
  { key: 'workflow.build_code_review', raw: 'true', expected: true, valid: true },
  { key: 'workflow.build_parallel', raw: 'off', expected: 'off', valid: true },
  { key: 'workflow.build_engine', raw: 'workflow', expected: 'workflow', valid: true },
  { key: 'workflow.build_check_timeout_seconds', raw: '600', expected: 600, valid: true },
  { key: 'workflow.lint_command', raw: 'npm run lint', expected: 'npm run lint', valid: true },
  { key: 'workflow.typecheck_command', raw: 'npx tsc --noEmit', expected: 'npx tsc --noEmit', valid: true },
  { key: 'workflow.build_command', raw: 'make all', expected: 'make all', valid: true },
  { key: 'workflow.test_command', raw: 'make check', expected: 'make check', valid: true },
  { key: 'workflow.test_command', raw: 'off', expected: 'off', valid: true },
  { key: 'workflow.research', raw: 'on-gap', expected: 'on-gap', valid: true },
  { key: 'workflow.research', raw: 'false', expected: false, valid: true },
  { key: 'workflow.build_verify_report', raw: 'lite', expected: 'lite', valid: true },
  { key: 'workflow.extra_check_commands', raw: '["npm run test:db","make seed-check"]', expected: ['npm run test:db', 'make seed-check'], valid: true },
  { key: 'workflow.extra_check_commands', raw: '[]', expected: [], valid: true },
  { key: 'workflow.build_mode', raw: 'maybe', valid: false },
  { key: 'workflow.build_fix_rounds', raw: '6', valid: false },
  { key: 'workflow.build_fix_rounds', raw: '-1', valid: false },
  { key: 'workflow.build_fix_rounds', raw: '1.5', valid: false },
  { key: 'workflow.build_human_checks', raw: 'later', valid: false },
  { key: 'workflow.build_code_review', raw: 'yes', valid: false },
  { key: 'workflow.build_parallel', raw: 'on', valid: false },
  { key: 'workflow.build_engine', raw: 'script', valid: false },
  { key: 'workflow.build_check_timeout_seconds', raw: '0', valid: false },
  { key: 'workflow.lint_command', raw: '42', valid: false },
  { key: 'workflow.research', raw: 'sometimes', valid: false },
  { key: 'workflow.build_verify_report', raw: 'short', valid: false },
  { key: 'workflow.extra_check_commands', raw: 'npm run test:db', valid: false },
  { key: 'workflow.extra_check_commands', raw: '["npm test",""]', valid: false },
  { key: 'workflow.extra_check_commands', raw: '[1]', valid: false },
];

/**
 * Mirrors the CLI value coercion done by config-set (config.cjs cmdConfigSet
 * and config-mutation.ts parseConfigValue): booleans and numbers auto-parse,
 * everything else stays a string. Used so the parity block below can call
 * validateBuildSetting directly with the same value config-set would have
 * coerced from the same raw CLI argument.
 */
function coerceCliValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !isNaN(raw)) return Number(raw);
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch { /* keep as string */ }
  }
  return raw;
}

describe('build settings: config-set', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(configPath(tmpDir), `${JSON.stringify({ workflow: {} }, null, 2)}\n`);
  });

  afterEach(() => cleanup(tmpDir));

  for (const { key, raw, expected, valid } of BUILD_SETTING_CASES) {
    if (valid) {
      test(`accepts ${key} ${raw}`, () => {
        const result = runGsdTools(['config-set', key, raw], tmpDir, { HOME: tmpDir });
        assert.equal(result.success, true, result.error);
        const config = JSON.parse(fs.readFileSync(configPath(tmpDir), 'utf8'));
        assert.deepEqual(config.workflow[key.slice('workflow.'.length)], expected);
      });
    } else {
      test(`rejects ${key} ${raw} and leaves config.json unchanged`, () => {
        const before = fs.readFileSync(configPath(tmpDir));
        const result = runGsdTools(['config-set', key, raw], tmpDir, { HOME: tmpDir });
        assert.equal(result.success, false);
        assert.notEqual(result.exitCode, 0);
        assert.deepEqual(fs.readFileSync(configPath(tmpDir)), before);
      });
    }
  }
});

describe('build settings: validateBuildSetting parity with config-set', () => {
  for (const { key, raw, expected, valid } of BUILD_SETTING_CASES) {
    const coerced = valid ? expected : coerceCliValue(raw);
    test(`validateBuildSetting ${valid ? 'accepts' : 'rejects'} ${key} ${JSON.stringify(coerced)} (config-set raw "${raw}")`, () => {
      const message = validateBuildSetting(key, coerced);
      if (valid) {
        assert.equal(message, null);
      } else {
        assert.equal(typeof message, 'string');
        assert.notEqual(message.trim(), '');
      }
    });
  }
});

describe('build settings: validateBuildSetting in config.cjs', () => {
  const valid = [
    ['workflow.build_mode', false],
    ['workflow.build_fix_rounds', 0],
    ['workflow.build_fix_rounds', 5],
    ['workflow.build_human_checks', 'block'],
    ['workflow.build_parallel', 'auto'],
    ['workflow.build_engine', 'workflow'],
    ['workflow.build_check_timeout_seconds', 1],
    ['workflow.lint_command', ''],
    ['workflow.verifier', 'not a build setting'],
  ];

  for (const [key, value] of valid) {
    test(`returns null for ${key} ${JSON.stringify(value)}`, () => {
      assert.equal(validateBuildSetting(key, value), null);
    });
  }

  const invalid = [
    ['workflow.build_mode', 'true'],
    ['workflow.build_code_review', 1],
    ['workflow.build_fix_rounds', 6],
    ['workflow.build_fix_rounds', 1.5],
    ['workflow.build_human_checks', 'later'],
    ['workflow.build_parallel', 'on'],
    ['workflow.build_check_timeout_seconds', 0],
    ['workflow.test_command', 42],
  ];

  for (const [key, value] of invalid) {
    test(`returns a message for ${key} ${JSON.stringify(value)}`, () => {
      const message = validateBuildSetting(key, value);
      assert.equal(typeof message, 'string');
      assert.notEqual(message.trim(), '');
    });
  }
});

describe('build settings: runtime capability table', () => {
  const tablePath = path.join(__dirname, '..', 'sdk', 'shared', 'runtime-capabilities.json');

  test('has exactly one entry per installable runtime', () => {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    assert.deepEqual(Object.keys(table).sort(), [...ALLOWED_RUNTIMES].sort());
  });

  test('every entry has exactly the seven boolean switches', () => {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    for (const [runtime, entry] of Object.entries(table)) {
      assert.deepEqual(Object.keys(entry).sort(), [...CAPABILITY_KEYS].sort(), runtime);
      for (const key of CAPABILITY_KEYS) assert.equal(typeof entry[key], 'boolean', `${runtime}.${key}`);
    }
  });

  test('claude has every switch on', () => {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    for (const key of CAPABILITY_KEYS) assert.equal(table.claude[key], true, key);
  });
});
