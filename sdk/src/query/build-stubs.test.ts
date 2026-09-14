import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildScanStubs } from './build-stubs.js';
import { changedFilesSince, codeHead } from './build-shared.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

let dir: string;
let base: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-stubs-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.planning'), { recursive: true });
  await writeFile(join(dir, 'src', 'old.ts'), 'export const old = 1;\n');
  await writeFile(join(dir, 'src', 'gone.ts'), '// FIXME: remove this file\n');
  await writeFile(join(dir, 'src', 'move.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n');
  commitAll(dir, 'base');
  base = git(dir, 'rev-parse', 'HEAD');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('build.scan-stubs', () => {
  it('reports markers only in files changed since the base', async () => {
    await writeFile(join(dir, 'src', 'session.ts'), 'export const a = 1;\n// FIXME: hash passwords\n');
    commitAll(dir, 'session');
    const { data } = await buildScanStubs(['--base', base], dir);
    expect(data).toEqual([{ file: 'src/session.ts', line: 2, marker: 'FIXME' }]);
  });

  it('ignores markdown, .planning, deleted files and markers that cite tracked work', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'notes.md'), 'TBD: write docs\n');
    await writeFile(join(dir, '.planning', 'tool.ts'), '// FIXME in planning\n');
    await writeFile(join(dir, 'src', 'ok.ts'), '// FIXME #123 tracked\n');
    await rm(join(dir, 'src', 'gone.ts'));
    commitAll(dir, 'changes');
    const { data } = await buildScanStubs(['--base', base], dir);
    expect(data).toEqual([]);
  });

  it('rejects a missing or unknown base', async () => {
    await expect(buildScanStubs([], dir)).rejects.toThrow(GSDError);
    await expect(buildScanStubs(['--base', 'not-a-commit'], dir)).rejects.toThrow(GSDError);
  });
});

describe('changedFilesSince and codeHead', () => {
  it('reports added, modified, deleted and renamed paths outside .planning', async () => {
    await writeFile(join(dir, 'src', 'new.ts'), 'export const n = 1;\n');
    await writeFile(join(dir, 'src', 'old.ts'), 'export const old = 2;\n');
    await rm(join(dir, 'src', 'gone.ts'));
    git(dir, 'mv', 'src/move.ts', 'src/moved.ts');
    await writeFile(join(dir, '.planning', 'STATE.md'), '# State\n');
    commitAll(dir, 'mixed changes');
    const changes = changedFilesSince(dir, base).sort((a, b) => a.path.localeCompare(b.path));
    expect(changes).toEqual([
      { status: 'D', path: 'src/gone.ts' },
      { status: 'R', path: 'src/moved.ts' },
      { status: 'A', path: 'src/new.ts' },
      { status: 'M', path: 'src/old.ts' },
    ]);
  });

  it('codeHead ignores commits that only touch .planning', async () => {
    await writeFile(join(dir, 'src', 'code.ts'), 'export const x = 1;\n');
    commitAll(dir, 'code');
    const codeCommit = git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, '.planning', 'STATE.md'), '# State\n');
    commitAll(dir, 'docs only');
    expect(codeHead(dir)).toBe(codeCommit);
  });

  it('codeHead returns the merge commit after a --no-ff merge', async () => {
    const main = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'slice');
    await writeFile(join(dir, 'src', 'slice.ts'), 'export const s = 1;\n');
    commitAll(dir, 'feat(03-s1): slice');
    git(dir, 'checkout', '-q', main);
    git(dir, 'merge', '-q', '--no-ff', '-m', 'chore(03-s1): merge slice branch', 'slice');
    expect(codeHead(dir)).toBe(git(dir, 'rev-parse', 'HEAD'));
  });
});
