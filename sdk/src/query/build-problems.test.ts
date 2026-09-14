import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildGroupProblems } from './build-problems.js';

const BRIEF_PATH = '.planning/phases/03-user-auth/03-01-PLAN.md';
const BRIEF = [
  '---',
  'phase: 03-user-auth',
  'plan: 01',
  'type: execute',
  'kind: brief',
  'wave: 1',
  'depends_on: []',
  'files_modified: []',
  'autonomous: true',
  'requirements: [AUTH-01]',
  'must_haves:',
  '  truths: []',
  'slices:',
  '  - id: s1',
  '    goal: "Session model"',
  '    owns: ["src/auth/**", "src/shared/auth-*.ts"]',
  '    after: []',
  '  - id: s2',
  '    goal: "Login routes"',
  '    owns: ["src/routes/auth/**"]',
  '    after: [s1]',
  '---',
  '<objective>',
  'Users can sign in.',
  '</objective>',
  '',
].join('\n');

type Grouped = { groups: Array<{ slice: string; problems: unknown[]; files: string[] }>; batches: string[][] };

let dir: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

async function group(problems: unknown): Promise<Grouped> {
  const result = await buildGroupProblems(['--brief', BRIEF_PATH, '--problems', JSON.stringify(problems)], dir);
  return result.data as Grouped;
}

async function expectValidation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(GSDError);
  expect((error as GSDError).classification).toBe('validation');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-problems-'));
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  const tracked = [BRIEF_PATH, 'src/auth/session.ts', 'src/routes/auth/login.ts', 'src/shared/auth-util.ts', 'src/shared/auth-token.ts', 'docs/guide.md'];
  for (const file of tracked) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), file === BRIEF_PATH ? BRIEF : '// tracked\n');
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: fixture');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('build.group-problems', () => {
  it('maps problems to the slice whose owns glob matches the first file', async () => {
    const data = await group([
      { kind: 'check', summary: 'tsc: session type error', files: ['src/auth/session.ts'] },
      { kind: 'gap', summary: 'logout route missing', files: ['src/routes/auth/login.ts'] },
    ]);
    expect(data.groups.map((g) => g.slice)).toEqual(['s1', 's2']);
    expect(data.groups[0].files).toEqual(['src/auth/session.ts']);
    expect(data.batches).toEqual([['s1', 's2']]);
  });

  it('assigns an unowned file to the slice owning most files in its directory', async () => {
    const data = await group([{ kind: 'stub', summary: 'FIXME left in index', files: ['src/shared/index.ts'] }]);
    expect(data.groups).toEqual([
      { slice: 's1', problems: [{ kind: 'stub', summary: 'FIXME left in index', files: ['src/shared/index.ts'] }], files: ['src/shared/index.ts'] },
    ]);
  });

  it('uses the fix group when no slice owns the file or its directory', async () => {
    const data = await group([{ kind: 'review', summary: 'guide contradicts API', files: ['docs/guide.md'] }]);
    expect(data.groups.map((g) => g.slice)).toEqual(['fix']);
  });

  it('puts problems without files in a fix group in its own final batch', async () => {
    const data = await group([
      { kind: 'check', summary: 'npm test failed' },
      { kind: 'check', summary: 'lint error', files: ['src/auth/session.ts'] },
    ]);
    expect(data.groups.map((g) => g.slice)).toEqual(['s1', 'fix']);
    expect(data.batches).toEqual([['s1'], ['fix']]);
  });

  it('splits groups that share a file into separate batches', async () => {
    const data = await group([
      { kind: 'gap', summary: 'session not wired to login', files: ['src/auth/session.ts', 'src/routes/auth/login.ts'] },
      { kind: 'check', summary: 'login test fails', files: ['src/routes/auth/login.ts'] },
    ]);
    expect(data.groups.map((g) => [g.slice, g.files])).toEqual([
      ['s1', ['src/auth/session.ts', 'src/routes/auth/login.ts']],
      ['s2', ['src/routes/auth/login.ts']],
    ]);
    expect(data.batches).toEqual([['s1'], ['s2']]);
  });

  it('rejects malformed input', async () => {
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH, '--problems', '{bad'], dir));
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH, '--problems', JSON.stringify([{ kind: 'lint', summary: 'x' }])], dir));
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH, '--problems', JSON.stringify([{ kind: 'gap', summary: '   ' }])], dir));
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH], dir));
    await expectValidation(buildGroupProblems(['--brief', '.planning/phases/03-user-auth/03-09-PLAN.md', '--problems', '[]'], dir));
  });
});
