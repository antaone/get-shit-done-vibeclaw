'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTempDir, createTempGitProject, cleanup } = require('./helpers.cjs');
const {
  VibeOrchestrator,
  normalizeCommand,
  resolveCommandEntry,
  inspectLegacyPlanningCommands,
  migrateLegacyPlanningCommands,
  inspectVibeEntry,
  prepareVibeEntry,
} = require('../get-shit-done/bin/lib/vibe/index.cjs');

const projects = [];

describe('fvgsd to Vibe entry routing', () => {
  afterEach(() => {
    while (projects.length) cleanup(projects.pop());
  });

  test('normalizes runtime-native command forms and maps lifecycle workflows', () => {
    assert.equal(normalizeCommand('quick'), 'quick');
    assert.equal(normalizeCommand('fvgsd-quick'), 'quick');
    assert.equal(normalizeCommand('/fvgsd:quick'), 'quick');
    assert.equal(normalizeCommand('$fvgsd-quick'), 'quick');

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

  test('requires an explicit brownfield migration for legacy commands in committed planning Markdown', () => {
    const project = createTempGitProject('vibe-entry-legacy-planning-');
    projects.push(project);
    const statePath = path.join(project, '.planning', 'STATE.md');
    const original = [
      '# State',
      '',
      'Next: /gsd-plan-phase 3',
      'Then: $gsd-execute-phase 3',
      'Verify: /gsd:verify-work 3',
      'Internal CLI: /fvgsd-tools and /fvgsd-sdk',
      'Reference URL: https://example.test/gsd-plan-phase',
      '',
    ].join('\n');
    fs.writeFileSync(statePath, original, 'utf8');
    execFileSync('git', ['add', '--', '.planning/STATE.md'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'legacy planning state'], { cwd: project });

    const inspected = inspectVibeEntry({ cwd: project, command: 'plan-phase', runtime: 'codex' });
    assert.equal(inspected.action, 'migrate-planning-commands');
    assert.equal(inspected.reason, 'legacy_planning_command_namespace');
    assert.equal(inspected.legacy_planning_commands.total_references, 3);
    assert.deepEqual(
      inspected.legacy_planning_commands.affected_files[0].references.map((reference) => reference.replacement),
      ['$fvgsd-plan-phase', '$fvgsd-execute-phase', '$fvgsd-verify-work'],
    );

    assert.throws(
      () => prepareVibeEntry({ cwd: project, command: 'plan-phase', tools: ['codex'], runtime: 'codex' }),
      (error) => error.code === 'LEGACY_PLANNING_COMMANDS'
        && error.details.legacy_planning_commands.total_references === 3,
    );

    const preview = migrateLegacyPlanningCommands(project, { runtime: 'codex', dryRun: true });
    assert.equal(preview.migrated, false);
    assert.equal(fs.readFileSync(statePath, 'utf8'), original);

    const migrated = migrateLegacyPlanningCommands(project, { runtime: 'codex' });
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.total_references, 3);
    const updated = fs.readFileSync(statePath, 'utf8');
    assert.match(updated, /Next: \$fvgsd-plan-phase 3/);
    assert.match(updated, /Then: \$fvgsd-execute-phase 3/);
    assert.match(updated, /Verify: \$fvgsd-verify-work 3/);
    assert.match(updated, /Internal CLI: \/fvgsd-tools and \/fvgsd-sdk/);
    assert.match(updated, /https:\/\/example\.test\/gsd-plan-phase/);

    const pendingCommit = inspectVibeEntry({ cwd: project, command: 'plan-phase', runtime: 'codex' });
    assert.equal(pendingCommit.action, 'choose-mode');
    assert.equal(pendingCommit.vibe_requires_baseline, true);
    execFileSync('git', ['add', '--', '.planning/STATE.md'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'migrate planning command namespace'], { cwd: project });

    const prepared = prepareVibeEntry({
      cwd: project,
      command: 'plan-phase',
      tools: ['codex'],
      runtime: 'codex',
      id: 'legacy-planning-migrated',
    });
    assert.equal(prepared.candidates[0].invocation, '$fvgsd-plan-phase');
    assert.match(
      fs.readFileSync(path.join(prepared.candidates[0].worktree, '.planning', 'STATE.md'), 'utf8'),
      /\$fvgsd-plan-phase/,
    );
  });

  test('rolls back earlier planning files when a legacy-command migration write fails', () => {
    const project = createTempGitProject('vibe-entry-legacy-rollback-');
    projects.push(project);
    const roadmapPath = path.join(project, '.planning', 'ROADMAP.md');
    const statePath = path.join(project, '.planning', 'STATE.md');
    fs.writeFileSync(roadmapPath, 'Run /gsd-discuss-phase 1\n', 'utf8');
    fs.writeFileSync(statePath, 'Run /gsd-plan-phase 1\n', 'utf8');

    let writes = 0;
    let injected = false;
    assert.throws(
      () => migrateLegacyPlanningCommands(project, {
        runtime: 'gemini',
        writeFile(file, content) {
          writes += 1;
          if (!injected && writes === 2) {
            injected = true;
            throw new Error('injected write failure');
          }
          fs.writeFileSync(file, content, 'utf8');
        },
      }),
      (error) => error.code === 'PLANNING_COMMAND_MIGRATION_FAILED'
        && error.details.rollback_failures.length === 0,
    );
    assert.equal(fs.readFileSync(roadmapPath, 'utf8'), 'Run /gsd-discuss-phase 1\n');
    assert.equal(fs.readFileSync(statePath, 'utf8'), 'Run /gsd-plan-phase 1\n');
    assert.equal(inspectLegacyPlanningCommands(project, { runtime: 'gemini' }).total_references, 2);
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
    assert.equal(prepared.candidates[0].invocation, '$fvgsd-quick');
    assert.equal(prepared.candidates[1].invocation, '/fvgsd-quick');

    const workflowPath = path.join(project, '.planning-fvgsd-vibe', 'workflows', 'quick-workflow.yaml');
    assert.ok(fs.existsSync(workflowPath));
    const vibe = VibeOrchestrator.discover(project);
    const workflow = vibe.loadWorkflow('quick-workflow');
    assert.equal(workflow.stages.task.gsd.command, 'fvgsd:quick');
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
    assert.equal(milestone.candidates[0].invocation, '$fvgsd-new-milestone');

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
    assert.equal(execute.candidates[0].invocation, '/fvgsd-execute-phase');
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
