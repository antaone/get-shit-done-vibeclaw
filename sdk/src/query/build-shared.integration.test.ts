import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildStateDir, gitCommonDir, headCommit, runGit } from './build-shared.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function makeRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, 'README.md'), '# test\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

describe('git helpers', () => {
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    repo = await makeRepo('fvgsd-build-git-');
    worktree = `${repo}-wt`;
    git(repo, 'worktree', 'add', '-q', worktree);
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('resolves the shared common dir and state dir from a linked worktree', () => {
    const common = gitCommonDir(worktree);
    expect(common).not.toBeNull();
    expect(realpathSync(common!)).toBe(realpathSync(join(repo, '.git')));
    expect(buildStateDir(worktree, '03')).toBe(join(common!, 'fvgsd', 'build', '03'));
  });

  it('reports HEAD and handles directories outside git', async () => {
    expect(headCommit(repo)).toBe(git(repo, 'rev-parse', 'HEAD'));
    const plain = await mkdtemp(join(tmpdir(), 'fvgsd-build-nogit-'));
    expect(gitCommonDir(plain)).toBeNull();
    expect(headCommit(plain)).toBeNull();
    expect(buildStateDir(plain, '03')).toBeNull();
    expect(runGit(plain, ['status']).ok).toBe(false);
    await rm(plain, { recursive: true, force: true });
  });

  it('rejects unsafe phase segments for the state dir', () => {
    for (const bad of ['..', '../x', 'a/b', '', '.hidden']) {
      expect(() => buildStateDir(repo, bad)).toThrow(GSDError);
    }
  });
});
