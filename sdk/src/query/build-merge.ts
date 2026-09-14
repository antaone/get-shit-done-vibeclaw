/**
 * build.merge-wave — merge a wave's isolated slice branches into the current
 * branch, abort conflicting merges cleanly, and remove merged worktrees.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { normalizePhaseName } from './helpers.js';
import { parseFlags, runGit } from './build-shared.js';
import type { QueryHandler } from './utils.js';

type BlockReason =
  | 'invalid_branch' | 'protected_branch' | 'branch_mismatch' | 'worktree_dirty'
  | 'base_mismatch' | 'bulk_deletions' | 'merge_failed' | 'cleanup_failed';

export interface MergeWaveData {
  merged: string[];
  conflicts: Array<{ slice: string; files: string[] }>;
  blocked: Array<{ slice: string; reason: BlockReason; detail: string }>;
  skipped: Array<{ slice: string; reason: 'not_done' | 'not_isolated' }>;
  cleaned: string[];
}

interface SliceResultInput {
  slice: string;
  status: string;
  branch: string;
  worktree_path: string;
}

const BULK_DELETION_LIMIT = 5;
const PROTECTED_BRANCH = /^(?:main|master|develop|trunk|release\/.+)$/;

function sliceOrder(slice: string): number {
  const match = /^s(\d+)$/.exec(slice);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseResults(raw: string): SliceResultInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GSDError('slice results must be valid JSON', ErrorClassification.Validation);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new GSDError('slice results must be a JSON array of objects', ErrorClassification.Validation);
  }
  return parsed.map((item, index) => {
    const record = item as Record<string, unknown>;
    const slice = text(record.slice);
    if (!/^s\d+$/.test(slice) && slice !== 'fix') {
      throw new GSDError(`slice results[${index}].slice must be a slice id like s1`, ErrorClassification.Validation);
    }
    return { slice, status: text(record.status), branch: text(record.branch), worktree_path: text(record.worktree_path) };
  });
}

function readResults(projectDir: string, flags: Record<string, string | boolean>): string {
  const inline = flags.results;
  const file = flags['results-file'];
  if ((typeof inline === 'string') === (typeof file === 'string')) {
    throw new GSDError('pass exactly one of --results <json> or --results-file <path>', ErrorClassification.Validation);
  }
  if (typeof inline === 'string') return inline;
  const absolute = resolve(projectDir, file as string);
  if (!existsSync(absolute)) {
    throw new GSDError(`--results-file not found: ${String(file)}`, ErrorClassification.Validation);
  }
  return readFileSync(absolute, 'utf-8');
}

function lines(output: string): string[] {
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export const buildMergeWave: QueryHandler = async (args, projectDir) => {
  const { flags, positionals } = parseFlags(args, { values: ['phase', 'base', 'results', 'results-file'] });
  if (positionals.length > 0) {
    throw new GSDError(`unexpected argument: ${positionals[0]}`, ErrorClassification.Validation);
  }
  if (typeof flags.phase !== 'string') throw new GSDError('--phase <P> is required', ErrorClassification.Validation);
  if (typeof flags.base !== 'string') throw new GSDError('--base <commit> is required', ErrorClassification.Validation);
  const results = parseResults(readResults(projectDir, flags)).sort((a, b) => sliceOrder(a.slice) - sliceOrder(b.slice));
  const padded = normalizePhaseName(flags.phase);

  const baseCheck = runGit(projectDir, ['rev-parse', '--verify', '--quiet', `${flags.base}^{commit}`]);
  if (!baseCheck.ok) {
    throw new GSDError(`--base does not name a commit: ${flags.base}`, ErrorClassification.Validation);
  }
  const base = baseCheck.stdout;

  const status = runGit(projectDir, ['status', '--porcelain', '--untracked-files=no']);
  if (!status.ok) return { data: { error: 'git_repository_required' } };
  if (status.stdout !== '') return { data: { error: 'working_tree_dirty' } };

  const current = runGit(projectDir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const currentBranch = current.ok ? current.stdout : '';
  const data: MergeWaveData = { merged: [], conflicts: [], blocked: [], skipped: [], cleaned: [] };
  const block = (slice: string, reason: BlockReason, detail: string): void => {
    data.blocked.push({ slice, reason, detail });
  };

  // Per-slice sequence below follows executeWorktreeWaveCleanupPlan in
  // get-shit-done/bin/lib/worktree-safety.cjs (branch check → base check →
  // deletion check → worktree-dirty check → merge → worktree remove →
  // branch delete), but differs in five ways the CJS sequence does not need
  // for its single caller:
  //   - it continues past a blocked or conflicting slice instead of stopping
  //     the whole wave, so one bad slice doesn't hold up the rest;
  //   - it aborts a conflicting `git merge` (`merge --abort`) so the tree is
  //     always clean on return, rather than leaving MERGE_HEAD for the caller;
  //   - the base check accepts a branch whose merge base with HEAD is newer
  //     than the wave `--base` (as long as `--base` is still its ancestor),
  //     so a conflict-resolved branch that has merged the current branch in
  //     passes on retry instead of being rejected as base_mismatch;
  //   - the merge commit subject is phase-scoped (`chore({P}-{slice}): merge
  //     slice branch`) instead of a fixed generic subject;
  //   - only bulk deletions (more than five files outside .planning/) block
  //     the merge — any deletion is not itself disqualifying.
  // Fixes to either sequence should be considered for the other by hand.
  for (const result of results) {
    const { slice, branch } = result;
    if (result.status !== 'done') {
      data.skipped.push({ slice, reason: 'not_done' });
      continue;
    }
    if (!branch) {
      data.skipped.push({ slice, reason: 'not_isolated' });
      continue;
    }
    if (!runGit(projectDir, ['check-ref-format', '--branch', branch]).ok) {
      block(slice, 'invalid_branch', branch);
      continue;
    }
    if (branch === currentBranch || PROTECTED_BRANCH.test(branch)) {
      block(slice, 'protected_branch', branch);
      continue;
    }

    const worktree = result.worktree_path ? resolve(projectDir, result.worktree_path) : '';
    if (worktree) {
      const head = existsSync(worktree) ? runGit(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']) : null;
      if (!head || !head.ok || head.stdout !== branch) {
        block(slice, 'branch_mismatch', head ? head.stdout || head.stderr : `missing worktree ${worktree}`);
        continue;
      }
      const worktreeStatus = runGit(worktree, ['status', '--porcelain', '--untracked-files=all']);
      if (!worktreeStatus.ok || worktreeStatus.stdout !== '') {
        block(slice, 'worktree_dirty', worktreeStatus.stdout || worktreeStatus.stderr);
        continue;
      }
    }

    // The branch must have started at the wave base. A conflict-resolved branch
    // has merged the current branch in, so its merge base with HEAD is newer,
    // but the wave base is still an ancestor of that merge base.
    const mergeBase = runGit(projectDir, ['merge-base', 'HEAD', branch]);
    if (!mergeBase.ok || !runGit(projectDir, ['merge-base', '--is-ancestor', base, mergeBase.stdout]).ok) {
      block(slice, 'base_mismatch', mergeBase.stdout || mergeBase.stderr);
      continue;
    }

    // core.quotepath=off: non-ASCII paths come back as UTF-8, not as quoted octal escapes.
    const deletions = runGit(projectDir, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=D', `${mergeBase.stdout}..${branch}`]);
    const deleted = deletions.ok ? lines(deletions.stdout).filter((file) => !file.startsWith('.planning/')) : [];
    if (deleted.length > BULK_DELETION_LIMIT) {
      block(slice, 'bulk_deletions', deleted.join('\n'));
      continue;
    }

    const mergeResult = runGit(projectDir, ['merge', '--no-ff', '--no-edit', '-m', `chore(${padded}-${slice}): merge slice branch`, branch]);
    if (!mergeResult.ok) {
      // A failing pre-merge-commit or commit-msg hook also leaves MERGE_HEAD, but
      // with no unmerged paths; that is a failed merge, not a conflict.
      const inProgress = runGit(projectDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok;
      const files = inProgress ? lines(runGit(projectDir, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=U']).stdout) : [];
      if (inProgress) runGit(projectDir, ['merge', '--abort']);
      if (files.length > 0) data.conflicts.push({ slice, files });
      else block(slice, 'merge_failed', mergeResult.stderr || mergeResult.stdout);
      continue;
    }
    data.merged.push(slice);

    if (!worktree) continue;
    let removed = runGit(projectDir, ['worktree', 'remove', '--force', worktree]);
    if (!removed.ok) {
      runGit(projectDir, ['worktree', 'unlock', worktree]);
      removed = runGit(projectDir, ['worktree', 'remove', '--force', worktree]);
    }
    if (!removed.ok) {
      block(slice, 'cleanup_failed', removed.stderr);
      continue;
    }
    data.cleaned.push(worktree);
    const deletedBranch = runGit(projectDir, ['branch', '-D', branch]);
    if (!deletedBranch.ok) block(slice, 'cleanup_failed', deletedBranch.stderr);
  }

  return { data };
};
