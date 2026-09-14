import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import {
  buildStateDir, gitCommonDir, headCommit, parseFlags, resolveBuildPhase, runGit, writeJsonAtomic,
} from './build-shared.js';

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

describe('parseFlags', () => {
  const spec = { values: ['phase', 'set'], booleans: ['gaps'] } as const;

  it('parses values, the equals form, booleans and positionals', () => {
    expect(parseFlags(['3', '--set', 'full', '--phase=03', '--gaps'], spec)).toEqual({
      flags: { set: 'full', phase: '03', gaps: true },
      positionals: ['3'],
    });
  });

  it('keeps unicode, long values and shell metacharacters as plain values', () => {
    const value = `ünïcode; rm -rf / && $(whoami) \`id\` "q" ${'x'.repeat(5000)}`;
    expect(parseFlags(['--phase', value], spec).flags.phase).toBe(value);
  });

  it.each([
    [['--phase']],
    [['--phase', '--set', 'full']],
    [['--phase', '']],
    [['--phase', '   ']],
    [['--phase=']],
    [['--phase==1']],
    [['--phase', '1', '--phase', '2']],
    [['--nope', 'x']],
    [['--gaps=true']],
    [['--']],
  ])('rejects %j', (args) => {
    let caught: unknown;
    try {
      parseFlags(args, spec);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GSDError);
    expect((caught as GSDError).classification).toBe('validation');
  });
});

describe('resolveBuildPhase', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-shared-'));
    await mkdir(join(dir, '.planning', 'phases', '03-user-auth'), { recursive: true });
    await mkdir(join(dir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves number, padded, name and directories', async () => {
    expect(await resolveBuildPhase(dir, '3')).toEqual({
      number: '3',
      padded: '03',
      name: 'user-auth',
      dir: '.planning/phases/03-user-auth',
      dirAbs: join(dir, '.planning/phases/03-user-auth'),
    });
  });

  it('keeps decimal phases', async () => {
    const phase = await resolveBuildPhase(dir, '2.1');
    expect([phase?.number, phase?.padded]).toEqual(['2.1', '02.1']);
  });

  it('returns null for missing, empty or hostile phases', async () => {
    for (const arg of ['9', '', '   ', '../../etc', 'a\0b']) {
      expect(await resolveBuildPhase(dir, arg)).toBeNull();
    }
  });
});

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

describe('writeJsonAtomic', () => {
  it('creates parents, replaces content and leaves no temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-json-'));
    const target = join(dir, 'a', 'b', 'data.json');
    writeJsonAtomic(target, { ok: true });
    writeJsonAtomic(target, { ok: false });
    expect(JSON.parse(await readFile(target, 'utf-8'))).toEqual({ ok: false });
    expect(await readdir(join(dir, 'a', 'b'))).toEqual(['data.json']);
    await rm(dir, { recursive: true, force: true });
  });
});
