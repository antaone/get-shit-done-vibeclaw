'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runGsdTools, createTempGitProject, cleanup } = require('./helpers.cjs');

describe('fvgsd-tools init build', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject('fvgsd-init-build-');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), ['# Roadmap', '', '### Phase 3: User Auth', '', '**Goal:** Users can sign in', ''].join('\n'));
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-user-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-CONTEXT.md'), '# Context\n');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-q', '-m', 'docs(03): context'], { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => cleanup(tmpDir));

  test('routes to the SDK init.build handler', () => {
    const result = runGsdTools(['init', 'build', '3'], tmpDir, { HOME: tmpDir });
    assert.ok(result.success, `init build failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_found, true);
    assert.strictEqual(output.resume.state, 'new');
    assert.strictEqual(output.resume.plan, '01');
  });
});
