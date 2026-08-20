'use strict';

process.env.GSD_TEST_MODE = '1';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, createTempGitProject, cleanup } = require('./helpers.cjs');
const { VibeOrchestrator, prepareVibeEntry } = require('../get-shit-done/bin/lib/vibe/index.cjs');
const { inspectExecutionBranch } = require('../get-shit-done/bin/lib/execution-branch.cjs');

const projects = [];
const VIBE_CLI = path.join(__dirname, '..', 'bin', 'vibe.js');

function git(cwd, ...args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function createRemoteProject(prefix) {
  const project = createTempGitProject(`${prefix}-coordinator-`);
  const remote = createTempDir(`${prefix}-remote-`);
  git(remote, 'init', '--bare');
  git(project, 'remote', 'add', 'origin', remote);
  projects.push(project, remote);
  return { project, remote };
}

function cloneWorker(remote, branch, prefix) {
  const parent = createTempDir(`${prefix}-worker-parent-`);
  const worker = path.join(parent, 'worker');
  git(parent, 'clone', remote, worker);
  git(worker, 'config', 'user.email', 'worker@test.com');
  git(worker, 'config', 'user.name', 'Worker');
  git(worker, 'config', 'commit.gpgsign', 'false');
  git(worker, 'switch', '--track', '-c', branch, `origin/${branch}`);
  projects.push(parent);
  return worker;
}

describe('VibeClaw multi-machine Git handoffs', () => {
  afterEach(() => {
    while (projects.length) cleanup(projects.pop());
  });

  test('publishes portable identity, accepts the assigned worker, and promotes only a pushed commit', () => {
    const { project, remote } = createRemoteProject('vibe-handoff');
    const prepared = prepareVibeEntry({
      cwd: project,
      command: 'quick',
      tools: ['codex'],
      id: 'remote-quick',
      coordinationMode: 'multi-machine',
      remote: 'origin',
    });
    const handoff = prepared.candidates[0];
    assert.equal(prepared.run.coordination.mode, 'multi-machine');
    assert.equal(handoff.handoff.mode, 'multi-machine');
    assert.equal(git(project, 'ls-remote', '--heads', 'origin', handoff.branch).split(/\s+/)[0], prepared.run.base_commit);
    assert.equal(git(project, 'ls-remote', '--tags', 'origin', handoff.handoff.tag).split(/\s+/)[0], prepared.run.base_commit);

    const worker = cloneWorker(remote, handoff.branch, 'vibe-handoff');
    const accepted = inspectExecutionBranch({ cwd: worker, command: 'quick', runtime: 'codex' });
    assert.equal(accepted.allowed, true);
    assert.equal(accepted.mode, 'vibe-git-handoff');
    assert.equal(accepted.candidate_id, handoff.id);

    const wrongTool = inspectExecutionBranch({ cwd: worker, command: 'quick', runtime: 'claude' });
    assert.equal(wrongTool.allowed, false);
    assert.equal(wrongTool.reason, 'handoff_tool_mismatch');
    const wrongCommand = inspectExecutionBranch({ cwd: worker, command: 'debug', runtime: 'codex' });
    assert.equal(wrongCommand.allowed, false);
    assert.equal(wrongCommand.reason, 'handoff_command_mismatch');

    fs.writeFileSync(path.join(worker, 'remote-result.txt'), 'worker result\n', 'utf8');
    git(worker, 'add', 'remote-result.txt');
    git(worker, 'commit', '-m', 'feat: add remote worker result');
    const workerCommit = git(worker, 'rev-parse', 'HEAD');
    git(worker, 'push', 'origin', `HEAD:${handoff.branch}`);

    const vibe = VibeOrchestrator.discover(project);
    assert.throws(() => vibe.setMode('local'), (error) => error.code === 'MODE_ACTIVE_RUN');
    const completed = vibe.completeCandidate(handoff.id, { summary: 'Remote worker completed the quick task.' });
    assert.equal(completed.git.result_commit, workerCommit);
    assert.equal(completed.git.handoff.completed_commit, workerCommit);
    assert.equal(git(project, 'ls-remote', '--tags', 'origin', handoff.handoff.completion_tag).split(/\s+/)[0], workerCommit);

    const replay = inspectExecutionBranch({ cwd: worker, command: 'quick', runtime: 'codex' });
    assert.equal(replay.allowed, false);
    assert.equal(replay.reason, 'handoff_already_completed');

    const promotion = vibe.promote(handoff.id);
    assert.equal(promotion.integration_commit, workerCommit);
    const integrationBranch = vibe.loadRun(prepared.run.id).integration_branch;
    assert.equal(git(project, 'ls-remote', '--heads', 'origin', `refs/heads/${integrationBranch}`).split(/\s+/)[0], workerCommit);
  });

  test('refuses coordinator completion until the worker result is committed and pushed', () => {
    const { project, remote } = createRemoteProject('vibe-handoff-unpushed');
    const prepared = prepareVibeEntry({
      cwd: project,
      command: 'debug',
      tools: ['codex'],
      id: 'remote-debug',
      coordinationMode: 'multi-machine',
      remote: 'origin',
    });
    const handoff = prepared.candidates[0];
    const worker = cloneWorker(remote, handoff.branch, 'vibe-handoff-unpushed');
    fs.writeFileSync(path.join(worker, 'diagnosis.txt'), 'not pushed\n', 'utf8');
    git(worker, 'add', 'diagnosis.txt');
    git(worker, 'commit', '-m', 'docs: record local diagnosis');

    const vibe = VibeOrchestrator.discover(project);
    assert.throws(
      () => vibe.completeCandidate(handoff.id, { summary: 'This must not complete.' }),
      (error) => error.code === 'HANDOFF_RESULT_COMMIT_REQUIRED',
    );
    assert.equal(vibe.loadCandidate(handoff.id).status, 'prepared');
  });

  test('CLI enables multi-machine mode while preparing an entry workflow', () => {
    const { project } = createRemoteProject('vibe-handoff-cli');
    const raw = childProcess.execFileSync(process.execPath, [
      VIBE_CLI,
      'entry', 'prepare', 'quick',
      '--project', project,
      '--tool', 'codex',
      '--id', 'cli-remote-quick',
      '--multi-machine',
      '--remote', 'origin',
      '--json',
    ], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const prepared = JSON.parse(raw);
    assert.equal(prepared.run.coordination.mode, 'multi-machine');
    assert.equal(prepared.candidates[0].handoff.remote, 'origin');

    const modeRaw = childProcess.execFileSync(process.execPath, [
      VIBE_CLI, 'mode', 'show', '--project', project, '--json',
    ], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.deepEqual(JSON.parse(modeRaw), { mode: 'multi-machine', multi_machine: true, remote: 'origin' });
  });
});
