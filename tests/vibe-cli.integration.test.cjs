'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createTempGitProject, cleanup } = require('./helpers.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'vibe.js');
const projects = [];

function run(project, args) {
  return execFileSync(process.execPath, [CLI, ...args, '--project', project, '--json'], {
    cwd: project,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

describe('vibe CLI machine-readable surface', () => {
  afterEach(() => {
    while (projects.length) cleanup(projects.pop());
  });

  test('supports init, run, prepare, context, candidates, status, and history as JSON', () => {
    const project = createTempGitProject('vibe-cli-');
    projects.push(project);
    const initialized = JSON.parse(run(project, ['init']));
    assert.equal(initialized.initialized, true);

    const workflowRun = JSON.parse(run(project, ['run', 'start', 'feature-development', '--id', 'cli-001']));
    assert.equal(workflowRun.id, 'cli-001');

    const prepared = JSON.parse(run(project, ['stage', 'prepare', 'research', '--tool', 'codex']));
    assert.equal(prepared.candidate.tool.id, 'codex');
    const candidateId = prepared.candidate.id;

    const context = JSON.parse(run(project, ['context', candidateId]));
    assert.equal(context.candidate_id, candidateId);
    assert.equal(context.stage.id, 'research');
    assert.equal(context.base_commit, prepared.candidate.git.base_commit);

    const candidates = JSON.parse(run(project, ['candidates', 'research']));
    assert.deepEqual(candidates.map((candidate) => candidate.id), [candidateId]);

    const status = JSON.parse(run(project, ['status']));
    assert.equal(status.run.id, 'cli-001');
    assert.equal(status.stages[0].candidates[0].id, candidateId);

    const history = JSON.parse(run(project, ['history', '--run', 'cli-001']));
    assert.ok(history.some((event) => event.type === 'run.started'));
    assert.ok(history.some((event) => event.type === 'candidate.prepared'));
  });

  test('returns structured JSON errors with a non-zero exit code', () => {
    const project = createTempGitProject('vibe-cli-error-');
    projects.push(project);
    run(project, ['init']);
    run(project, ['run', 'start', 'feature-development', '--id', 'cli-error']);
    const result = spawnSync(process.execPath, [
      CLI, 'stage', 'prepare', 'research', '--tool', 'not-real', '--project', project, '--json',
    ], { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 2);
    const error = JSON.parse(result.stderr.trim());
    assert.equal(error.error, 'TOOL_UNKNOWN');
    assert.match(error.message, /Unknown tool/);
  });

  test('routes quick and debug commands through generated entry workflows', () => {
    const project = createTempGitProject('vibe-cli-entry-');
    projects.push(project);

    const inspected = JSON.parse(run(project, ['entry', 'inspect', 'quick']));
    assert.equal(inspected.action, 'choose-mode');
    assert.equal(inspected.workflow, 'quick-workflow');

    const prepared = JSON.parse(run(project, [
      'entry', 'prepare', 'quick', '--id', 'quick-cli', '--tool', 'codex', '--tool', 'claude',
    ]));
    assert.equal(prepared.run.id, 'quick-cli');
    assert.equal(prepared.candidates.length, 2);
    assert.deepEqual(prepared.candidates.map((candidate) => candidate.tool), ['codex', 'claude']);

    const debug = JSON.parse(run(project, [
      'entry', 'prepare', 'debug', '--id', 'debug-cli', '--tool', 'codex',
    ]));
    assert.equal(debug.workflow, 'debug-workflow');
    assert.equal(debug.candidates[0].invocation, '$vgsd-debug');
  });
});
