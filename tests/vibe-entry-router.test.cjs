'use strict';

process.env.GSD_TEST_MODE = '1';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, createTempGitProject, cleanup } = require('./helpers.cjs');
const {
  VibeOrchestrator,
  normalizeCommand,
  resolveCommandEntry,
  inspectVibeEntry,
  prepareVibeEntry,
} = require('../get-shit-done/bin/lib/vibe/index.cjs');

const projects = [];

describe('vgsd to Vibe entry routing', () => {
  afterEach(() => {
    while (projects.length) cleanup(projects.pop());
  });

  test('normalizes runtime-native command forms and maps lifecycle workflows', () => {
    assert.equal(normalizeCommand('quick'), 'quick');
    assert.equal(normalizeCommand('vgsd-quick'), 'quick');
    assert.equal(normalizeCommand('/vgsd:quick'), 'quick');
    assert.equal(normalizeCommand('$vgsd-quick'), 'quick');

    assert.deepEqual(resolveCommandEntry('new-project'), {
      command: 'new-project',
      orchestratable: true,
      kind: 'lifecycle',
      workflow: 'project-bootstrap',
      stage: 'project',
      generated_workflow: false,
    });
    assert.equal(resolveCommandEntry('new-milestone').workflow, 'milestone-bootstrap');
    assert.equal(resolveCommandEntry('execute-phase').stage, 'execute');
    assert.equal(resolveCommandEntry('review').stage, 'review');
  });

  test('treats quick, fast, debug, and future commands as generated single-command workflows', () => {
    for (const command of ['quick', 'fast', 'debug', 'autonomous', 'code-review', 'future-command']) {
      const entry = resolveCommandEntry(command);
      assert.equal(entry.orchestratable, true);
      assert.equal(entry.kind, 'command');
      assert.equal(entry.workflow, `${command}-workflow`);
      assert.equal(entry.stage, 'task');
      assert.equal(entry.generated_workflow, true);
    }
    assert.equal(resolveCommandEntry('vibe').orchestratable, false);
    assert.equal(resolveCommandEntry('config').kind, 'control');
  });

  test('reports Git and baseline prerequisites before offering orchestration modes', () => {
    const noGit = createTempDir('vibe-entry-no-git-');
    projects.push(noGit);
    assert.equal(inspectVibeEntry({ cwd: noGit, command: 'quick' }).action, 'initialize-git');

    const project = createTempGitProject('vibe-entry-choice-');
    projects.push(project);
    const inspected = inspectVibeEntry({ cwd: project, command: 'debug' });
    assert.equal(inspected.action, 'choose-mode');
    assert.deepEqual(inspected.choices, ['direct', 'vibe-single', 'vibe-multi']);
  });

  test('does not silently omit uncommitted integration changes from candidate bases', () => {
    const project = createTempGitProject('vibe-entry-dirty-');
    projects.push(project);
    fs.writeFileSync(path.join(project, 'pending.txt'), 'not committed\n', 'utf8');

    assert.throws(
      () => prepareVibeEntry({ cwd: project, command: 'quick', tools: ['codex'] }),
      (error) => error.code === 'INTEGRATION_DIRTY' && error.details.files.some((file) => file.includes('pending.txt')),
    );
  });

  test('prepares N quick candidates and routes subsequent execution into their worktrees', () => {
    const project = createTempGitProject('vibe-entry-quick-');
    projects.push(project);

    const prepared = prepareVibeEntry({
      cwd: project,
      command: 'quick',
      tools: ['codex', 'claude'],
      id: 'quick-compare',
    });

    assert.equal(prepared.initialized, true);
    assert.equal(prepared.workflow, 'quick-workflow');
    assert.equal(prepared.stage, 'task');
    assert.equal(prepared.candidates.length, 2);
    assert.deepEqual(prepared.candidates.map((candidate) => candidate.tool), ['codex', 'claude']);
    assert.notEqual(prepared.candidates[0].branch, prepared.candidates[1].branch);
    assert.equal(prepared.candidates[0].invocation, '$vgsd-quick');
    assert.equal(prepared.candidates[1].invocation, '/vgsd-quick');

    const workflowPath = path.join(project, '.planning-vibe', 'workflows', 'quick-workflow.yaml');
    assert.ok(fs.existsSync(workflowPath));
    const vibe = VibeOrchestrator.discover(project);
    const workflow = vibe.loadWorkflow('quick-workflow');
    assert.equal(workflow.stages.task.gsd.command, 'vgsd:quick');
    assert.equal(workflow.stages.task.mutates_source, true);
    assert.equal(workflow.stages.task.requires_result_commit, false);

    const integration = inspectVibeEntry({ cwd: project, command: 'quick' });
    assert.equal(integration.action, 'prepare');
    assert.equal(integration.reuse_active_run, true);
    assert.equal(integration.existing_candidates.length, 2);

    const candidate = inspectVibeEntry({ cwd: prepared.candidates[0].worktree, command: 'quick' });
    assert.equal(candidate.action, 'continue-candidate');
    assert.equal(candidate.candidate.id, prepared.candidates[0].id);

    const wrongCommand = inspectVibeEntry({ cwd: prepared.candidates[0].worktree, command: 'debug' });
    assert.equal(wrongCommand.action, 'return-integration');
    assert.equal(wrongCommand.reason, 'candidate_command_mismatch');
    assert.equal(wrongCommand.project_root, project);

    const conflictingRun = inspectVibeEntry({ cwd: project, command: 'debug' });
    assert.equal(conflictingRun.action, 'resolve-active-run');
    assert.equal(conflictingRun.run.id, prepared.run.id);
    assert.throws(
      () => prepareVibeEntry({ cwd: project, command: 'debug', tools: ['codex'] }),
      (error) => error.code === 'ACTIVE_RUN_CONFLICT',
    );
    const explicitNewRun = prepareVibeEntry({
      cwd: project,
      command: 'debug',
      tools: ['codex'],
      id: 'debug-after-quick',
    });
    assert.equal(explicitNewRun.run.id, 'debug-after-quick');
  });

  test('starts milestone and feature lifecycle commands at the requested integration point', () => {
    const milestoneProject = createTempGitProject('vibe-entry-milestone-');
    projects.push(milestoneProject);
    const milestone = prepareVibeEntry({
      cwd: milestoneProject,
      command: 'new-milestone',
      tools: ['codex'],
      id: 'milestone-compare',
    });
    assert.equal(milestone.workflow, 'milestone-bootstrap');
    assert.equal(milestone.stage, 'milestone');
    assert.equal(milestone.candidates[0].invocation, '$vgsd-new-milestone');

    const featureProject = createTempGitProject('vibe-entry-feature-');
    projects.push(featureProject);
    const execute = prepareVibeEntry({
      cwd: featureProject,
      command: 'execute-phase',
      tools: ['claude'],
      id: 'feature-execute',
    });
    assert.equal(execute.workflow, 'feature-development');
    assert.equal(execute.stage, 'execute');
    assert.equal(execute.candidates[0].invocation, '/vgsd-execute-phase');
    const vibe = VibeOrchestrator.discover(featureProject);
    const executeRun = vibe.loadRun(execute.run.id);
    assert.equal(executeRun.entry_stage, 'execute');
    assert.equal(executeRun.stages.research.skipped, true);
    assert.equal(executeRun.stages.plan.skipped, true);
    assert.equal(vibe.next(execute.run.id).stage, 'execute');
    assert.equal(vibe.loadCandidate(execute.candidates[0].id).input, null);
    assert.throws(
      () => vibe.prepareStage('verify', { runId: execute.run.id, tool: 'codex' }),
      (error) => error.code === 'INPUT_NOT_PROMOTED',
    );
    assert.throws(
      () => prepareVibeEntry({ cwd: featureProject, command: 'verify-work', tools: ['codex'] }),
      (error) => error.code === 'INPUT_NOT_PROMOTED',
    );
  });

  test('generic tasks may finish with planning-only output while execute retains its commit requirement', () => {
    const project = createTempGitProject('vibe-entry-completion-');
    projects.push(project);
    const prepared = prepareVibeEntry({ cwd: project, command: 'debug', tools: ['codex'], id: 'debug-diagnose' });
    const vibe = VibeOrchestrator.discover(project);
    const completed = vibe.completeCandidate(prepared.candidates[0].id, { summary: 'Diagnosis found no source change.' });
    assert.equal(completed.status, 'completed');

    const lifecycle = vibe.loadWorkflow('feature-development');
    assert.equal(lifecycle.stages.execute.requires_result_commit, true);
  });
});
