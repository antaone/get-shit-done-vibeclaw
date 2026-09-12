'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTempGitProject, cleanup } = require('./helpers.cjs');
const {
  VibeOrchestrator,
  VibeStore,
  VibeError,
  parseYaml,
  stringifyYaml,
} = require('../get-shit-done/bin/lib/vibe/index.cjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function expectCode(code) {
  return (error) => error instanceof VibeError && error.code === code;
}

function commitCandidate(candidate, content, filename = 'implementation.txt') {
  fs.writeFileSync(path.join(candidate.git.worktree, filename), content, 'utf8');
  git(candidate.git.worktree, 'add', '--', filename);
  git(candidate.git.worktree, 'commit', '-m', `candidate ${candidate.id}`);
  return git(candidate.git.worktree, 'rev-parse', 'HEAD');
}

describe('VibeClaw orchestration core', () => {
  let project;
  let vibe;

  beforeEach(() => {
    project = createTempGitProject('vibe-core-');
    vibe = new VibeOrchestrator({ projectRoot: project });
    vibe.initialize();
  });

  afterEach(() => cleanup(project));

  test('initializes a separate state store with valid routes and workflow contracts', () => {
    assert.ok(fs.existsSync(path.join(project, '.planning-fvgsd-vibe', 'config.yaml')));
    assert.ok(fs.existsSync(path.join(project, '.planning-fvgsd-vibe', 'routes', 'cheap.yaml')));
    assert.ok(fs.existsSync(path.join(project, '.planning-fvgsd-vibe', 'workflows', 'feature-development.yaml')));
    assert.ok(fs.existsSync(path.join(project, '.planning-fvgsd-vibe', 'workflows', 'project-bootstrap.yaml')));
    assert.ok(fs.existsSync(path.join(project, '.planning-fvgsd-vibe', 'workflows', 'milestone-bootstrap.yaml')));
    assert.equal(vibe.loadConfig().default_route, 'cheap');
    assert.deepEqual(vibe.listRoutes().map((route) => route.name), ['cheap', 'quality']);
    assert.deepEqual(
      vibe.listWorkflows().map((workflow) => workflow.name),
      ['feature-development', 'milestone-bootstrap', 'project-bootstrap'],
    );
    assert.equal(vibe.loadWorkflow('feature-development').stages.execute.mutates_source, true);
    assert.equal(vibe.loadWorkflow('project-bootstrap').stages.project.gsd.command, 'fvgsd:new-project');
    assert.equal(vibe.loadWorkflow('milestone-bootstrap').stages.milestone.gsd.command, 'fvgsd:new-milestone');
    const excludePath = git(project, 'rev-parse', '--git-path', 'info/exclude');
    const absoluteExclude = path.isAbsolute(excludePath) ? excludePath : path.resolve(project, excludePath);
    assert.match(fs.readFileSync(absoluteExclude, 'utf8'), /^\.fvgsd-vibe\/$/m);
  });

  test('YAML subset round-trips nested route data without a runtime dependency', () => {
    const input = {
      version: 1,
      name: 'custom',
      stages: { research: { tool: 'gemini' }, execute: { tool: 'codex' } },
      flags: ['one', 'two'],
    };
    assert.deepEqual(parseYaml(stringifyYaml(input)), input);
    assert.deepEqual(parseYaml(stringifyYaml({ empty_list: [], empty_map: {} })), {
      empty_list: [],
      empty_map: {},
    });
  });

  test('loads, selects, and validates routes while allowing explicit tool overrides', () => {
    assert.equal(vibe.useRoute('quality').name, 'quality');
    assert.equal(vibe.loadConfig().default_route, 'quality');
    assert.throws(() => vibe.loadRoute('missing'), expectCode('STATE_NOT_FOUND'));

    const run = vibe.startRun('feature-development', { id: 'route-check' });
    const prepared = vibe.prepareStage('research', { runId: run.id, tool: 'codex' });
    assert.equal(prepared.candidate.tool.id, 'codex');
    assert.equal(prepared.candidate.tool.selection, 'explicit');
    const environmentSelected = vibe.prepareStage('research', { runId: run.id, env: { VIBE_TOOL: 'claude' } });
    assert.equal(environmentSelected.candidate.tool.id, 'claude');
    assert.equal(environmentSelected.candidate.tool.selection, 'environment');
    assert.throws(
      () => vibe.prepareStage('research', { runId: run.id, tool: 'unknown-tool' }),
      expectCode('TOOL_UNKNOWN'),
    );
    fs.writeFileSync(path.join(project, '.planning-fvgsd-vibe', 'routes', 'invalid.yaml'), [
      'version: 1',
      'name: invalid',
      'stages:',
      '  execute:',
      '    tool: not-real',
      '',
    ].join('\n'), 'utf8');
    assert.throws(() => vibe.loadRoute('invalid'), expectCode('TOOL_UNKNOWN'));
  });

  test('creates, resumes, and inspects workflow runs with immutable snapshots', () => {
    const run = vibe.startRun('feature-development', { id: 'feature-014' });
    assert.equal(run.id, 'feature-014');
    assert.equal(run.workflow, 'feature-development');
    assert.equal(run.route, 'cheap');
    assert.equal(run.base_commit, git(project, 'rev-parse', 'HEAD'));
    assert.ok(run.workflow_snapshot.stages.execute);
    assert.ok(run.route_snapshot.stages.execute);
    assert.equal(vibe.resumeRun(run.id).id, run.id);
    assert.equal(vibe.loadRun().id, run.id);
    assert.deepEqual(vibe.listRuns().map((item) => item.id), ['feature-014']);
    assert.throws(() => vibe.startRun('feature-development', { id: run.id }), expectCode('RUN_EXISTS'));
    fs.writeFileSync(path.join(project, 'new-head.txt'), 'new head\n', 'utf8');
    git(project, 'add', '--', 'new-head.txt');
    git(project, 'commit', '-m', 'advance integration head');
    assert.throws(
      () => vibe.startRun('feature-development', { id: 'historical-base', base: run.base_commit }),
      expectCode('RUN_BASE_MISMATCH'),
    );
  });

  test('allocates unique isolated candidates from the same exact base without auto-promotion', () => {
    const run = vibe.startRun('feature-development', { id: 'parallel-001' });
    const one = vibe.prepareStage('research', { tool: 'gemini' }).candidate;
    const two = vibe.prepareStage('research', { tool: 'codex' }).candidate;

    assert.notEqual(one.id, two.id);
    assert.notEqual(one.git.branch, two.git.branch);
    assert.notEqual(one.git.worktree, two.git.worktree);
    assert.equal(one.git.base_commit, run.base_commit);
    assert.equal(two.git.base_commit, run.base_commit);
    assert.ok(fs.existsSync(one.git.worktree));
    assert.ok(fs.existsSync(two.git.worktree));
    assert.equal(vibe.loadRun().promotions.research, undefined);
    assert.equal(one.promotion.status, 'candidate');
    assert.equal(two.promotion.status, 'candidate');
  });

  test('normalizes complete repository-backed context for tools and manual operators', () => {
    vibe.startRun('feature-development', { id: 'context-001' });
    const prepared = vibe.prepareStage('research');
    const context = vibe.context(prepared.candidate.id);
    assert.equal(context.candidate_id, prepared.candidate.id);
    assert.equal(context.run.id, 'context-001');
    assert.equal(context.workflow.name, 'feature-development');
    assert.equal(context.stage.id, 'research');
    assert.equal(context.tool.id, 'gemini');
    assert.equal(context.base_commit, prepared.candidate.git.base_commit);
    assert.equal(context.branch, prepared.candidate.git.branch);
    assert.equal(context.worktree, prepared.candidate.git.worktree);
    assert.equal(context.responsibility, 'candidate');
    assert.equal(context.gsd.invocation, '/fvgsd:plan-phase');
    assert.match(fs.readFileSync(context.context_file, 'utf8'), /VibeClaw Stage Context/);
    assert.match(fs.readFileSync(context.context_file, 'utf8'), /## Assignment/);
  });

  test('renders the assigned GSD command in each tool-native fvgsd form', () => {
    vibe.startRun('project-bootstrap', { id: 'project-context' });
    const gemini = vibe.context(vibe.prepareStage('project', { tool: 'gemini' }).candidate.id);
    const codex = vibe.context(vibe.prepareStage('project', { tool: 'codex' }).candidate.id);
    const claude = vibe.context(vibe.prepareStage('project', { tool: 'claude' }).candidate.id);

    assert.equal(gemini.gsd.invocation, '/fvgsd:new-project');
    assert.equal(codex.gsd.invocation, '$fvgsd-new-project');
    assert.equal(claude.gsd.invocation, '/fvgsd-new-project');
  });

  test('completion captures provenance and metrics but remains unpromoted', () => {
    vibe.startRun('feature-development', { id: 'complete-001' });
    const candidate = vibe.prepareStage('research').candidate;
    const artifact = path.join(candidate.git.worktree, '.planning', 'research.md');
    fs.writeFileSync(artifact, '# Research\n', 'utf8');
    const completed = vibe.completeCandidate(candidate.id, {
      summary: 'Research complete.',
      artifacts: ['.planning/research.md'],
      estimatedCost: 0.25,
      inputTokens: 100,
      outputTokens: 50,
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.promotion.status, 'candidate');
    assert.equal(completed.git.result_commit, completed.git.base_commit);
    assert.equal(completed.outputs.artifacts.length, 1);
    assert.equal(completed.metrics.estimated_cost, 0.25);
    assert.equal(vibe.loadRun().promotions.research, undefined);
    const cleaned = vibe.cleanup(completed.id);
    assert.equal(cleaned.worktree_removed, true);
    assert.equal(cleaned.persisted_artifacts_preserved, true);
  });

  test('next stage consumes the promoted candidate and integration commit', () => {
    vibe.startRun('feature-development', { id: 'input-001' });
    const research = vibe.prepareStage('research').candidate;
    vibe.completeCandidate(research.id, { summary: 'Research complete.' });
    const promotion = vibe.promote(research.id);
    assert.equal(vibe.next().stage, 'plan');
    const plan = vibe.prepareStage('plan').candidate;
    assert.equal(plan.input.stage, 'research');
    assert.equal(plan.input.candidate_id, research.id);
    assert.equal(plan.git.base_commit, promotion.integration_commit);
  });

  test('rejects uncommitted candidate work and forbidden source mutation in non-source stages', () => {
    vibe.startRun('feature-development', { id: 'contract-001' });
    const dirty = vibe.prepareStage('research', { tool: 'gemini' }).candidate;
    fs.writeFileSync(path.join(dirty.git.worktree, 'dirty.txt'), 'dirty', 'utf8');
    assert.throws(() => vibe.completeCandidate(dirty.id, { summary: 'No.' }), expectCode('WORKTREE_DIRTY'));

    const mutated = vibe.prepareStage('research', { tool: 'codex' }).candidate;
    commitCandidate(mutated, 'source mutation');
    assert.throws(() => vibe.completeCandidate(mutated.id, { summary: 'No.' }), expectCode('SOURCE_MUTATION_FORBIDDEN'));
  });

  test('requires a source result commit for mutating execute candidates', () => {
    promotePlanningInputs(vibe);
    const candidate = vibe.prepareStage('execute').candidate;
    assert.throws(() => vibe.completeCandidate(candidate.id, { summary: 'No changes.' }), expectCode('RESULT_COMMIT_REQUIRED'));
  });

  test('promotes competing source candidates, explicitly replaces one, and preserves both histories', () => {
    promotePlanningInputs(vibe);
    assert.throws(() => vibe.promote('unknown-candidate'), expectCode('STATE_NOT_FOUND'));
    const first = vibe.prepareStage('execute', { tool: 'opencode' }).candidate;
    const second = vibe.prepareStage('execute', { tool: 'claude-router' }).candidate;
    assert.equal(first.git.base_commit, second.git.base_commit);

    const firstCommit = commitCandidate(first, 'candidate A\n');
    const secondCommit = commitCandidate(second, 'candidate B\n');
    vibe.completeCandidate(first.id, { summary: 'Implementation A.' });
    vibe.completeCandidate(second.id, { summary: 'Implementation B.' });

    const firstPromotion = vibe.promote(first.id);
    assert.equal(firstPromotion.strategy, 'fast-forward');
    assert.equal(firstPromotion.integration_commit, firstCommit);
    assert.equal(fs.readFileSync(path.join(project, 'implementation.txt'), 'utf8').replace(/\r\n/g, '\n'), 'candidate A\n');

    const replacement = vibe.promote(second.id, { replace: true });
    assert.equal(replacement.strategy, 'exact-tree-replacement');
    assert.notEqual(replacement.integration_commit, secondCommit);
    assert.equal(fs.readFileSync(path.join(project, 'implementation.txt'), 'utf8').replace(/\r\n/g, '\n'), 'candidate B\n');
    assert.equal(vibe.loadCandidate(first.id).promotion.status, 'superseded');
    assert.equal(vibe.loadCandidate(second.id).promotion.status, 'promoted');
    assert.equal(git(project, 'rev-parse', `${replacement.integration_commit}^{tree}`), git(project, 'rev-parse', `${secondCommit}^{tree}`));

    const promotionDir = path.join(project, '.planning-fvgsd-vibe', 'promotions', 'pipeline-001', 'execute');
    assert.deepEqual(fs.readdirSync(promotionDir).filter((name) => /^\d{4}\.json$/.test(name)).sort(), ['0001.json', '0002.json']);
    const verify = vibe.prepareStage('verify').candidate;
    assert.equal(verify.input.candidate_id, second.id);
    assert.equal(verify.git.base_commit, replacement.integration_commit);
  });

  test('blocks promotion on dirty integration state and does not discard changes', () => {
    promotePlanningInputs(vibe);
    const candidate = vibe.prepareStage('execute').candidate;
    commitCandidate(candidate, 'candidate work\n');
    vibe.completeCandidate(candidate.id, { summary: 'Complete.' });
    const dirtyPath = path.join(project, 'operator-notes.txt');
    fs.writeFileSync(dirtyPath, 'keep me', 'utf8');
    assert.throws(() => vibe.promote(candidate.id), expectCode('INTEGRATION_DIRTY'));
    assert.equal(fs.readFileSync(dirtyPath, 'utf8'), 'keep me');
  });

  test('surfaces missing worktrees, deleted branches, and corrupt manifests', () => {
    vibe.startRun('feature-development', { id: 'recovery-001' });
    const missing = vibe.prepareStage('research', { tool: 'gemini' }).candidate;
    git(project, 'worktree', 'remove', missing.git.worktree);
    assert.equal(vibe.status().stages[0].candidates[0].health.worktree, 'missing');
    assert.throws(() => vibe.completeCandidate(missing.id, { summary: 'Missing.' }), expectCode('WORKTREE_MISSING'));

    const deleted = vibe.prepareStage('research', { tool: 'codex' }).candidate;
    vibe.completeCandidate(deleted.id, { summary: 'Complete.' });
    vibe.cleanup(deleted.id, { deleteBranch: true });
    assert.throws(() => vibe.promote(deleted.id), expectCode('BRANCH_MISSING'));

    const corrupt = vibe.prepareStage('research', { tool: 'claude' }).candidate;
    fs.writeFileSync(vibe.store.candidatePath(corrupt.id), '{partial', 'utf8');
    assert.throws(() => vibe.loadCandidate(corrupt.id), expectCode('STATE_CORRUPT'));
  });

  test('recovers a stale lock without removing a live fresh lock', () => {
    const store = new VibeStore(project, { lockTimeoutMs: 100, staleLockMs: 25 });
    const lockPath = path.join(project, '.planning-fvgsd-vibe', 'locks', 'test.lock');
    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 99999999, host: os.hostname(), acquired_at: new Date(0).toISOString() })}\n`, 'utf8');
    const old = new Date(Date.now() - 1000);
    fs.utimesSync(lockPath, old, old);
    assert.equal(store.withLock('test', () => 'recovered'), 'recovered');
    assert.equal(fs.existsSync(lockPath), false);

    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquired_at: new Date().toISOString() })}\n`, 'utf8');
    assert.throws(() => store.withLock('test', () => null), expectCode('LOCK_TIMEOUT'));
    assert.equal(fs.existsSync(lockPath), true);
    fs.unlinkSync(lockPath);
  });
});

function promotePlanningInputs(vibe) {
  if (!vibe.store.loadActiveRunId()) vibe.startRun('feature-development', { id: 'pipeline-001' });
  const run = vibe.loadRun();
  if (!run.promotions.research) {
    const research = vibe.prepareStage('research').candidate;
    vibe.completeCandidate(research.id, { summary: 'Research complete.' });
    vibe.promote(research.id);
  }
  const refreshed = vibe.loadRun();
  if (!refreshed.promotions.plan) {
    const plan = vibe.prepareStage('plan').candidate;
    vibe.completeCandidate(plan.id, { summary: 'Plan complete.' });
    vibe.promote(plan.id);
  }
}
