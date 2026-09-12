/**
 * Regression test for bug #3360.
 *
 * Codex does not have a direct equivalent of Claude Code's
 * `Agent(... isolation="worktree")`. The execute-phase workflow must default
 * an unset Codex worktree setting to safe sequential execution, while still
 * failing closed for an explicit workflow.use_worktrees=true.
 */

'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXECUTE_PHASE = path.join(ROOT, 'get-shit-done', 'workflows', 'execute-phase.md');
const { getCodexSkillAdapterHeader, install } = require('../bin/install.js');
const { createTempDir, cleanup } = require('./helpers.cjs');

function parseWorkflowSteps(content) {
  return [...content.matchAll(/<step name="([^"]+)"[^>]*>([\s\S]*?)<\/step>/g)]
    .map((match) => {
      const body = match[2];
      return {
        name: match[1],
        readsInstalledRuntimeIdentity: body.includes('RUNTIME="${FVGSD_RUNTIME:-__FVGSD_RUNTIME__}"'),
        keepsSourceCheckoutFallback: body.includes('RUNTIME=$(fvgsd-sdk query config-get runtime --default claude'),
        detectsUnsetWorktreeConfig: body.includes('workflow.use_worktrees --default "__unset__"'),
        codexUnsetDefaultsSequential:
          body.includes('if [ "$RUNTIME" = "codex" ]; then') &&
          body.includes('USE_WORKTREES=false'),
        codexWorktreeGuard: body.includes('Codex execute-phase worktree isolation is unsupported'),
        worktreeDispatchGuidance: body.includes('isolation="worktree"'),
      };
    });
}

function executePhaseWorktreeContract(content) {
  const steps = parseWorkflowSteps(content);
  const initializeIndex = steps.findIndex((step) => step.name === 'initialize');
  const firstWorktreeDispatchIndex = steps.findIndex((step) => step.worktreeDispatchGuidance);
  assert.notEqual(initializeIndex, -1, 'workflow must have an initialize step');
  assert.notEqual(firstWorktreeDispatchIndex, -1, 'workflow must still document worktree dispatch guidance');

  const initialize = steps[initializeIndex];
  return {
    initializeReadsInstalledRuntimeIdentity: initialize.readsInstalledRuntimeIdentity,
    initializeKeepsSourceCheckoutFallback: initialize.keepsSourceCheckoutFallback,
    initializeDetectsUnsetWorktreeConfig: initialize.detectsUnsetWorktreeConfig,
    initializeDefaultsCodexUnsetToSequential: initialize.codexUnsetDefaultsSequential,
    initializeHasCodexWorktreeGuard: initialize.codexWorktreeGuard,
    guardStepPrecedesWorktreeDispatch: initializeIndex <= firstWorktreeDispatchIndex,
  };
}

function withRuntimeConfigDir(runtime, configDir, fn) {
  const key = runtime === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  const previous = process.env[key];
  process.env[key] = configDir;
  try {
    return fn();
  } finally {
    if (previous == null) delete process.env[key];
    else process.env[key] = previous;
  }
}

describe('#3360 — Codex execute-phase handles unsupported worktree isolation', { concurrency: false }, () => {
  test('execute-phase uses adapter runtime and defaults an unset Codex setting to sequential mode', () => {
    const workflow = fs.readFileSync(EXECUTE_PHASE, 'utf8');
    const contract = executePhaseWorktreeContract(workflow);

    assert.deepEqual(contract, {
      initializeReadsInstalledRuntimeIdentity: true,
      initializeKeepsSourceCheckoutFallback: true,
      initializeDetectsUnsetWorktreeConfig: true,
      initializeDefaultsCodexUnsetToSequential: true,
      initializeHasCodexWorktreeGuard: true,
      guardStepPrecedesWorktreeDispatch: true,
    });
  });

  test('installed Codex and Claude workflows carry their adapter runtime identity', (t) => {
    for (const runtime of ['codex', 'claude']) {
      const configDir = createTempDir(`fvgsd-3360-${runtime}-`);
      t.after(() => cleanup(configDir));
      withRuntimeConfigDir(runtime, configDir, () => install(true, runtime));

      const installedWorkflow = path.join(
        configDir,
        'get-shit-done',
        'workflows',
        'execute-phase.md',
      );
      const content = fs.readFileSync(installedWorkflow, 'utf8');
      const expectedRuntimeIdentity = `RUNTIME="\${FVGSD_RUNTIME:-${runtime}}"`;
      assert.ok(
        content.includes(expectedRuntimeIdentity),
        `${runtime} workflow did not receive its installed runtime identity`,
      );
      assert.doesNotMatch(content, /__FVGSD_RUNTIME__/);
    }
  });

  test('Codex adapter documents that worktree isolation has no direct spawn_agent mapping', () => {
    const header = getCodexSkillAdapterHeader('fvgsd-execute-phase');
    assert.match(header, /isolation="worktree"/);
    assert.match(header, /no direct Codex mapping/i);
  });
});
