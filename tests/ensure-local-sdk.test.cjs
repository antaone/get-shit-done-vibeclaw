'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const {
  npmInvocation,
  ensureLocalSdk,
  parseArgs,
  sdkBuildFingerprint,
  SDK_TSCONFIG,
} = require('../scripts/ensure-local-sdk.cjs');

const projects = [];
const REPO_SDK = path.join(__dirname, '..', 'sdk');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('local SDK preparation', () => {
  afterEach(() => {
    while (projects.length) cleanup(projects.pop());
  });

  function fixture() {
    const root = createTempDir('ensure-sdk-');
    projects.push(root);
    const sdk = path.join(root, 'sdk');
    write(path.join(sdk, 'package.json'), '{}\n');
    write(path.join(sdk, 'package-lock.json'), '{}\n');
    write(path.join(sdk, 'tsconfig.json'), '{}\n');
    write(path.join(sdk, 'src', 'cli.ts'), 'export {};\n');
    return { root, sdk, cli: path.join(sdk, 'dist', 'cli.js'), stamp: path.join(sdk, 'dist', '.build-fingerprint') };
  }

  /** Runs ensureLocalSdk with a stubbed npm; `build` writes dist/cli.js unless `buildStatus` fails it. */
  function prepare(project, { env = {}, force = false, buildStatus = 0 } = {}) {
    const calls = [];
    const lines = [];
    const result = ensureLocalSdk({
      repoRoot: project.root,
      force,
      env: { npm_execpath: '/tools/npm-cli.js', ...env },
      log: (line) => lines.push(line),
      spawn: (program, args, options) => {
        calls.push({ program, args, cwd: options.cwd });
        if (!args.includes('build')) return { status: 0 };
        if (buildStatus === 0) write(project.cli, 'built\n');
        return { status: buildStatus };
      },
    });
    return { result, calls: calls.map((call) => call.args.slice(1)), cwds: calls.map((call) => call.cwd), lines };
  }

  function readStamp(project) {
    return fs.existsSync(project.stamp) ? fs.readFileSync(project.stamp, 'utf8').trim() : null;
  }

  test('uses npm_execpath through the active Node runtime when available', () => {
    assert.deepEqual(
      npmInvocation(['ci'], { npm_execpath: '/tools/npm-cli.js' }),
      { program: process.execPath, args: ['/tools/npm-cli.js', 'ci'] },
    );
  });

  test('installs nested dependencies, builds the SDK and records its fingerprint when dist is missing', () => {
    const project = fixture();
    const { result, calls, cwds, lines } = prepare(project);
    assert.deepEqual(result, { built: true, reason: 'sdk_dist_built', trigger: 'dist_missing', cli: project.cli });
    assert.deepEqual(calls, [['ci'], ['run', 'build']]);
    assert.ok(cwds.every((cwd) => cwd === project.sdk));
    assert.deepEqual(lines, ['Building the local GSD SDK (sdk/dist/cli.js is missing)...\n']);
    assert.equal(readStamp(project), sdkBuildFingerprint(project.sdk));
  });

  test('does nothing when the built SDK matches its recorded fingerprint', () => {
    const project = fixture();
    prepare(project);
    const { result, calls, lines } = prepare(project);
    assert.deepEqual(result, { built: false, reason: 'sdk_dist_current', cli: project.cli });
    assert.deepEqual(calls, []);
    assert.deepEqual(lines, []);
  });

  test('rebuilds when the SDK inputs changed since the recorded build', () => {
    const project = fixture();
    prepare(project);
    const before = readStamp(project);
    write(path.join(project.sdk, 'src', 'cli.ts'), 'export const query = true;\n');
    const { result, calls } = prepare(project);
    assert.deepEqual(result, { built: true, reason: 'sdk_dist_built', trigger: 'fingerprint_changed', cli: project.cli });
    assert.deepEqual(calls, [['ci'], ['run', 'build']]);
    assert.notEqual(readStamp(project), before);
    assert.equal(readStamp(project), sdkBuildFingerprint(project.sdk));
  });

  test('rebuilds a dist built before fingerprints existed once, then keeps it', () => {
    const project = fixture();
    write(project.cli, 'built by an earlier clone\n');
    assert.deepEqual(prepare(project).result, { built: true, reason: 'sdk_dist_built', trigger: 'fingerprint_missing', cli: project.cli });
    assert.deepEqual(prepare(project).calls, []);
  });

  test('still skips when FVGSD_SKIP_LOCAL_SDK_BUILD=1', () => {
    const project = fixture();
    const skipped = prepare(project, { env: { FVGSD_SKIP_LOCAL_SDK_BUILD: '1' } });
    assert.deepEqual(skipped.result, { built: false, reason: 'explicitly_skipped', cli: project.cli });
    assert.deepEqual(skipped.calls, []);
    assert.equal(readStamp(project), null);
  });

  test('--force builds and records the fingerprint even when the SDK is current or skipping is requested', () => {
    const project = fixture();
    prepare(project);
    const { result, calls, lines } = prepare(project, { force: true, env: { FVGSD_SKIP_LOCAL_SDK_BUILD: '1' } });
    assert.deepEqual(result, { built: true, reason: 'sdk_dist_built', trigger: 'forced', cli: project.cli });
    assert.deepEqual(calls, [['ci'], ['run', 'build']]);
    assert.deepEqual(lines, ['Building the local GSD SDK (requested)...\n']);
    assert.equal(readStamp(project), sdkBuildFingerprint(project.sdk));
    assert.deepEqual(parseArgs(['--force']), { force: true });
    assert.deepEqual(parseArgs([]), { force: false });
    assert.throws(() => parseArgs(['--fast']), /unknown argument: --fast/);
  });

  test('leaves no fingerprint behind when the build fails, so the next run builds again', () => {
    const project = fixture();
    prepare(project);
    write(path.join(project.sdk, 'src', 'cli.ts'), 'export const broken = ;\n');
    assert.throws(() => prepare(project, { buildStatus: 2 }), /npm run build failed/);
    assert.equal(readStamp(project), null);
    assert.equal(prepare(project).result.built, true);
  });

  test('fingerprints the tsc build inputs and nothing else', () => {
    const project = fixture();
    write(path.join(project.sdk, 'src', 'query', 'nested.ts'), 'export const a = 1;\n');
    const before = sdkBuildFingerprint(project.sdk);
    const ignored = {
      'dist/cli.js': 'rebuilt\n',
      'dist/.build-fingerprint': 'stale\n',
      'node_modules/pkg/index.ts': 'export {};\n',
      'src/cli.test.ts': 'test\n',
      'src/query/nested.integration.test.ts': 'test\n',
      'src/golden/fixture.json': '{}\n',
      'scripts/generate.ts': 'export {};\n',
    };
    for (const [rel, content] of Object.entries(ignored)) write(path.join(project.sdk, rel), content);
    assert.equal(sdkBuildFingerprint(project.sdk), before);

    for (const rel of ['package.json', 'package-lock.json', 'tsconfig.json', 'src/query/nested.ts']) {
      const file = path.join(project.sdk, rel);
      const original = fs.readFileSync(file);
      fs.writeFileSync(file, Buffer.concat([original, Buffer.from(' ')]));
      assert.notEqual(sdkBuildFingerprint(project.sdk), before, `${rel} should count as a build input`);
      fs.writeFileSync(file, original);
    }
    assert.equal(sdkBuildFingerprint(project.sdk), before);
    write(path.join(project.sdk, 'src', 'added.ts'), 'export {};\n');
    assert.notEqual(sdkBuildFingerprint(project.sdk), before);
  });

  test('covers what the SDK build compiles: plain tsc with sdk/tsconfig.json', () => {
    const tsconfigs = fs.readdirSync(REPO_SDK).filter((name) => name.startsWith('tsconfig') && name.endsWith('.json'));
    assert.deepEqual(tsconfigs, ['tsconfig.json']);
    const tsconfig = JSON.parse(fs.readFileSync(path.join(REPO_SDK, 'tsconfig.json'), 'utf8'));
    assert.deepEqual(
      { include: tsconfig.include, exclude: tsconfig.exclude, files: tsconfig.files, extends: tsconfig.extends, references: tsconfig.references },
      { ...SDK_TSCONFIG, files: undefined, extends: undefined, references: undefined },
    );
    const sdkPackage = JSON.parse(fs.readFileSync(path.join(REPO_SDK, 'package.json'), 'utf8'));
    assert.equal(sdkPackage.scripts.build, 'tsc');
    const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(rootPackage.scripts['build:sdk'], 'node scripts/ensure-local-sdk.cjs --force');
    assert.equal(rootPackage.scripts.prepare, 'node scripts/ensure-local-sdk.cjs');
  });
});
