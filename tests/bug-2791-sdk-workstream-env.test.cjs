/**
 * Regression test for bug #2791 (Issue 2 — query registry not workstream-aware)
 *
 * When FVGSD_WORKSTREAM is set in the environment, `fvgsd-sdk query` commands must
 * route .planning/ reads to `.planning/workstreams/<name>/` — matching the
 * behaviour of `fvgsd-tools.cjs` which reads the same env var via planningDir().
 *
 * Before the fix: the SDK CLI only respected `--ws <name>` flag; FVGSD_WORKSTREAM
 * was ignored, so `fvgsd-sdk query roadmap.analyze` always read the root
 * `.planning/ROADMAP.md` even when a workstream was active.
 *
 * After the fix: the SDK CLI falls back to FVGSD_WORKSTREAM when --ws is absent.
 *
 * This test also verifies:
 * - The `fvgsd-tools` bin alias maps to the same SDK shim as `fvgsd-sdk` (#2791 Issue 1)
 */

'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProc = require('node:child_process');
const { cleanup } = require('./helpers.cjs');
const os = require('node:os');

const REPO_ROOT = path.join(__dirname, '..');
const SDK_CLI = path.join(REPO_ROOT, 'sdk', 'dist', 'cli.js');
const PKG_JSON = path.join(REPO_ROOT, 'package.json');

function runSdkQuery(args, projectDir, extraEnv = {}) {
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = childProc.execFileSync(
      process.execPath,
      [SDK_CLI, 'query', ...args, '--project-dir', projectDir],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FVGSD_SESSION_KEY: '', ...extraEnv },
      }
    );
  } catch (err) {
    exitCode = err.status ?? 1;
    stdout = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
  }
  let json = null;
  try { json = JSON.parse(stdout.trim()); } catch { /* ok */ }
  return { exitCode, stdout, json };
}

describe('bug-2791: FVGSD_WORKSTREAM env var respected by fvgsd-sdk query', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-test-2791-'));
    // Create root .planning/ with a minimal config
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ mode: 'balanced' }));
    // Create workstream .planning/workstreams/my-ws/ with its own ROADMAP
    const wsDir = path.join(tmpDir, '.planning', 'workstreams', 'my-ws');
    fs.mkdirSync(path.join(wsDir, 'phases'), { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, 'config.json'),
      JSON.stringify({ mode: 'balanced' })
    );
    fs.writeFileSync(
      path.join(wsDir, 'STATE.md'),
      '---\nmilestone: v1.0\n---\n\n# GSD State\n\n**Current Phase:** 1\n'
    );
    fs.writeFileSync(
      path.join(wsDir, 'ROADMAP.md'),
      [
        '## Roadmap v1.0: Workstream Work',
        '',
        '### Phase 1: Workstream Phase',
        '**Goal:** Test workstream routing',
        '- [ ] Task A',
      ].join('\n')
    );
    // Also create a root ROADMAP that is intentionally empty of phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '## Roadmap v1.0: Root\n\n(no phases in root)\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '---\nmilestone: v1.0\n---\n\n# GSD State\n'
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('without FVGSD_WORKSTREAM: roadmap.analyze reads root .planning/ROADMAP.md', () => {
    const result = runSdkQuery(['roadmap.analyze'], tmpDir);
    assert.strictEqual(result.exitCode, 0, `expected exit 0: ${result.stdout}`);
    assert.ok(result.json !== null, 'expected JSON output');
    // Root ROADMAP has no phases
    assert.strictEqual(
      result.json.phase_count,
      0,
      `expected 0 phases from root ROADMAP, got ${result.json.phase_count}`
    );
  });

  test('with FVGSD_WORKSTREAM set: roadmap.analyze reads workstream ROADMAP.md', () => {
    const result = runSdkQuery(['roadmap.analyze'], tmpDir, { FVGSD_WORKSTREAM: 'my-ws' });
    assert.strictEqual(result.exitCode, 0, `expected exit 0: ${result.stdout}`);
    assert.ok(result.json !== null, 'expected JSON output');
    // Workstream ROADMAP has 1 phase
    assert.strictEqual(
      result.json.phase_count,
      1,
      `expected 1 phase from workstream ROADMAP, got ${result.json.phase_count}`
    );
  });

  test('--ws flag takes precedence over FVGSD_WORKSTREAM env var', () => {
    // Set FVGSD_WORKSTREAM to a non-existent workstream; --ws should override it.
    // This verifies flag-wins-over-env precedence, not just that --ws works.
    const result = runSdkQuery(['roadmap.analyze', '--ws', 'my-ws'], tmpDir, {
      FVGSD_WORKSTREAM: 'nonexistent-ws',
    });
    assert.strictEqual(result.exitCode, 0, `expected exit 0: ${result.stdout}`);
    assert.ok(result.json !== null, 'expected JSON output');
    // --ws my-ws should route to the workstream ROADMAP which has 1 phase,
    // proving the flag overrides the env var (nonexistent-ws has no phases).
    assert.strictEqual(
      result.json.phase_count,
      1,
      `expected 1 phase via --ws flag (overriding FVGSD_WORKSTREAM), got ${result.json.phase_count}`
    );
  });

  test('invalid FVGSD_WORKSTREAM value is silently ignored and falls back to root', () => {
    const result = runSdkQuery(['roadmap.analyze'], tmpDir, { FVGSD_WORKSTREAM: '../evil' });
    // Should not crash; invalid name is silently ignored and falls back to root ROADMAP.
    assert.strictEqual(result.exitCode, 0, `expected exit 0 (invalid FVGSD_WORKSTREAM ignored): ${result.stdout}`);
    assert.ok(result.json !== null, 'expected JSON output after invalid FVGSD_WORKSTREAM fallback');
    // Root ROADMAP has no phases — confirming root fallback, not an error path.
    assert.strictEqual(
      result.json.phase_count,
      0,
      `expected 0 phases from root ROADMAP fallback (invalid FVGSD_WORKSTREAM), got ${result.json.phase_count}`
    );
  });
});

describe('bug-2791: package.json declares fvgsd-tools bin alias (#2791 Issue 1)', () => {
  test('package.json bin has fvgsd-tools entry', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf-8'));
    assert.ok(
      Object.prototype.hasOwnProperty.call(pkg.bin ?? {}, 'fvgsd-tools'),
      'package.json bin must include "fvgsd-tools" to provide collision-free alternative to fvgsd-sdk'
    );
  });

  test('fvgsd-tools bin entry points to same file as fvgsd-sdk', () => {
    const pkg = JSON.parse(fs.readFileSync(PKG_JSON, 'utf-8'));
    assert.strictEqual(
      pkg.bin['fvgsd-tools'],
      pkg.bin['fvgsd-sdk'],
      'fvgsd-tools and fvgsd-sdk must point to the same bin shim'
    );
  });
});
