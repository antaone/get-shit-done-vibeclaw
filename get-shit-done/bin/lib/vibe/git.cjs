'use strict';

const fs = require('fs');
const path = require('path');
const { execGit: execGitSeam } = require('../shell-command-projection.cjs');
const { VibeError, invariant } = require('./errors.cjs');

function invoke(args, cwd, options = {}) {
  const exec = options.execGit || execGitSeam;
  const result = exec(args, { cwd, timeout: options.timeout ?? 15000 });
  return { ...result, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

function requireGit(args, cwd, code, message, options = {}) {
  const result = invoke(args, cwd, options);
  if (result.exitCode !== 0) {
    throw new VibeError(code, message, { args, cwd, stderr: result.stderr, exit_code: result.exitCode });
  }
  return result.stdout;
}

function ensureRepository(cwd, options = {}) {
  const root = requireGit(['rev-parse', '--show-toplevel'], cwd, 'GIT_REQUIRED', 'This operation requires a Git repository', options);
  return path.resolve(root);
}

function resolveCommit(cwd, ref = 'HEAD', options = {}) {
  return requireGit(['rev-parse', '--verify', `${ref}^{commit}`], cwd, 'GIT_COMMIT_UNKNOWN', `Cannot resolve Git commit '${ref}'`, options);
}

function currentBranch(cwd, options = {}) {
  return requireGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, 'GIT_DETACHED', 'The integration worktree must be on a branch', options);
}

function branchHead(cwd, branch, options = {}) {
  const result = invoke(['show-ref', '--verify', '--hash', `refs/heads/${branch}`], cwd, options);
  return result.exitCode === 0 ? result.stdout : null;
}

function tagHead(cwd, tag, options = {}) {
  const result = invoke(['show-ref', '--verify', '--hash', `refs/tags/${tag}`], cwd, options);
  return result.exitCode === 0 ? result.stdout : null;
}

function validateRemoteName(remote) {
  const value = String(remote || '').trim();
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value), 'GIT_REMOTE_INVALID', `Invalid Git remote name '${remote || ''}'`);
  return value;
}

function ensureRemote(cwd, remote, options = {}) {
  const name = validateRemoteName(remote);
  const url = requireGit(['remote', 'get-url', name], cwd, 'GIT_REMOTE_REQUIRED', `Git remote '${name}' is not configured`, options);
  return { name, url };
}

function parseLsRemote(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [commit, ref] = line.trim().split(/\s+/, 2);
      return { commit, ref };
    })
    .filter((item) => /^[0-9a-f]{40,64}$/i.test(item.commit || '') && item.ref);
}

function remoteRefHead(cwd, remote, ref, options = {}) {
  const name = validateRemoteName(remote);
  const result = invoke(['ls-remote', '--exit-code', name, ref], cwd, { ...options, timeout: options.remoteTimeout ?? 30000 });
  if (result.exitCode === 2) return null;
  if (result.exitCode !== 0) {
    throw new VibeError('GIT_REMOTE_UNAVAILABLE', `Could not inspect '${ref}' on Git remote '${name}'`, {
      remote: name,
      ref,
      stderr: result.stderr,
      exit_code: result.exitCode,
    });
  }
  const matches = parseLsRemote(result.stdout).filter((item) => item.ref === ref);
  invariant(matches.length === 1, 'GIT_REMOTE_REF_INVALID', `Git remote '${name}' returned an ambiguous ref '${ref}'`);
  return matches[0].commit;
}

function normalizeHandoffCommand(candidate) {
  let command = String(candidate.contract && candidate.contract.gsd && candidate.contract.gsd.command || '').trim().toLowerCase();
  command = command.replace(/^\$/, '').replace(/^\//, '').replace(/^fvgsd(?::|-)/, '');
  invariant(/^[a-z][a-z0-9-]*$/.test(command), 'HANDOFF_COMMAND_INVALID', `Candidate '${candidate.id}' has no portable fvgsd command`);
  return command;
}

function handoffTag(candidate) {
  return `vibe-handoff/${candidate.id}/${normalizeHandoffCommand(candidate)}`;
}

function completionTag(candidate) {
  return `vibe-complete/${candidate.id}`;
}

function ensureLightweightTag(cwd, tag, commit, options = {}) {
  const existing = tagHead(cwd, tag, options);
  if (existing) {
    invariant(existing === commit, 'HANDOFF_TAG_CONFLICT', `Tag '${tag}' already points to a different commit`, {
      expected: commit,
      actual: existing,
    });
    return false;
  }
  requireGit(['tag', tag, commit], cwd, 'HANDOFF_TAG_CREATE_FAILED', `Could not create Git handoff tag '${tag}'`, options);
  return true;
}

function publishCandidateHandoff({ projectRoot, run, candidate, remote }, options = {}) {
  const repoRoot = ensureRepository(projectRoot, options);
  const remoteInfo = ensureRemote(repoRoot, remote, options);
  const tag = handoffTag(candidate);
  const baseCommit = resolveCommit(repoRoot, candidate.git.base_commit, options);
  invariant(branchHead(repoRoot, candidate.git.branch, options) === baseCommit, 'HANDOFF_BRANCH_ADVANCED', `Candidate branch '${candidate.git.branch}' must still be at its base before handoff`);
  const createdTag = ensureLightweightTag(repoRoot, tag, baseCommit, options);
  try {
    requireGit([
      'push', '--atomic', remoteInfo.name,
      `refs/heads/${run.integration_branch}:refs/heads/${run.integration_branch}`,
      `refs/heads/${candidate.git.branch}:refs/heads/${candidate.git.branch}`,
      `refs/tags/${tag}:refs/tags/${tag}`,
    ], repoRoot, 'HANDOFF_PUSH_FAILED', `Could not atomically publish candidate '${candidate.id}' to '${remoteInfo.name}'`, {
      ...options,
      timeout: options.remoteTimeout ?? 30000,
    });
    const remoteBranch = remoteRefHead(repoRoot, remoteInfo.name, `refs/heads/${candidate.git.branch}`, options);
    const remoteTag = remoteRefHead(repoRoot, remoteInfo.name, `refs/tags/${tag}`, options);
    invariant(remoteBranch === baseCommit && remoteTag === baseCommit, 'HANDOFF_PUSH_UNVERIFIED', `Remote handoff for '${candidate.id}' does not match its reviewed base`, {
      base_commit: baseCommit,
      remote_branch: remoteBranch,
      remote_tag: remoteTag,
    });
    return {
      mode: 'multi-machine',
      remote: remoteInfo.name,
      tag,
      completion_tag: completionTag(candidate),
      published_commit: baseCommit,
      published_at: new Date().toISOString(),
    };
  } catch (error) {
    if (createdTag) invoke(['tag', '-d', tag], repoRoot, options);
    throw error;
  }
}

function rollbackPublishedHandoff(candidate, options = {}) {
  const handoff = candidate.git && candidate.git.handoff;
  if (!handoff || handoff.mode !== 'multi-machine') return { remote_deleted: false, tag_deleted: false };
  const repoRoot = ensureRepository(candidate.project_root, options);
  const remoteBranch = remoteRefHead(repoRoot, handoff.remote, `refs/heads/${candidate.git.branch}`, options);
  const remoteTag = remoteRefHead(repoRoot, handoff.remote, `refs/tags/${handoff.tag}`, options);
  let remoteDeleted = false;
  if (remoteBranch === candidate.git.base_commit && remoteTag === candidate.git.base_commit) {
    requireGit([
      'push', '--atomic', handoff.remote,
      `:refs/heads/${candidate.git.branch}`,
      `:refs/tags/${handoff.tag}`,
    ], repoRoot, 'HANDOFF_ROLLBACK_FAILED', `Could not roll back remote handoff '${candidate.id}'`, {
      ...options,
      timeout: options.remoteTimeout ?? 30000,
    });
    remoteDeleted = true;
  }
  const localTag = tagHead(repoRoot, handoff.tag, options);
  if (localTag === candidate.git.base_commit) invoke(['tag', '-d', handoff.tag], repoRoot, options);
  return { remote_deleted: remoteDeleted, tag_deleted: localTag === candidate.git.base_commit };
}

function receiveCandidateHandoff(candidate, options = {}) {
  const handoff = candidate.git && candidate.git.handoff;
  invariant(handoff && handoff.mode === 'multi-machine', 'HANDOFF_NOT_ENABLED', `Candidate '${candidate.id}' is not a multi-machine handoff`);
  const repoRoot = ensureRepository(candidate.project_root, options);
  ensureRemote(repoRoot, handoff.remote, options);
  const remoteTag = remoteRefHead(repoRoot, handoff.remote, `refs/tags/${handoff.tag}`, options);
  invariant(remoteTag === candidate.git.base_commit, 'HANDOFF_IDENTITY_MISMATCH', `Remote handoff identity for '${candidate.id}' changed`, {
    expected: candidate.git.base_commit,
    actual: remoteTag,
  });
  const trackingRef = `refs/remotes/${handoff.remote}/${candidate.git.branch}`;
  requireGit([
    'fetch', '--no-tags', handoff.remote,
    `+refs/heads/${candidate.git.branch}:${trackingRef}`,
  ], repoRoot, 'HANDOFF_FETCH_FAILED', `Could not fetch candidate '${candidate.id}' from '${handoff.remote}'`, {
    ...options,
    timeout: options.remoteTimeout ?? 30000,
  });
  const remoteHead = resolveCommit(repoRoot, trackingRef, options);
  invariant(isAncestor(repoRoot, candidate.git.base_commit, remoteHead, options), 'BASE_DIVERGED', `Remote candidate '${candidate.id}' is not descended from its recorded base`);
  invariant(remoteHead !== candidate.git.base_commit, 'HANDOFF_RESULT_COMMIT_REQUIRED', `Multi-machine candidate '${candidate.id}' must push at least one result commit`);
  invariant(candidate.git.worktree && fs.existsSync(candidate.git.worktree), 'WORKTREE_MISSING', `Coordinator worktree is missing: ${candidate.git.worktree}`);
  const dirty = worktreeDirty(candidate.git.worktree, options);
  invariant(dirty.length === 0, 'WORKTREE_DIRTY', `Coordinator worktree for '${candidate.id}' has uncommitted changes`, { files: dirty });
  const actualBranch = currentBranch(candidate.git.worktree, options);
  invariant(actualBranch === candidate.git.branch, 'BRANCH_MISMATCH', `Coordinator worktree is on '${actualBranch}', expected '${candidate.git.branch}'`);
  const localHead = resolveCommit(candidate.git.worktree, 'HEAD', options);
  invariant(isAncestor(repoRoot, localHead, remoteHead, options), 'HANDOFF_DIVERGED', `Coordinator branch '${candidate.git.branch}' cannot fast-forward to the pushed worker result`, {
    local_commit: localHead,
    remote_commit: remoteHead,
  });
  if (localHead !== remoteHead) {
    requireGit(['merge', '--ff-only', trackingRef], candidate.git.worktree, 'HANDOFF_FAST_FORWARD_FAILED', `Could not fast-forward coordinator candidate '${candidate.id}'`, options);
  }
  const received = resolveCommit(candidate.git.worktree, 'HEAD', options);
  invariant(received === remoteHead, 'HANDOFF_RECEIVE_UNVERIFIED', `Coordinator did not receive the exact pushed result for '${candidate.id}'`);
  return { remote: handoff.remote, remote_commit: remoteHead, received_commit: received };
}

function publishCompletionHandoff(candidate, resultCommit, options = {}) {
  const handoff = candidate.git && candidate.git.handoff;
  if (!handoff || handoff.mode !== 'multi-machine') return null;
  const repoRoot = ensureRepository(candidate.project_root, options);
  const remoteHead = remoteRefHead(repoRoot, handoff.remote, `refs/heads/${candidate.git.branch}`, options);
  invariant(remoteHead === resultCommit, 'HANDOFF_PUSH_REQUIRED', `Push candidate '${candidate.git.branch}' to '${handoff.remote}' before completion`, {
    expected: resultCommit,
    remote_commit: remoteHead,
  });
  const tag = handoff.completion_tag || completionTag(candidate);
  const existingRemote = remoteRefHead(repoRoot, handoff.remote, `refs/tags/${tag}`, options);
  if (existingRemote) {
    invariant(existingRemote === resultCommit, 'HANDOFF_COMPLETION_CONFLICT', `Remote completion marker '${tag}' points to a different commit`);
    return { tag, commit: resultCommit, already_published: true };
  }
  ensureLightweightTag(repoRoot, tag, resultCommit, options);
  requireGit(['push', handoff.remote, `refs/tags/${tag}:refs/tags/${tag}`], repoRoot, 'HANDOFF_COMPLETION_PUSH_FAILED', `Could not publish completion marker for '${candidate.id}'`, {
    ...options,
    timeout: options.remoteTimeout ?? 30000,
  });
  const published = remoteRefHead(repoRoot, handoff.remote, `refs/tags/${tag}`, options);
  invariant(published === resultCommit, 'HANDOFF_COMPLETION_UNVERIFIED', `Completion marker for '${candidate.id}' was not published exactly`);
  return { tag, commit: resultCommit, already_published: false };
}

function validatePublishedHandoff(candidate, options = {}) {
  const handoff = candidate.git && candidate.git.handoff;
  if (!handoff || handoff.mode !== 'multi-machine') return null;
  const repoRoot = ensureRepository(candidate.project_root, options);
  const remoteHead = remoteRefHead(repoRoot, handoff.remote, `refs/heads/${candidate.git.branch}`, options);
  const identity = remoteRefHead(repoRoot, handoff.remote, `refs/tags/${handoff.tag}`, options);
  const completed = remoteRefHead(repoRoot, handoff.remote, `refs/tags/${handoff.completion_tag || completionTag(candidate)}`, options);
  invariant(remoteHead === candidate.git.result_commit, 'HANDOFF_REMOTE_ADVANCED', `Remote candidate branch '${candidate.git.branch}' does not match the completed result`, {
    expected: candidate.git.result_commit,
    actual: remoteHead,
  });
  invariant(identity === candidate.git.base_commit, 'HANDOFF_IDENTITY_MISMATCH', `Remote handoff identity for '${candidate.id}' changed`);
  invariant(completed === candidate.git.result_commit, 'HANDOFF_COMPLETION_REQUIRED', `Remote completion marker for '${candidate.id}' is missing or stale`);
  return { remote: handoff.remote, remote_commit: remoteHead, completion_commit: completed };
}

function pushIntegrationHandoff(run, candidate, integrationCommit, options = {}) {
  const handoff = candidate.git && candidate.git.handoff;
  if (!handoff || handoff.mode !== 'multi-machine') return null;
  const repoRoot = ensureRepository(candidate.project_root, options);
  requireGit([
    'push', handoff.remote,
    `refs/heads/${run.integration_branch}:refs/heads/${run.integration_branch}`,
  ], repoRoot, 'HANDOFF_INTEGRATION_PUSH_FAILED', `Promotion succeeded locally but '${run.integration_branch}' could not be pushed to '${handoff.remote}'`, {
    ...options,
    timeout: options.remoteTimeout ?? 30000,
  });
  const remoteHead = remoteRefHead(repoRoot, handoff.remote, `refs/heads/${run.integration_branch}`, options);
  invariant(remoteHead === integrationCommit, 'HANDOFF_INTEGRATION_UNVERIFIED', `Remote integration branch '${run.integration_branch}' does not match the promoted commit`);
  return { remote: handoff.remote, remote_commit: remoteHead };
}

function isAncestor(cwd, ancestor, descendant, options = {}) {
  return invoke(['merge-base', '--is-ancestor', ancestor, descendant], cwd, options).exitCode === 0;
}

function assertPathWithin(parent, child, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  invariant(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'PATH_UNSAFE', `${label} must stay inside ${parent}`, { path: child });
}

function assertNoSymlinkAncestors(parent, child, label) {
  const root = path.resolve(parent);
  const relative = path.relative(root, path.resolve(child));
  let cursor = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    invariant(!fs.lstatSync(cursor).isSymbolicLink(), 'PATH_UNSAFE', `${label} cannot traverse a symbolic link`, { path: cursor });
  }
}

function prepareCandidateWorktree({ projectRoot, baseCommit, branch, worktreePath }, options = {}) {
  const repoRoot = ensureRepository(projectRoot, options);
  const base = resolveCommit(repoRoot, baseCommit, options);
  invariant(!branchHead(repoRoot, branch, options), 'BRANCH_EXISTS', `Candidate branch '${branch}' already exists`);
  assertPathWithin(path.join(repoRoot, '.fvgsd-vibe', 'worktrees'), worktreePath, 'Candidate worktree');
  assertNoSymlinkAncestors(repoRoot, worktreePath, 'Candidate worktree');
  invariant(!fs.existsSync(worktreePath), 'WORKTREE_EXISTS', `Candidate worktree path already exists: ${worktreePath}`);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const result = invoke(['worktree', 'add', '-b', branch, worktreePath, base], repoRoot, options);
  if (result.exitCode !== 0) {
    throw new VibeError('WORKTREE_CREATE_FAILED', `Could not create worktree for branch '${branch}'`, {
      stderr: result.stderr,
      branch,
      worktree: worktreePath,
      base_commit: base,
    });
  }
  return { repo_root: repoRoot, base_commit: base, branch, worktree: path.resolve(worktreePath) };
}

function rollbackPreparedWorktree({ projectRoot, branch, worktreePath, baseCommit }, options = {}) {
  const repoRoot = path.resolve(projectRoot);
  if (fs.existsSync(worktreePath)) invoke(['worktree', 'remove', worktreePath], repoRoot, options);
  const head = branchHead(repoRoot, branch, options);
  if (head && head === baseCommit) invoke(['branch', '-D', branch], repoRoot, options);
}

function worktreeDirty(worktreePath, options = {}) {
  const output = requireGit(['status', '--porcelain', '--untracked-files=all'], worktreePath, 'GIT_STATUS_FAILED', 'Could not inspect candidate worktree status', options);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function porcelainPath(line) {
  let value = String(line).slice(3).trim();
  if (value.includes(' -> ')) value = value.slice(value.indexOf(' -> ') + 4);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { value = JSON.parse(value); } catch { /* retain Git's display form */ }
  }
  return value.split('\\').join('/');
}

function isAllowedDirtyPath(line, allowedPaths) {
  const file = porcelainPath(line);
  return allowedPaths.some((allowed) => file === allowed || file.startsWith(`${allowed}/`));
}

function protectedChanges(projectRoot, baseCommit, resultCommit, options = {}) {
  const output = requireGit(
    ['diff', '--name-only', `${baseCommit}..${resultCommit}`, '--', '.planning-fvgsd-vibe', '.fvgsd-vibe'],
    projectRoot,
    'GIT_DIFF_FAILED',
    'Could not validate protected orchestration paths',
    options,
  );
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function changedFiles(projectRoot, baseCommit, resultCommit, options = {}) {
  const output = requireGit(
    ['diff', '--name-only', `${baseCommit}..${resultCommit}`],
    projectRoot,
    'GIT_DIFF_FAILED',
    'Could not inspect candidate changes',
    options,
  );
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function completeCandidateGit(candidate, options = {}) {
  const git = candidate.git;
  invariant(git && git.required, 'GIT_NOT_REQUIRED', `Candidate '${candidate.id}' has no Git worktree lifecycle`);
  invariant(git.worktree && fs.existsSync(git.worktree), 'WORKTREE_MISSING', `Candidate worktree is missing: ${git.worktree}`);
  let dirty = worktreeDirty(git.worktree, options);
  if (!candidate.contract.mutates_source && Array.isArray(options.allowedDirtyPaths)) {
    const allowed = options.allowedDirtyPaths.map((item) => String(item).replace(/^\.\//, '').split('\\').join('/'));
    dirty = dirty.filter((line) => !isAllowedDirtyPath(line, allowed));
  }
  invariant(dirty.length === 0, 'WORKTREE_DIRTY', `Candidate '${candidate.id}' has uncommitted changes`, { files: dirty });
  const actualBranch = currentBranch(git.worktree, options);
  invariant(actualBranch === git.branch, 'BRANCH_MISMATCH', `Candidate worktree is on '${actualBranch}', expected '${git.branch}'`);
  const resultCommit = resolveCommit(git.worktree, 'HEAD', options);
  invariant(isAncestor(git.worktree, git.base_commit, resultCommit, options), 'BASE_DIVERGED', `Candidate result is not descended from recorded base ${git.base_commit}`);
  const protectedPaths = protectedChanges(candidate.project_root, git.base_commit, resultCommit, options);
  invariant(protectedPaths.length === 0, 'PROTECTED_PATH_CHANGED', 'Candidate commits must not modify orchestration control paths', { files: protectedPaths });
  if (!candidate.contract.mutates_source) {
    const sourcePaths = changedFiles(candidate.project_root, git.base_commit, resultCommit, options)
      .filter((file) => file !== '.planning' && !file.startsWith('.planning/'));
    invariant(sourcePaths.length === 0, 'SOURCE_MUTATION_FORBIDDEN', `Stage '${candidate.stage}' does not allow source mutation`, { files: sourcePaths });
  }
  if (candidate.contract.requires_result_commit || options.requireResultCommit === true) {
    invariant(resultCommit !== git.base_commit, 'RESULT_COMMIT_REQUIRED', `Stage '${candidate.stage}' requires a source result commit`);
  }
  return resultCommit;
}

function sourceDirty(projectRoot, options = {}) {
  const pathspecs = [
    '.',
    ':(exclude).planning-fvgsd-vibe',
    ':(exclude).planning-fvgsd-vibe/**',
    ':(exclude).fvgsd-vibe',
    ':(exclude).fvgsd-vibe/**',
  ];
  const output = requireGit(
    ['status', '--porcelain', '--untracked-files=all', '--', ...pathspecs],
    projectRoot,
    'GIT_STATUS_FAILED',
    'Could not inspect integration worktree status',
    options,
  );
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function validateCandidateBranch(candidate, options = {}) {
  const head = branchHead(candidate.project_root, candidate.git.branch, options);
  invariant(head, 'BRANCH_MISSING', `Candidate branch '${candidate.git.branch}' no longer exists`);
  invariant(head === candidate.git.result_commit, 'BRANCH_ADVANCED', `Candidate branch '${candidate.git.branch}' no longer points at the completed result`, {
    expected: candidate.git.result_commit,
    actual: head,
  });
  invariant(isAncestor(candidate.project_root, candidate.git.base_commit, head, options), 'BASE_DIVERGED', 'Candidate branch is not descended from its recorded base');
}

function createExactTreeIntegrationCommit(projectRoot, candidate, currentHead, options = {}) {
  const tree = requireGit(
    ['rev-parse', `${candidate.git.result_commit}^{tree}`],
    projectRoot,
    'GIT_TREE_FAILED',
    'Could not resolve replacement candidate tree',
    options,
  );
  return requireGit(
    [
      'commit-tree', tree,
      '-p', currentHead,
      '-p', candidate.git.result_commit,
      '-m', `vibe: promote ${candidate.id} as replacement`,
    ],
    projectRoot,
    'PROMOTION_COMMIT_FAILED',
    'Could not create the replacement promotion commit',
    options,
  );
}

function promoteCandidateGit({ projectRoot, run, candidate, currentPromotion, replace = false }, options = {}) {
  const repoRoot = ensureRepository(projectRoot, options);
  validatePublishedHandoff(candidate, options);
  validateCandidateBranch(candidate, options);
  const branch = currentBranch(repoRoot, options);
  invariant(branch === run.integration_branch, 'INTEGRATION_BRANCH_MISMATCH', `Promotion must run from integration branch '${run.integration_branch}', not '${branch}'`);
  const dirty = sourceDirty(repoRoot, options);
  invariant(dirty.length === 0, 'INTEGRATION_DIRTY', 'Promotion is blocked by uncommitted source changes', { files: dirty });

  const currentHead = resolveCommit(repoRoot, 'HEAD', options);
  const expectedHead = currentPromotion ? currentPromotion.integration_commit : candidate.git.base_commit;
  invariant(currentHead === expectedHead, 'INTEGRATION_ADVANCED', 'The integration branch no longer matches the recorded promotion base', {
    expected: expectedHead,
    actual: currentHead,
  });

  if (currentPromotion) {
    invariant(replace, 'PROMOTION_EXISTS', `Stage '${candidate.stage}' already has a promoted candidate; pass --replace to replace it`);
  } else {
    invariant(!replace, 'PROMOTION_REPLACE_MISSING', `Stage '${candidate.stage}' has no promotion to replace`);
  }

  let target = candidate.git.result_commit;
  let strategy = 'fast-forward';
  if (currentPromotion) {
    target = createExactTreeIntegrationCommit(repoRoot, candidate, currentHead, options);
    strategy = 'exact-tree-replacement';
  } else if (target === currentHead) {
    strategy = 'record-only';
  }

  if (target !== currentHead) {
    requireGit(['merge', '--ff-only', target], repoRoot, 'PROMOTION_GIT_FAILED', `Could not advance '${run.integration_branch}' to promoted candidate`, options);
  }
  const integrationCommit = resolveCommit(repoRoot, 'HEAD', options);
  const handoffPush = pushIntegrationHandoff(run, candidate, integrationCommit, options);
  return { strategy, previous_integration_commit: currentHead, integration_commit: integrationCommit, handoff_push: handoffPush };
}

function cleanupCandidateWorktree(candidate, { deleteBranch = false, ...options } = {}) {
  const git = candidate.git;
  invariant(git && git.required, 'GIT_NOT_REQUIRED', `Candidate '${candidate.id}' has no worktree`);
  const result = { worktree_removed: false, branch_deleted: false, worktree_missing: false };
  if (fs.existsSync(git.worktree)) {
    const dirty = worktreeDirty(git.worktree, options);
    const persistedArtifacts = (candidate.outputs && candidate.outputs.artifacts || []).map((artifact) => artifact.source_path);
    const onlyPersistedArtifacts = !candidate.contract.mutates_source
      && dirty.length > 0
      && dirty.every((line) => isAllowedDirtyPath(line, persistedArtifacts));
    invariant(
      dirty.length === 0 || onlyPersistedArtifacts,
      'WORKTREE_DIRTY',
      `Cannot clean dirty candidate worktree '${git.worktree}'`,
      { files: dirty },
    );
    const removeArgs = ['worktree', 'remove'];
    if (onlyPersistedArtifacts) removeArgs.push('--force');
    removeArgs.push(git.worktree);
    requireGit(removeArgs, candidate.project_root, 'WORKTREE_REMOVE_FAILED', `Could not remove candidate worktree '${git.worktree}'`, options);
    result.worktree_removed = true;
    if (onlyPersistedArtifacts) result.persisted_artifacts_preserved = true;
  } else {
    result.worktree_missing = true;
    invoke(['worktree', 'prune'], candidate.project_root, options);
  }
  if (deleteBranch) {
    const head = branchHead(candidate.project_root, git.branch, options);
    if (head) {
      invariant(head === git.result_commit, 'BRANCH_ADVANCED', `Refusing to delete advanced branch '${git.branch}'`);
      requireGit(['branch', '-D', git.branch], candidate.project_root, 'BRANCH_DELETE_FAILED', `Could not delete candidate branch '${git.branch}'`, options);
      result.branch_deleted = true;
    }
  }
  return result;
}

function ensurePrivateWorktreeExclude(projectRoot, options = {}) {
  const result = invoke(['rev-parse', '--git-path', 'info/exclude'], projectRoot, options);
  if (result.exitCode !== 0) return { updated: false, reason: 'not-a-git-repository' };
  const excludePath = path.isAbsolute(result.stdout) ? result.stdout : path.resolve(projectRoot, result.stdout);
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  if (current.split(/\r?\n/).map((line) => line.trim()).includes('.fvgsd-vibe/')) {
    return { updated: false, path: excludePath };
  }
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(excludePath, `${prefix}.fvgsd-vibe/\n`, 'utf8');
  return { updated: true, path: excludePath };
}

module.exports = {
  invoke,
  ensureRepository,
  resolveCommit,
  currentBranch,
  branchHead,
  tagHead,
  isAncestor,
  ensureRemote,
  remoteRefHead,
  handoffTag,
  completionTag,
  publishCandidateHandoff,
  rollbackPublishedHandoff,
  receiveCandidateHandoff,
  publishCompletionHandoff,
  validatePublishedHandoff,
  pushIntegrationHandoff,
  prepareCandidateWorktree,
  rollbackPreparedWorktree,
  completeCandidateGit,
  promoteCandidateGit,
  cleanupCandidateWorktree,
  ensurePrivateWorktreeExclude,
  sourceDirty,
  protectedChanges,
};
