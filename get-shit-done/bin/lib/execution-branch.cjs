'use strict';

/**
 * Execution Branch Guard
 *
 * Gives every fvgsd workflow a branch-aware preflight without competing with
 * VibeClaw's candidate lifecycle:
 *
 * - valid Vibe candidate worktrees are accepted as-is;
 * - an initialized VibeClaw project fails closed outside a candidate;
 * - standalone fvgsd use gets a runtime/command/execution-aware branch;
 * - Git-local metadata lets a later `vibe init` discover standalone work.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execGit: execGitSeam } = require('./shell-command-projection.cjs');
const { VibeStore } = require('./vibe/store.cjs');
const { VibeError } = require('./vibe/errors.cjs');

const SMART_BRANCH_PREFIX = 'fvgsd/';
const METADATA_VERSION = 1;
const ALLOWED_CANDIDATE_STATUSES = new Set(['prepared', 'running']);

function invokeGit(args, cwd, options = {}) {
  const execGit = options.execGit || execGitSeam;
  const result = execGit(args, { cwd, timeout: options.timeout ?? 15000 });
  return {
    ...result,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function sanitizeSegment(value, fallback) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function normalizeRuntime(value) {
  const runtime = sanitizeSegment(value, 'unknown');
  if (runtime === 'cc' || runtime === 'claude-code') return 'claude';
  return runtime;
}

function detectRuntime(cwd, env = process.env, explicitRuntime = null) {
  if (env.VIBE_TOOL) return normalizeRuntime(env.VIBE_TOOL);
  if (explicitRuntime && explicitRuntime !== 'auto') return normalizeRuntime(explicitRuntime);
  if (env.FVGSD_RUNTIME) return normalizeRuntime(env.FVGSD_RUNTIME);

  const markers = [
    ['codex', ['CODEX_THREAD_ID']],
    ['gemini', ['GEMINI_SESSION_ID']],
    ['claude-router', ['CLAUDE_ROUTER_SESSION_ID']],
    ['claude', ['CLAUDE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']],
    ['opencode', ['OPENCODE_SESSION_ID']],
    ['grok', ['GROK_SESSION_ID']],
    ['cursor', ['CURSOR_SESSION_ID']],
    ['windsurf', ['WINDSURF_SESSION_ID']],
  ];
  for (const [runtime, keys] of markers) {
    if (keys.some((key) => env[key])) return runtime;
  }

  try {
    const configPath = path.join(cwd, '.planning', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config && config.runtime) return normalizeRuntime(config.runtime);
    }
  } catch {
    // A malformed optional config must not bypass the branch guard.
  }
  return 'unknown';
}

function resolveRepoContext(cwd, options = {}) {
  const rootResult = invokeGit(['rev-parse', '--show-toplevel'], cwd, options);
  if (rootResult.exitCode !== 0) {
    return {
      ok: false,
      reason: 'git_repository_required',
      message: 'fvgsd execution requires a Git repository so branch safety can be verified.',
      stderr: rootResult.stderr,
    };
  }

  const root = path.resolve(rootResult.stdout);
  const commonResult = invokeGit(['rev-parse', '--git-common-dir'], root, options);
  if (commonResult.exitCode !== 0) {
    return {
      ok: false,
      reason: 'git_common_dir_unavailable',
      message: 'Could not resolve the Git common directory for execution metadata.',
      stderr: commonResult.stderr,
    };
  }
  const commonDir = path.isAbsolute(commonResult.stdout)
    ? path.resolve(commonResult.stdout)
    : path.resolve(root, commonResult.stdout);
  const branchResult = invokeGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root, options);
  const headResult = invokeGit(['rev-parse', '--verify', 'HEAD^{commit}'], root, options);
  const statusResult = invokeGit(['status', '--porcelain', '--untracked-files=all'], root, options);

  return {
    ok: true,
    root,
    commonDir,
    branch: branchResult.exitCode === 0 ? branchResult.stdout : null,
    head: headResult.exitCode === 0 ? headResult.stdout : null,
    dirty: statusResult.exitCode === 0
      ? statusResult.stdout.split(/\r?\n/).filter(Boolean)
      : [],
  };
}

function parseSmartBranch(branch) {
  if (typeof branch !== 'string' || !branch.startsWith(SMART_BRANCH_PREFIX)) return null;
  const parts = branch.split('/');
  if (parts.length !== 4 || parts.some((part) => !part)) return null;
  return {
    runtime: parts[1],
    command: parts[2],
    execution_id: parts[3],
  };
}

function sessionValue(env) {
  for (const key of [
    'VIBE_CANDIDATE_ID',
    'CODEX_THREAD_ID',
    'GEMINI_SESSION_ID',
    'CLAUDE_SESSION_ID',
    'CLAUDE_ROUTER_SESSION_ID',
    'OPENCODE_SESSION_ID',
    'GROK_SESSION_ID',
  ]) {
    if (env[key]) return `${key}:${env[key]}`;
  }
  return `process:${process.pid}`;
}

function executionId(env, options = {}) {
  const now = new Date((options.now || (() => Date.now()))());
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\.\d{3}Z$/, '');
  const fingerprint = crypto.createHash('sha256').update(sessionValue(env)).digest('hex').slice(0, 8);
  const random = (options.randomBytes || crypto.randomBytes)(3).toString('hex');
  return `${timestamp}-${fingerprint}-${random}`;
}

function metadataDirectory(commonDir) {
  return path.join(commonDir, 'fvgsd', 'executions');
}

function metadataPath(commonDir, branch) {
  const id = crypto.createHash('sha256').update(branch).digest('hex').slice(0, 20);
  return path.join(metadataDirectory(commonDir), `${id}.json`);
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
    throw error;
  }
}

function readMetadata(commonDir, branch) {
  const filePath = metadataPath(commonDir, branch);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && parsed.branch === branch ? parsed : null;
  } catch {
    return null;
  }
}

function makeMetadata(repo, branch, parsed, command, runtime, env, options = {}) {
  const createdAt = new Date((options.now || (() => Date.now()))()).toISOString();
  return {
    schema_version: METADATA_VERSION,
    execution_id: parsed.execution_id,
    branch,
    runtime,
    command,
    source_branch: repo.branch,
    base_commit: repo.head,
    created_at: createdAt,
    session_fingerprint: crypto.createHash('sha256').update(sessionValue(env)).digest('hex').slice(0, 12),
  };
}

function findVibeStore(cwd, options = {}) {
  try {
    return VibeStore.discover(cwd, options.storeOptions);
  } catch (error) {
    if (error instanceof VibeError && error.code === 'NOT_INITIALIZED') return null;
    throw error;
  }
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function inspectVibeCandidate(store, repo, runtime, env) {
  let candidates = [];
  try {
    if (env.VIBE_CANDIDATE_ID) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(String(env.VIBE_CANDIDATE_ID))) {
        return {
          allowed: false,
          reason: 'vibe_candidate_id_invalid',
          message: 'VIBE_CANDIDATE_ID contains characters that are not valid in a candidate ID.',
        };
      }
      candidates = [store.loadCandidate(env.VIBE_CANDIDATE_ID)];
    } else {
      candidates = store.listCandidateIds()
        .map((id) => store.loadCandidate(id))
        .filter((candidate) => candidate.git && candidate.git.branch === repo.branch);
    }
  } catch (error) {
    return {
      allowed: false,
      reason: 'vibe_candidate_state_invalid',
      message: `Vibe candidate state could not be verified: ${error.message}`,
    };
  }

  if (candidates.length !== 1) {
    return {
      allowed: false,
      reason: candidates.length > 1 ? 'vibe_candidate_ambiguous' : 'vibe_candidate_required',
      message: candidates.length > 1
        ? 'More than one Vibe candidate matches this branch; execution is ambiguous.'
        : 'VibeClaw is initialized, but this worktree is not a prepared Vibe candidate.',
      hint: 'Run the installed `fvgsd-vibe` command for this workflow to choose one or more tools and prepare candidate worktrees.',
    };
  }

  const candidate = candidates[0];
  const expectedWorktree = candidate.git && candidate.git.worktree;
  const candidateRuntime = candidate.tool && normalizeRuntime(candidate.tool.id);
  if (!candidate.git || candidate.git.branch !== repo.branch) {
    return {
      allowed: false,
      reason: 'vibe_branch_mismatch',
      message: `Current branch '${repo.branch || '(detached)'}' does not match Vibe candidate branch '${candidate.git && candidate.git.branch}'.`,
    };
  }
  if (!expectedWorktree || path.resolve(expectedWorktree) !== repo.root || !isWithin(expectedWorktree, repo.root)) {
    return {
      allowed: false,
      reason: 'vibe_worktree_mismatch',
      message: 'The current Git worktree does not match the worktree recorded by the Vibe candidate.',
    };
  }
  if (!ALLOWED_CANDIDATE_STATUSES.has(candidate.status)) {
    return {
      allowed: false,
      reason: 'vibe_candidate_not_active',
      message: `Vibe candidate '${candidate.id}' is '${candidate.status}', not prepared or running.`,
    };
  }
  if (runtime !== 'unknown' && candidateRuntime && candidateRuntime !== runtime) {
    return {
      allowed: false,
      reason: 'vibe_tool_mismatch',
      message: `This candidate belongs to '${candidateRuntime}', but the current fvgsd runtime is '${runtime}'.`,
    };
  }

  return {
    allowed: true,
    action: 'reused',
    mode: 'vibe-candidate',
    reason: 'vibe_candidate_verified',
    branch: repo.branch,
    candidate_id: candidate.id,
    run_id: candidate.run_id,
    runtime: candidateRuntime || runtime,
    dirty_count: repo.dirty.length,
    message: `Verified Vibe candidate '${candidate.id}' on '${repo.branch}'.`,
  };
}

function parseHandoffBranch(branch) {
  if (typeof branch !== 'string') return null;
  const parts = branch.split('/');
  if (parts.length !== 4 || parts[0] !== 'vibe') return null;
  const [, run, stage, suffix] = parts;
  if (![run, stage, suffix].every((value) => /^[a-z0-9][a-z0-9-]*$/.test(value))) return null;
  const match = suffix.match(/^(.+)-(\d{3})$/);
  if (!match) return null;
  return {
    run,
    stage,
    suffix,
    tool: normalizeRuntime(match[1]),
    candidate_id: `${run}-${stage}-${suffix}`,
  };
}

function parseRemoteLines(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [commit, ref] = line.trim().split(/\s+/, 2);
      return { commit, ref };
    })
    .filter((item) => /^[0-9a-f]{40,64}$/i.test(item.commit || '') && item.ref);
}

function inspectGitHandoff(repo, runtime, command, options = {}) {
  const parsed = parseHandoffBranch(repo.branch);
  if (!parsed) return null;
  const upstreamResult = invokeGit([
    'for-each-ref', '--format=%(upstream:short)', `refs/heads/${repo.branch}`,
  ], repo.root, options);
  const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() : '';
  if (!upstream || !upstream.endsWith(`/${repo.branch}`)) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_upstream_required',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Multi-machine candidate '${repo.branch}' must track its published remote branch.`,
      hint: `Fetch the coordinator remote and check out '${repo.branch}' with --track before running fvgsd.`,
    };
  }
  const remote = upstream.slice(0, -(repo.branch.length + 1));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(remote)) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_remote_invalid',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Candidate upstream '${upstream}' does not use a supported Git remote name.`,
    };
  }

  const identityPattern = `refs/tags/vibe-handoff/${parsed.candidate_id}/*`;
  const identityResult = invokeGit(['ls-remote', '--exit-code', '--tags', remote, identityPattern], repo.root, {
    ...options,
    timeout: options.remoteTimeout ?? 30000,
  });
  if (identityResult.exitCode !== 0) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: identityResult.exitCode === 2 ? 'handoff_identity_missing' : 'handoff_remote_unavailable',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: identityResult.exitCode === 2
        ? `Remote '${remote}' has no Vibe handoff identity for '${parsed.candidate_id}'.`
        : `Could not verify Vibe handoff '${parsed.candidate_id}' against remote '${remote}'.`,
      hint: identityResult.stderr || 'Fetch the published handoff or restore remote access before running fvgsd.',
    };
  }
  const identities = parseRemoteLines(identityResult.stdout)
    .filter((item) => item.ref.startsWith(`refs/tags/vibe-handoff/${parsed.candidate_id}/`));
  if (identities.length !== 1) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_identity_ambiguous',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Remote '${remote}' returned ${identities.length} handoff identities for '${parsed.candidate_id}'.`,
    };
  }
  const identity = identities[0];
  const assignedCommand = identity.ref.slice(`refs/tags/vibe-handoff/${parsed.candidate_id}/`.length);
  if (!/^[a-z][a-z0-9-]*$/.test(assignedCommand) || assignedCommand !== command) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_command_mismatch',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `This handoff is assigned to '${assignedCommand || 'unknown'}', not '${command}'.`,
    };
  }
  if (runtime === 'unknown') {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_runtime_required',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Multi-machine handoff '${parsed.candidate_id}' requires an explicit fvgsd runtime identity.`,
    };
  }
  if (runtime !== 'unknown' && parsed.tool !== runtime) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_tool_mismatch',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `This handoff belongs to '${parsed.tool}', but the current fvgsd runtime is '${runtime}'.`,
    };
  }

  const completionRef = `refs/tags/vibe-complete/${parsed.candidate_id}`;
  const completionResult = invokeGit(['ls-remote', '--exit-code', '--tags', remote, completionRef], repo.root, {
    ...options,
    timeout: options.remoteTimeout ?? 30000,
  });
  if (completionResult.exitCode === 0 && parseRemoteLines(completionResult.stdout).some((item) => item.ref === completionRef)) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_already_completed',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Multi-machine candidate '${parsed.candidate_id}' is already completed and cannot be executed again.`,
    };
  }
  if (![0, 2].includes(completionResult.exitCode)) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_remote_unavailable',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Could not verify completion state for '${parsed.candidate_id}' on '${remote}'.`,
      hint: completionResult.stderr || null,
    };
  }

  const remoteBranchRef = `refs/heads/${repo.branch}`;
  const branchResult = invokeGit(['ls-remote', '--exit-code', '--heads', remote, remoteBranchRef], repo.root, {
    ...options,
    timeout: options.remoteTimeout ?? 30000,
  });
  if (branchResult.exitCode !== 0) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: branchResult.exitCode === 2 ? 'handoff_remote_branch_missing' : 'handoff_remote_unavailable',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Could not verify published candidate branch '${repo.branch}' on '${remote}'.`,
      hint: branchResult.stderr || null,
    };
  }
  const remoteBranches = parseRemoteLines(branchResult.stdout).filter((item) => item.ref === remoteBranchRef);
  if (remoteBranches.length !== 1) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_remote_branch_invalid',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Remote candidate branch '${repo.branch}' is ambiguous.`,
    };
  }
  const remoteHead = remoteBranches[0].commit;
  const baseCommit = identity.commit;
  const baseAncestor = invokeGit(['merge-base', '--is-ancestor', baseCommit, repo.head], repo.root, options);
  if (baseAncestor.exitCode !== 0) {
    return {
      allowed: false,
      mode: 'vibe-git-handoff',
      reason: 'handoff_base_diverged',
      branch: repo.branch,
      candidate_id: parsed.candidate_id,
      message: `Current branch is not descended from the published handoff base ${baseCommit}.`,
    };
  }
  if (remoteHead !== repo.head) {
    const remoteAncestor = invokeGit(['merge-base', '--is-ancestor', remoteHead, repo.head], repo.root, options);
    if (remoteAncestor.exitCode !== 0) {
      const localAncestor = invokeGit(['merge-base', '--is-ancestor', repo.head, remoteHead], repo.root, options);
      return {
        allowed: false,
        mode: 'vibe-git-handoff',
        reason: localAncestor.exitCode === 0 ? 'handoff_worker_behind' : 'handoff_worker_diverged',
        branch: repo.branch,
        candidate_id: parsed.candidate_id,
        message: localAncestor.exitCode === 0
          ? `Worker branch is behind '${remote}/${repo.branch}'; fetch and fast-forward before running fvgsd.`
          : `Worker branch has diverged from '${remote}/${repo.branch}'.`,
      };
    }
  }

  return {
    allowed: true,
    action: 'reused',
    mode: 'vibe-git-handoff',
    reason: 'handoff_candidate_verified',
    branch: repo.branch,
    candidate_id: parsed.candidate_id,
    run_id: parsed.run,
    runtime: parsed.tool,
    remote,
    base_commit: baseCommit,
    remote_commit: remoteHead,
    dirty_count: repo.dirty.length,
    message: `Verified multi-machine Vibe handoff '${parsed.candidate_id}' against '${remote}'.`,
  };
}

function inspectExecutionBranch(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const env = options.env || process.env;
  const command = sanitizeSegment(options.command, 'unknown-command');
  const runtime = detectRuntime(cwd, env, options.runtime);
  const repo = resolveRepoContext(cwd, options.gitOptions);
  if (!repo.ok) {
    if (options.readOnly) {
      return {
        allowed: true,
        action: 'inspected',
        mode: 'no-repository',
        reason: repo.reason,
        command,
        runtime,
        branch: null,
        message: 'No Git repository is active; the read-only command may continue.',
      };
    }
    return { allowed: false, action: 'blocked', mode: 'none', command, runtime, ...repo };
  }

  const store = findVibeStore(repo.root, options);
  const smart = parseSmartBranch(repo.branch);
  if (smart) {
    if (store) {
      let registered = false;
      try {
        if (fs.existsSync(store.paths.standaloneExecutions)) {
          const state = store.readJson(store.paths.standaloneExecutions, 'Standalone execution state');
          registered = Array.isArray(state.executions)
            && state.executions.some((execution) => execution.branch === repo.branch);
        }
      } catch {
        registered = false;
      }
      if (!registered) {
        return {
          allowed: false,
          action: 'blocked',
          mode: 'vibe-managed',
          reason: 'vibe_standalone_not_registered',
          branch: repo.branch,
          command,
          runtime,
          message: `Standalone branch '${repo.branch}' is not registered in this VibeClaw project.`,
          hint: 'Run `vibe init` on the standalone branch to import it, or use a prepared Vibe candidate worktree.',
        };
      }
    }
    if (runtime !== 'unknown' && smart.runtime !== runtime) {
      return {
        allowed: false,
        action: 'blocked',
        mode: 'standalone-smart-branch',
        reason: 'smart_branch_runtime_mismatch',
        branch: repo.branch,
        command,
        runtime,
        execution: smart,
        message: `Standalone branch '${repo.branch}' belongs to '${smart.runtime}', not '${runtime}'.`,
        hint: 'Switch back to the branch this execution started from, then rerun the command so fvgsd can create a tool-specific branch.',
      };
    }
    if (smart.command !== command) {
      return {
        allowed: true,
        action: 'inspected',
        mode: 'standalone-command-transition',
        reason: 'new_command_branch_needed',
        branch: repo.branch,
        command,
        runtime,
        execution: smart,
        metadata: readMetadata(repo.commonDir, repo.branch),
        base_commit: repo.head,
        dirty_count: repo.dirty.length,
        message: `Command '${command}' needs its own execution branch after '${smart.command}'.`,
        _repo: repo,
      };
    }
    return {
      allowed: true,
      action: 'reused',
      mode: 'standalone-smart-branch',
      reason: 'smart_branch_verified',
      branch: repo.branch,
      command,
      runtime,
      execution: smart,
      metadata: readMetadata(repo.commonDir, repo.branch),
      dirty_count: repo.dirty.length,
      message: `Verified existing standalone execution branch '${repo.branch}'.`,
      _repo: repo,
    };
  }

  if (store && options.readOnly) {
    return {
      allowed: true,
      action: 'inspected',
      mode: 'vibe-inspection',
      reason: 'vibe_read_only_allowed',
      branch: repo.branch,
      command,
      runtime,
      dirty_count: repo.dirty.length,
      message: `Inspected VibeClaw state from '${repo.branch || '(detached)'}' without creating an execution branch.`,
    };
  }

  if (store) {
    const result = inspectVibeCandidate(store, repo, runtime, env);
    if (!result.allowed && repo.branch && repo.branch.startsWith('vibe/')) {
      const handoff = inspectGitHandoff(repo, runtime, command, options.gitOptions || options);
      if (handoff) return { action: handoff.allowed ? handoff.action : 'blocked', command, runtime, ...handoff };
    }
    return { action: result.allowed ? result.action : 'blocked', mode: result.mode || 'vibe-managed', command, runtime, ...result };
  }

  if (repo.branch && repo.branch.startsWith('vibe/')) {
    const handoff = inspectGitHandoff(repo, runtime, command, options.gitOptions || options);
    if (handoff) return { action: handoff.allowed ? handoff.action : 'blocked', command, runtime, ...handoff };
    return {
      allowed: false,
      action: 'blocked',
      mode: 'vibe-state-missing',
      reason: 'vibe_state_missing',
      branch: repo.branch,
      command,
      runtime,
      message: `Branch '${repo.branch}' looks Vibe-managed, but no .planning-fvgsd-vibe state could be found.`,
      hint: 'Restore the matching .planning-fvgsd-vibe state or switch to a normal branch before retrying.',
    };
  }

  return {
    allowed: true,
    action: 'inspected',
    mode: 'standalone-unmanaged',
    reason: 'smart_branch_needed',
    branch: repo.branch,
    command,
    runtime,
    base_commit: repo.head,
    dirty_count: repo.dirty.length,
    message: 'No VibeClaw setup or standalone execution branch is active.',
    _repo: repo,
  };
}

function publicResult(result) {
  const { _repo, ...value } = result;
  return value;
}

function ensureExecutionBranch(options = {}) {
  const env = options.env || process.env;
  const inspected = inspectExecutionBranch(options);
  if (!inspected.allowed || inspected.action !== 'inspected') {
    if (inspected.allowed && inspected.mode === 'standalone-smart-branch' && !inspected.metadata) {
      try {
        const parsed = parseSmartBranch(inspected.branch);
        const metadata = makeMetadata(
          inspected._repo,
          inspected.branch,
          parsed,
          inspected.command,
          inspected.runtime,
          env,
          options,
        );
        atomicWriteJson(metadataPath(inspected._repo.commonDir, inspected.branch), metadata);
        inspected.metadata = metadata;
        inspected.action = 'adopted';
        inspected.reason = 'smart_branch_adopted';
      } catch (error) {
        inspected.metadata_warning = error.message;
      }
    }
    return publicResult(inspected);
  }

  const repo = inspected._repo;
  const id = executionId(env, options);
  const runtime = sanitizeSegment(inspected.runtime, 'unknown');
  const command = sanitizeSegment(inspected.command, 'unknown-command');
  const branch = `${SMART_BRANCH_PREFIX}${runtime}/${command}/${id}`;
  const created = invokeGit(['switch', '-c', branch], repo.root, options.gitOptions);
  if (created.exitCode !== 0) {
    return publicResult({
      ...inspected,
      allowed: false,
      action: 'blocked',
      reason: 'smart_branch_create_failed',
      branch,
      message: `Could not create standalone execution branch '${branch}'.`,
      stderr: created.stderr,
    });
  }

  const parsed = parseSmartBranch(branch);
  const metadata = makeMetadata(repo, branch, parsed, command, runtime, env, options);
  let metadataWarning = null;
  try {
    atomicWriteJson(metadataPath(repo.commonDir, branch), metadata);
  } catch (error) {
    metadataWarning = error.message;
  }

  return {
    allowed: true,
    action: 'created',
    mode: 'standalone-smart-branch',
    reason: 'smart_branch_created',
    branch,
    source_branch: repo.branch,
    base_commit: repo.head,
    command,
    runtime,
    execution: parsed,
    metadata,
    metadata_warning: metadataWarning,
    dirty_count: repo.dirty.length,
    message: `Created standalone execution branch '${branch}'.`,
  };
}

function readMetadataInventory(commonDir) {
  const directory = metadataDirectory(commonDir);
  if (!fs.existsSync(directory)) return [];
  const values = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(directory, entry.name), 'utf8'));
      if (parsed && parseSmartBranch(parsed.branch)) values.push(parsed);
    } catch {
      // One corrupt local record must not prevent VibeClaw initialization.
    }
  }
  return values;
}

function discoverStandaloneExecutions(projectRoot, options = {}) {
  const repo = resolveRepoContext(projectRoot, options.gitOptions);
  if (!repo.ok) return [];
  const records = new Map();
  for (const metadata of readMetadataInventory(repo.commonDir)) {
    records.set(metadata.branch, { ...metadata, source: 'git-metadata' });
  }

  const refs = invokeGit(
    ['for-each-ref', '--format=%(refname:short)\t%(objectname)', 'refs/heads/fvgsd/'],
    repo.root,
    options.gitOptions,
  );
  if (refs.exitCode === 0) {
    for (const line of refs.stdout.split(/\r?\n/).filter(Boolean)) {
      const [branch, headCommit] = line.split('\t');
      const parsed = parseSmartBranch(branch);
      if (!parsed) continue;
      const existing = records.get(branch) || {};
      records.set(branch, {
        schema_version: METADATA_VERSION,
        execution_id: parsed.execution_id,
        branch,
        runtime: existing.runtime || parsed.runtime,
        command: existing.command || parsed.command,
        source_branch: existing.source_branch || null,
        base_commit: existing.base_commit || null,
        created_at: existing.created_at || null,
        session_fingerprint: existing.session_fingerprint || null,
        source: existing.source || 'branch-name',
        head_commit: headCommit || null,
        status: 'present',
      });
    }
  }

  for (const [branch, record] of records) {
    if (record.status) continue;
    const currentUnborn = repo.branch === branch && !repo.head;
    records.set(branch, {
      ...record,
      head_commit: currentUnborn ? null : record.head_commit || null,
      status: currentUnborn ? 'current-unborn' : 'missing',
    });
  }

  return [...records.values()].sort((left, right) => left.branch.localeCompare(right.branch));
}

module.exports = {
  SMART_BRANCH_PREFIX,
  detectRuntime,
  parseSmartBranch,
  inspectExecutionBranch,
  ensureExecutionBranch,
  discoverStandaloneExecutions,
  resolveRepoContext,
};
