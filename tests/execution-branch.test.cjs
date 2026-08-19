'use strict';

process.env.GSD_TEST_MODE = '1';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTempDir, createTempGitProject, cleanup, runGsdTools } = require('./helpers.cjs');
const {
  inspectExecutionBranch,
  ensureExecutionBranch,
  parseSmartBranch,
} = require('../get-shit-done/bin/lib/execution-branch.cjs');
const { VibeOrchestrator } = require('../get-shit-done/bin/lib/vibe/index.cjs');
const { installRuntimeArtifacts } = require('../bin/install.js');
const { loadSkillsManifest, resolveProfile } = require('../get-shit-done/bin/lib/install-profiles.cjs');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands', 'gsd');
const CORE_PROFILE = resolveProfile({ modes: ['core'], manifest: loadSkillsManifest(COMMANDS_DIR) });

const projects = [];

function project(prefix) {
  const root = createTempGitProject(prefix);
  projects.push(root);
  return root;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function deterministicOptions(root, overrides = {}) {
  return {
    cwd: root,
    command: 'new-project',
    env: { CODEX_THREAD_ID: 'thread-123' },
    now: () => Date.parse('2026-08-19T12:34:56.000Z'),
    randomBytes: () => Buffer.from('a1b2c3', 'hex'),
    ...overrides,
  };
}

afterEach(() => {
  while (projects.length > 0) cleanup(projects.pop());
});

describe('vgsd execution branch guard', () => {
  test('creates a runtime, command, and execution-aware standalone branch', () => {
    const root = project('vgsd-branch-create-');
    fs.writeFileSync(path.join(root, 'uncommitted.txt'), 'preserved\n', 'utf8');

    const result = ensureExecutionBranch(deterministicOptions(root));

    assert.equal(result.allowed, true);
    assert.equal(result.action, 'created');
    assert.equal(result.mode, 'standalone-smart-branch');
    assert.match(result.branch, /^vgsd\/codex\/new-project\/20260819-123456-[a-f0-9]{8}-a1b2c3$/);
    assert.equal(git(root, 'branch', '--show-current'), result.branch);
    assert.equal(fs.readFileSync(path.join(root, 'uncommitted.txt'), 'utf8'), 'preserved\n');
    assert.equal(result.dirty_count, 1);
    assert.deepEqual(parseSmartBranch(result.branch), result.execution);

    const commonDir = path.resolve(root, git(root, 'rev-parse', '--git-common-dir'));
    const metadataFiles = fs.readdirSync(path.join(commonDir, 'vgsd', 'executions'));
    assert.equal(metadataFiles.length, 1);
    const metadata = JSON.parse(fs.readFileSync(path.join(commonDir, 'vgsd', 'executions', metadataFiles[0]), 'utf8'));
    assert.equal(metadata.branch, result.branch);
    assert.equal(metadata.runtime, 'codex');
    assert.equal(metadata.command, 'new-project');
    assert.equal(Object.hasOwn(metadata, 'session_fingerprint'), true);
    assert.equal(JSON.stringify(metadata).includes('thread-123'), false);
  });

  test('reuses the same command branch, while a later command gets a new execution branch', () => {
    const root = project('vgsd-branch-reuse-');
    const inspected = inspectExecutionBranch(deterministicOptions(root, { command: 'help' }));
    assert.equal(inspected.allowed, true);
    assert.equal(inspected.action, 'inspected');
    assert.equal(git(root, 'branch', '--show-current'), inspected.branch);

    const created = ensureExecutionBranch(deterministicOptions(root));
    const reused = ensureExecutionBranch(deterministicOptions(root));
    assert.equal(reused.allowed, true);
    assert.equal(reused.action, 'reused');
    assert.equal(reused.branch, created.branch);

    const transitioned = ensureExecutionBranch(deterministicOptions(root, {
      command: 'plan-phase',
      randomBytes: () => Buffer.from('d4e5f6', 'hex'),
    }));
    assert.equal(transitioned.allowed, true);
    assert.equal(transitioned.action, 'created');
    assert.match(transitioned.branch, /^vgsd\/codex\/plan-phase\//);
    assert.equal(transitioned.source_branch, created.branch);
  });

  test('blocks a different runtime from reusing another tool execution branch', () => {
    const root = project('vgsd-branch-runtime-');
    const created = ensureExecutionBranch(deterministicOptions(root));

    const result = ensureExecutionBranch(deterministicOptions(root, {
      command: 'new-project',
      runtime: 'gemini',
      env: { GEMINI_SESSION_ID: 'gemini-456' },
    }));

    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'smart_branch_runtime_mismatch');
    assert.equal(result.branch, created.branch);
  });

  test('accepts a matching active Vibe candidate without creating another branch', () => {
    const root = project('vgsd-vibe-candidate-');
    const vibe = new VibeOrchestrator({ projectRoot: root });
    vibe.initialize();
    const run = vibe.startRun('project-bootstrap', { id: 'guard-vibe' });
    const prepared = vibe.prepareStage('project', { runId: run.id, tool: 'codex' });
    const launch = vibe.launchCandidate(prepared.candidate.id);
    assert.equal(launch.command.env.VIBE_CANDIDATE_ID, prepared.candidate.id);
    assert.equal(launch.command.env.VIBE_TOOL, 'codex');
    assert.equal(launch.command.env.GSD_RUNTIME, 'codex');

    const result = ensureExecutionBranch({
      cwd: prepared.candidate.git.worktree,
      command: 'new-project',
      env: {
        VIBE_CANDIDATE_ID: prepared.candidate.id,
        VIBE_TOOL: 'codex',
        GSD_RUNTIME: 'codex',
      },
    });

    assert.equal(result.allowed, true);
    assert.equal(result.action, 'reused');
    assert.equal(result.mode, 'vibe-candidate');
    assert.equal(result.candidate_id, prepared.candidate.id);
    assert.equal(result.branch, prepared.candidate.git.branch);
  });

  test('CLI verifies a project-bootstrap candidate before .planning exists', () => {
    const root = project('vgsd-vibe-bootstrap-cli-');
    fs.rmSync(path.join(root, '.planning'), { recursive: true, force: true });
    fs.writeFileSync(path.join(root, 'PROJECT-BRIEF.md'), '# Brief\n', 'utf8');
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'prepare blank project');

    const vibe = new VibeOrchestrator({ projectRoot: root });
    vibe.initialize();
    const run = vibe.startRun('project-bootstrap', { id: 'bootstrap-cli' });
    const prepared = vibe.prepareStage('project', { runId: run.id, tool: 'gemini' });
    assert.equal(fs.existsSync(path.join(prepared.candidate.git.worktree, '.planning')), false);

    const result = runGsdTools(
      ['execution-branch', 'ensure', 'new-project', '--runtime', 'gemini'],
      prepared.candidate.git.worktree,
      {
        VIBE_CANDIDATE_ID: prepared.candidate.id,
        VIBE_TOOL: 'gemini',
        GSD_RUNTIME: 'gemini',
      },
    );
    assert.equal(result.success, true, result.error);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.allowed, true);
    assert.equal(parsed.mode, 'vibe-candidate');
    assert.equal(parsed.branch, prepared.candidate.git.branch);
  });

  test('fails closed when Vibe is initialized but execution is not in a candidate', () => {
    const root = project('vgsd-vibe-integration-');
    const vibe = new VibeOrchestrator({ projectRoot: root });
    vibe.initialize();

    const result = ensureExecutionBranch(deterministicOptions(root));

    assert.equal(result.allowed, false);
    assert.equal(result.action, 'blocked');
    assert.equal(result.mode, 'vibe-managed');
    assert.equal(result.reason, 'vibe_candidate_required');
    assert.match(result.hint, /vibe stage prepare/);
    assert.doesNotMatch(git(root, 'branch', '--show-current'), /^vgsd\//);
  });

  test('future vibe init imports standalone branch provenance', () => {
    const root = project('vgsd-vibe-import-');
    const standalone = ensureExecutionBranch(deterministicOptions(root, { command: 'plan-phase' }));
    const vibe = new VibeOrchestrator({ projectRoot: root });

    const initialized = vibe.initialize();

    assert.equal(initialized.standalone_executions.length, 1);
    assert.equal(initialized.standalone_executions[0].branch, standalone.branch);
    assert.equal(initialized.standalone_executions[0].runtime, 'codex');
    assert.equal(initialized.standalone_executions[0].command, 'plan-phase');
    const state = JSON.parse(fs.readFileSync(
      path.join(root, '.planning-vibe', 'state', 'standalone-executions.json'),
      'utf8',
    ));
    assert.equal(state.executions[0].branch, standalone.branch);

    const reused = ensureExecutionBranch(deterministicOptions(root, { command: 'plan-phase' }));
    assert.equal(reused.allowed, true);
    assert.equal(reused.action, 'reused');
    assert.equal(reused.branch, standalone.branch);
  });

  test('gsd-tools exposes the guard for installed workflow prompts', () => {
    const root = project('vgsd-branch-cli-');
    const result = runGsdTools(
      ['execution-branch', 'ensure', 'new-milestone', '--runtime', 'gemini'],
      root,
      { GSD_RUNTIME: 'gemini' },
    );
    assert.equal(result.success, true, result.error);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.allowed, true);
    assert.equal(parsed.runtime, 'gemini');
    assert.match(parsed.branch, /^vgsd\/gemini\/new-milestone\//);
  });

  test('read-only inspection allows help outside a Git repository', () => {
    const root = createTempDir('vgsd-help-no-git-');
    projects.push(root);
    const result = runGsdTools(
      ['execution-branch', 'inspect', 'help', '--runtime', 'claude'],
      root,
    );
    assert.equal(result.success, true, result.error);
    assert.deepEqual(JSON.parse(result.output), {
      allowed: true,
      action: 'inspected',
      mode: 'no-repository',
      reason: 'git_repository_required',
      command: 'help',
      runtime: 'claude',
      branch: null,
      message: 'No Git repository is active; the read-only command may continue.',
    });
  });
});

describe('public vgsd command guard coverage', () => {
  test('every command checks branch safety before its workflow body', () => {
    const commandDir = path.join(__dirname, '..', 'commands', 'gsd');
    const files = fs.readdirSync(commandDir).filter((name) => name.endsWith('.md')).sort();
    assert.ok(files.length > 0);

    for (const name of files) {
      const command = name.slice(0, -3);
      const content = fs.readFileSync(path.join(commandDir, name), 'utf8');
      const expectedAction = command === 'help' ? 'inspect' : 'ensure';
      assert.match(content, /<execution_branch_guard>/, `${name} is missing the guard`);
      assert.ok(
        content.includes(`execution-branch ${expectedAction} "${command}" --runtime __VGSD_RUNTIME__`),
        `${name} has the wrong guard command`,
      );
      assert.match(content, /^\s+- Bash\s*$/m, `${name} cannot run the guard`);
      assert.ok(
        content.indexOf('<execution_branch_guard>') < content.indexOf('<objective>') || !content.includes('<objective>'),
        `${name} must run the guard before its objective`,
      );
    }
  });

  test('Claude, Gemini, Codex, and OpenCode installs receive runtime-correct guard paths', (t) => {
    const cases = [
      ['claude', path.join('skills', 'vgsd-new-project', 'SKILL.md'), path.join('skills', 'vgsd-surface', 'SKILL.md')],
      ['gemini', path.join('commands', 'vgsd', 'new-project.md'), path.join('commands', 'vgsd', 'surface.md')],
      ['codex', path.join('skills', 'vgsd-new-project', 'SKILL.md'), path.join('skills', 'vgsd-surface', 'SKILL.md')],
      ['opencode', path.join('command', 'vgsd-new-project.md'), path.join('command', 'vgsd-surface.md')],
    ];

    for (const [runtime, relativePath, surfaceRelativePath] of cases) {
      const configDir = createTempDir(`vgsd-guard-${runtime}-`);
      t.after(() => cleanup(configDir));
      installRuntimeArtifacts(runtime, configDir, 'global', CORE_PROFILE);
      const installedPath = path.join(configDir, relativePath);
      assert.ok(fs.existsSync(installedPath), `${runtime} did not install ${relativePath}`);
      const content = fs.readFileSync(installedPath, 'utf8');
      assert.match(content, /execution-branch ensure "new-project"/);
      assert.ok(content.includes(`--runtime ${runtime}`), `${runtime} guard lost its runtime identity`);
      assert.doesNotMatch(content, /__VGSD_RUNTIME__/);
      assert.ok(
        content.includes(path.basename(configDir)),
        `${runtime} guard did not target its configured runtime directory`,
      );
      if (runtime !== 'claude') assert.doesNotMatch(content, /\.claude\//);

      const surfacePath = path.join(configDir, surfaceRelativePath);
      assert.ok(fs.existsSync(surfacePath), `${runtime} did not install ${surfaceRelativePath}`);
      const surface = fs.readFileSync(surfacePath, 'utf8');
      assert.ok(
        surface.includes(`resolveRuntimeArtifactLayout('${runtime}', runtimeConfigDir, scope)`),
        `${runtime} surface command did not resolve its native layout`,
      );
      if (runtime !== 'claude') {
        assert.doesNotMatch(surface, /(?:~|\$HOME)\/\.claude\b/);
      }
    }
  });
});
