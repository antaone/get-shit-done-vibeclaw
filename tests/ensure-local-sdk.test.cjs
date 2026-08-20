'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { npmInvocation, ensureLocalSdk } = require('../scripts/ensure-local-sdk.cjs');

const projects = [];

describe('fresh-clone SDK preparation', () => {
  afterEach(() => {
    while (projects.length) cleanup(projects.pop());
  });

  function fixture() {
    const root = createTempDir('ensure-sdk-');
    projects.push(root);
    const sdk = path.join(root, 'sdk');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), '{}\n');
    fs.writeFileSync(path.join(sdk, 'package-lock.json'), '{}\n');
    return { root, sdk };
  }

  test('uses npm_execpath through the active Node runtime when available', () => {
    assert.deepEqual(
      npmInvocation(['ci'], { npm_execpath: '/tools/npm-cli.js' }),
      { program: process.execPath, args: ['/tools/npm-cli.js', 'ci'] },
    );
  });

  test('does nothing when the prebuilt SDK CLI already exists', () => {
    const { root, sdk } = fixture();
    fs.mkdirSync(path.join(sdk, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(sdk, 'dist', 'cli.js'), 'ready\n');
    let calls = 0;
    const result = ensureLocalSdk({ repoRoot: root, spawn: () => { calls += 1; return { status: 0 }; } });
    assert.equal(result.built, false);
    assert.equal(result.reason, 'sdk_dist_present');
    assert.equal(calls, 0);
  });

  test('installs nested dependencies and builds the SDK when dist is missing', () => {
    const { root, sdk } = fixture();
    const calls = [];
    const result = ensureLocalSdk({
      repoRoot: root,
      env: { ...process.env, npm_execpath: '/tools/npm-cli.js' },
      spawn: (program, args, options) => {
        calls.push({ program, args, cwd: options.cwd });
        if (args.includes('build')) {
          fs.mkdirSync(path.join(sdk, 'dist'), { recursive: true });
          fs.writeFileSync(path.join(sdk, 'dist', 'cli.js'), 'built\n');
        }
        return { status: 0 };
      },
    });
    assert.equal(result.built, true);
    assert.deepEqual(calls.map((call) => call.args.slice(-2)), [
      ['/tools/npm-cli.js', 'ci'],
      ['run', 'build'],
    ]);
    assert.ok(calls.every((call) => call.cwd === sdk));
  });
});
