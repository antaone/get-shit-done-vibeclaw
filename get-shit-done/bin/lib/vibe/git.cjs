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
  assertPathWithin(path.join(repoRoot, '.vibe', 'worktrees'), worktreePath, 'Candidate worktree');
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
    ['diff', '--name-only', `${baseCommit}..${resultCommit}`, '--', '.planning-vibe', '.vibe'],
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
  if (candidate.contract.mutates_source) {
    invariant(resultCommit !== git.base_commit, 'RESULT_COMMIT_REQUIRED', `Stage '${candidate.stage}' requires a source result commit`);
  }
  return resultCommit;
}

function sourceDirty(projectRoot, options = {}) {
  const pathspecs = [
    '.',
    ':(exclude).planning-vibe',
    ':(exclude).planning-vibe/**',
    ':(exclude).vibe',
    ':(exclude).vibe/**',
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
  return { strategy, previous_integration_commit: currentHead, integration_commit: integrationCommit };
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
  if (current.split(/\r?\n/).map((line) => line.trim()).includes('.vibe/')) {
    return { updated: false, path: excludePath };
  }
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(excludePath, `${prefix}.vibe/\n`, 'utf8');
  return { updated: true, path: excludePath };
}

module.exports = {
  invoke,
  ensureRepository,
  resolveCommit,
  currentBranch,
  branchHead,
  isAncestor,
  prepareCandidateWorktree,
  rollbackPreparedWorktree,
  completeCandidateGit,
  promoteCandidateGit,
  cleanupCandidateWorktree,
  ensurePrivateWorktreeExclude,
  sourceDirty,
  protectedChanges,
};
