import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import {
  firstAddCommit,
  parseFlags,
  phaseRequirementIds,
  resolveBuildPhase,
  sameCodeTree,
  writeJsonAtomic,
} from './build-shared.js';

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

describe('phaseRequirementIds', () => {
  it('reads the IDs listed in the phase ROADMAP section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-reqs-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    await writeFile(join(dir, '.planning', 'ROADMAP.md'), [
      '# Roadmap', '', '## v1.0: Test', '',
      '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** [AUTH-01, AUTH-02] AUTH-03', '',
      '### Phase 4: Billing', '', '**Requirements:** TBD', '',
    ].join('\n'));
    await writeFile(join(dir, '.planning', 'STATE.md'), ['---', 'milestone: v1.0', '---', '', '# State', ''].join('\n'));
    expect(await phaseRequirementIds(dir, '3')).toEqual(['AUTH-01', 'AUTH-02', 'AUTH-03']);
    expect(await phaseRequirementIds(dir, '03')).toEqual(['AUTH-01', 'AUTH-02', 'AUTH-03']);
    expect(await phaseRequirementIds(dir, '4')).toEqual([]);
    expect(await phaseRequirementIds(dir, '9')).toEqual([]);
    expect(await phaseRequirementIds(dir, '')).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when ROADMAP.md is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-reqs-none-'));
    expect(await phaseRequirementIds(dir, '3')).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('firstAddCommit and sameCodeTree', () => {
  const PLAN = '.planning/phases/03-user-auth/03-01-PLAN.md';
  let dir: string;

  function git(args: readonly string[], seconds?: number): string {
    const env = seconds === undefined
      ? process.env
      : { ...process.env, GIT_AUTHOR_DATE: `${seconds} +0000`, GIT_COMMITTER_DATE: `${seconds} +0000` };
    return execFileSync('git', args, { cwd: dir, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }

  /** Write one file, or delete it for null content, and commit at a pinned time. */
  async function commitAt(seconds: number, file: string, content: string | null, message: string): Promise<string> {
    if (content === null) {
      await rm(join(dir, file));
    } else {
      await mkdir(dirname(join(dir, file)), { recursive: true });
      await writeFile(join(dir, file), content);
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', message], seconds);
    return git(['rev-parse', 'HEAD']);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-history-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('firstAddCommit returns the oldest commit that added a matching path, with its committer time', async () => {
    const added = await commitAt(1_700_000_000, PLAN, 'brief\n', 'docs(03): build brief');
    await commitAt(1_700_000_100, PLAN, null, 'docs(03): remove the brief');
    await commitAt(1_700_000_200, PLAN, 'brief again\n', 'docs(03): build brief');
    const gap = await commitAt(1_700_000_300, '.planning/phases/03-user-auth/03-02-PLAN.md', 'gap brief\n', 'docs(03): build brief');

    const first = firstAddCommit(dir, PLAN);
    expect(first?.sha).toBe(added);
    expect(Date.parse(first?.time ?? '')).toBe(1_700_000_000_000);
    expect(firstAddCommit(dir, '.planning/phases/03-user-auth/03-02-PLAN.md')?.sha).toBe(gap);
    expect(firstAddCommit(dir, '.planning/phases/03-user-auth/*-PLAN.md')?.sha).toBe(added);
    expect(firstAddCommit(dir, 'src/never-added.ts')).toBeNull();
  });

  it('firstAddCommit returns null outside a repository', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'fvgsd-build-history-nogit-'));
    await writeFile(join(plain, 'file.md'), '# file\n');
    const result = firstAddCommit(plain, 'file.md');
    await rm(plain, { recursive: true, force: true });
    expect(result).toBeNull();
  });

  it('sameCodeTree compares the code trees outside .planning/', async () => {
    const code = await commitAt(1_700_000_000, 'src/app.ts', 'export const a = 1;\n', 'feat(02-s1): app');
    const docsOnly = await commitAt(1_700_000_100, '.planning/STATE.md', '# State\n', 'docs(02): state');
    const changed = await commitAt(1_700_000_200, 'src/app.ts', 'export const a = 2;\n', 'fix(02-s1): app value');
    const restored = await commitAt(1_700_000_300, 'src/app.ts', 'export const a = 1;\n', 'chore: restore the app value');

    expect(sameCodeTree(dir, code, code)).toBe(true);
    expect(sameCodeTree(dir, code, docsOnly)).toBe(true);
    expect(sameCodeTree(dir, code, changed)).toBe(false);
    expect(sameCodeTree(dir, code, restored)).toBe(true);
  });

  it('sameCodeTree is false unless the commit is 40 or 64 lowercase hex characters', async () => {
    const head = await commitAt(1_700_000_000, 'src/app.ts', 'export const a = 1;\n', 'feat(02-s1): app');
    expect(sameCodeTree(dir, null, head)).toBe(false);
    expect(sameCodeTree(dir, 'HEAD', head)).toBe(false);
    expect(sameCodeTree(dir, head.slice(0, 12), head)).toBe(false);
    expect(sameCodeTree(dir, `${head}0`, `${head}0`)).toBe(false);
    expect(sameCodeTree(dir, head.toUpperCase(), head.toUpperCase())).toBe(false);
    // A well-formed SHA git doesn't know fails the diff.
    expect(sameCodeTree(dir, 'f'.repeat(40), head)).toBe(false);
    // Equal full SHAs match without asking git.
    expect(sameCodeTree(dir, 'a'.repeat(64), 'a'.repeat(64))).toBe(true);
  });
});
