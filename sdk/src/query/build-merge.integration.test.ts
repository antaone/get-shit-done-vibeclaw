import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildMergeWave, type MergeWaveData } from './build-merge.js';

interface SliceInput { slice: string; status: string; branch: string; worktree_path: string; commits: string[] }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function initRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, 'shared.txt'), 'line one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return git(dir, 'rev-parse', 'HEAD');
}

async function addSlice(repo: string, root: string, slice: string, file: string, content: string): Promise<SliceInput> {
  const branch = `worktree-agent-${slice}`;
  const worktree = join(root, `wt-${slice}`);
  git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
  await writeFile(join(worktree, file), content);
  git(worktree, 'add', '--', file);
  git(worktree, 'commit', '-q', '-m', `feat(03-${slice}): ${file}`);
  return { slice, status: 'done', branch, worktree_path: worktree, commits: [git(worktree, 'rev-parse', 'HEAD')] };
}

async function merge(cwd: string, base: string, results: unknown): Promise<MergeWaveData> {
  const { data } = await buildMergeWave(['--phase', '3', '--base', base, '--results', JSON.stringify(results)], cwd);
  return data as MergeWaveData;
}

let root: string;
let repo: string;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fvgsd-merge-wave-'));
  repo = join(root, 'repo');
  base = await initRepo(repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('build.merge-wave', () => {
  it('merges disjoint slices in slice order and removes their worktrees and branches', async () => {
    const s1 = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    const s2 = await addSlice(repo, root, 's2', 'b.txt', 'b\n');
    const data = await merge(repo, base, [s2, s1]);
    expect(data).toEqual({ merged: ['s1', 's2'], conflicts: [], blocked: [], skipped: [], cleaned: [s1.worktree_path, s2.worktree_path] });
    expect(existsSync(s1.worktree_path)).toBe(false);
    expect(existsSync(s2.worktree_path)).toBe(false);
    expect(git(repo, 'branch', '--list', 'worktree-agent-*')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('chore(03-s2): merge slice branch');
  });

  it('aborts a conflicting merge, keeps the tree clean and leaves that worktree in place', async () => {
    const s1 = await addSlice(repo, root, 's1', 'shared.txt', 'from s1\n');
    const s2 = await addSlice(repo, root, 's2', 'shared.txt', 'from s2\n');
    const data = await merge(repo, base, [s1, s2]);
    expect(data.merged).toEqual(['s1']);
    expect(data.conflicts).toEqual([{ slice: 's2', files: ['shared.txt'] }]);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(existsSync(s2.worktree_path)).toBe(true);
  });

  it('reports non-ASCII conflict paths unquoted', async () => {
    await writeFile(join(repo, 'café.txt'), 'base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'accented file');
    const accentedBase = git(repo, 'rev-parse', 'HEAD');
    const s1 = await addSlice(repo, root, 's1', 'café.txt', 'from s1\n');
    const s2 = await addSlice(repo, root, 's2', 'café.txt', 'from s2\n');
    const data = await merge(repo, accentedBase, [s1, s2]);
    expect(data.merged).toEqual(['s1']);
    expect(data.conflicts).toEqual([{ slice: 's2', files: ['café.txt'] }]);
  });

  it('merges a conflicting slice on the retry after its branch merges the current branch in', async () => {
    const s1 = await addSlice(repo, root, 's1', 'shared.txt', 'from s1\n');
    const s2 = await addSlice(repo, root, 's2', 'shared.txt', 'from s2\n');
    expect((await merge(repo, base, [s1, s2])).conflicts.map((entry) => entry.slice)).toEqual(['s2']);
    expect(() => git(s2.worktree_path, 'merge', '-q', '--no-edit', 'main')).toThrow();
    await writeFile(join(s2.worktree_path, 'shared.txt'), 'from s1 and s2\n');
    git(s2.worktree_path, 'add', '--', 'shared.txt');
    git(s2.worktree_path, 'commit', '-q', '-m', 'fix(03-s2): resolve merge with s1');
    const data = await merge(repo, base, [s2]);
    expect(data).toEqual({ merged: ['s2'], conflicts: [], blocked: [], skipped: [], cleaned: [s2.worktree_path] });
    expect(git(repo, 'show', 'HEAD:shared.txt')).toBe('from s1 and s2');
  });

  it('works when the project is itself a linked worktree of another repository', async () => {
    const candidate = join(root, 'candidate');
    git(repo, 'worktree', 'add', '-q', '-b', 'candidate-branch', candidate, 'HEAD');
    const candidateBase = git(candidate, 'rev-parse', 'HEAD');
    const s1 = await addSlice(candidate, root, 's1', 'c.txt', 'c\n');
    const data = await merge(candidate, candidateBase, [s1]);
    expect(data.merged).toEqual(['s1']);
    expect(data.cleaned).toEqual([s1.worktree_path]);
    expect(git(candidate, 'log', '-1', '--format=%s')).toBe('chore(03-s1): merge slice branch');
    expect(git(candidate, 'status', '--porcelain')).toBe('');
  });

  it('blocks a dirty slice worktree and a slice that did not start from the base', async () => {
    const dirty = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    await writeFile(join(dirty.worktree_path, 'scratch.txt'), 'uncommitted\n');
    const dirtyData = await merge(repo, base, [dirty]);
    expect(dirtyData.blocked.map((entry) => [entry.slice, entry.reason])).toEqual([['s1', 'worktree_dirty']]);
    expect(dirtyData.merged).toEqual([]);

    const s2 = await addSlice(repo, root, 's2', 'b.txt', 'b\n');
    await writeFile(join(repo, 'later.txt'), 'later\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'later');
    const later = git(repo, 'rev-parse', 'HEAD');
    const baseData = await merge(repo, later, [s2]);
    expect(baseData.blocked.map((entry) => [entry.slice, entry.reason])).toEqual([['s2', 'base_mismatch']]);
  });

  it('blocks a slice that deletes more than five files outside .planning', async () => {
    for (let i = 1; i <= 6; i += 1) await writeFile(join(repo, `f${i}.txt`), `${i}\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'six files');
    const wideBase = git(repo, 'rev-parse', 'HEAD');
    const branch = 'worktree-agent-s1';
    const worktree = join(root, 'wt-s1');
    git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
    git(worktree, 'rm', '-q', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt', 'f6.txt');
    git(worktree, 'commit', '-q', '-m', 'feat(03-s1): remove files');
    const data = await merge(repo, wideBase, [{ slice: 's1', status: 'done', branch, worktree_path: worktree }]);
    expect(data.blocked.map((entry) => entry.reason)).toEqual(['bulk_deletions']);
    expect(data.merged).toEqual([]);
  });

  it('skips unfinished or non-isolated slices and blocks protected or malformed branches without running them', async () => {
    const data = await merge(repo, base, [
      { slice: 's1', status: 'partial', branch: 'worktree-agent-s1', worktree_path: '' },
      { slice: 's2', status: 'done', branch: '', worktree_path: '' },
      { slice: 's3', status: 'done', branch: 'main', worktree_path: '' },
      { slice: 's4', status: 'done', branch: 'worktree-agent-x;touch pwned', worktree_path: '' },
    ]);
    expect(data.skipped).toEqual([{ slice: 's1', reason: 'not_done' }, { slice: 's2', reason: 'not_isolated' }]);
    expect(data.blocked.map((entry) => [entry.slice, entry.reason])).toEqual([['s3', 'protected_branch'], ['s4', 'invalid_branch']]);
    expect(existsSync(join(repo, 'pwned'))).toBe(false);
    expect(existsSync(join(root, 'pwned'))).toBe(false);
  });

  it('reads results from --results-file', async () => {
    const s1 = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    const resultsFile = join(root, 'results.json');
    await writeFile(resultsFile, JSON.stringify([s1]));
    const { data } = await buildMergeWave(['--phase', '3', '--base', base, '--results-file', resultsFile], repo);
    expect((data as MergeWaveData).merged).toEqual(['s1']);
  });

  it('refuses to merge into a main tree with uncommitted tracked changes', async () => {
    const s1 = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    await writeFile(join(repo, 'shared.txt'), 'edited\n');
    const { data } = await buildMergeWave(['--phase', '3', '--base', base, '--results', JSON.stringify([s1])], repo);
    expect(data).toEqual({ error: 'working_tree_dirty' });
  });

  it('rejects missing, conflicting and malformed inputs', async () => {
    await expect(buildMergeWave(['--phase', '3', '--results', '[]'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base, '--results', '[]', '--results-file', 'r.json'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base, '--results', '{"slice":"s1"}'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base, '--results', 'not json'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', 'not-a-commit', '--results', '[]'], repo)).rejects.toThrow(GSDError);
  });
});
