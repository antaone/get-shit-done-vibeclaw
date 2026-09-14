import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import {
  buildCheckBrief, buildWaves, computeWaves, fileMatchesGlob, globToRegExp, globsOverlap, ownsOverlap, type BriefSlice,
} from './build-brief.js';

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

const BRIEF = '.planning/phases/03-user-auth/03-01-PLAN.md';
const ROADMAP = [
  '# Roadmap', '', '## v1.0: Test', '',
  '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** AUTH-01, AUTH-02', '',
].join('\n');

const HEAD = [
  'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', 'wave: 1', 'depends_on: []',
  'files_modified: [src/auth/session.ts]', 'autonomous: true', 'requirements: [AUTH-01, AUTH-02]',
  'user_setup: []', 'gap_closure: false',
  'must_haves:', '  truths:', '    - "A user can sign in"', '  artifacts: []', '  key_links: []',
];
const SLICES = [
  'slices:',
  '  - id: s1', '    goal: "Session model"', '    owns: ["src/auth/**"]', '    after: []', '    strong: false',
  '  - id: s2', '    goal: "Login routes"', '    owns: ["src/routes/auth/**"]', '    after: [s1]', '    strong: true',
];
const BODY = ['<objective>', 'Users can sign in.', '</objective>', '', '## Approach', 'Sessions first.'];

function briefText(frontmatter: string[] = [...HEAD, ...SLICES], body: string[] = BODY): string {
  return ['---', ...frontmatter, '---', '', ...body, ''].join('\n');
}

async function project(brief: string, roadmap = ROADMAP): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-brief-'));
  dirs.push(dir);
  await mkdir(join(dir, '.planning', 'phases', '03-user-auth'), { recursive: true });
  await writeFile(join(dir, '.planning', 'ROADMAP.md'), roadmap);
  await writeFile(join(dir, '.planning', 'STATE.md'), ['---', 'milestone: v1.0', '---', '', '# State', ''].join('\n'));
  await writeFile(join(dir, BRIEF), brief);
  return dir;
}

async function check(brief: string, roadmap?: string): Promise<{ valid: boolean; errors: Array<{ field: string; message: string }> }> {
  const dir = await project(brief, roadmap);
  return (await buildCheckBrief([BRIEF], dir)).data as { valid: boolean; errors: Array<{ field: string; message: string }> };
}

function slice(id: string, owns: string[], after: string[] = []): BriefSlice {
  return { id, goal: id, owns, after, strong: false };
}

describe('build.check-brief', () => {
  it('accepts a valid brief', async () => {
    expect(await check(briefText())).toEqual({ valid: true, errors: [] });
  });

  it('reports missing plan schema fields in schema order', async () => {
    const head = HEAD.filter((line) => !line.startsWith('wave:') && !line.startsWith('autonomous:'));
    const result = await check(briefText([...head, ...SLICES]));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.field)).toEqual(['wave', 'autonomous']);
  });

  it('requires kind: brief', async () => {
    const head = HEAD.map((line) => (line === 'kind: brief' ? 'kind: plan' : line));
    expect((await check(briefText([...head, ...SLICES]))).errors.map((e) => e.field)).toEqual(['kind']);
  });

  it('requires requirements only when the ROADMAP phase lists IDs', async () => {
    const head = HEAD.map((line) => (line.startsWith('requirements:') ? 'requirements: []' : line));
    expect((await check(briefText([...head, ...SLICES]))).errors.map((e) => e.field)).toEqual(['requirements']);
    const noIds = ROADMAP.replace('**Requirements:** AUTH-01, AUTH-02', '');
    expect((await check(briefText([...head, ...SLICES]), noIds)).valid).toBe(true);
  });

  it('reports a dependency cycle', async () => {
    const slices = SLICES.map((line) => (line === '    after: []' ? '    after: [s2]' : line));
    expect((await check(briefText([...HEAD, ...slices]))).errors).toEqual([
      { field: 'slices', message: 'dependency cycle: s1 -> s2 -> s1' },
    ]);
  });

  it('reports bad and duplicate ids, empty owns and unknown after ids', async () => {
    const slices = [
      'slices:',
      '  - id: s1', '    goal: "A"', '    owns: ["a/**"]', '    after: []',
      '  - id: s1', '    goal: "B"', '    owns: ["b/**"]', '    after: [s9]',
      '  - id: slice3', '    goal: "C"', '    owns: []', '    after: []',
    ];
    expect((await check(briefText([...HEAD, ...slices]))).errors.map((e) => e.field)).toEqual([
      'slices[1].id', 'slices[2].id', 'slices[2].owns', 'slices[1].after[0]',
    ]);
  });

  it('requires at least one slice and an objective block', async () => {
    expect((await check(briefText(HEAD))).errors.map((e) => e.field)).toEqual(['slices']);
    expect((await check(briefText(undefined, ['## Approach', 'No objective.']))).errors.map((e) => e.field)).toEqual(['objective']);
  });

  it('rejects missing arguments, missing files and paths outside the project', async () => {
    const dir = await project(briefText());
    await expect(buildCheckBrief([], dir)).rejects.toThrow(GSDError);
    await expect(buildCheckBrief(['../outside.md'], dir)).rejects.toThrow(GSDError);
    await expect(buildCheckBrief(['/etc/hosts'], dir)).rejects.toThrow(GSDError);
    await expect(buildCheckBrief(['.planning/phases/03-user-auth/missing.md'], dir)).rejects.toThrow(GSDError);
  });
});

describe('build.waves', () => {
  it('returns waves for a valid brief', async () => {
    const dir = await project(briefText());
    expect((await buildWaves([BRIEF], dir)).data).toEqual({ waves: [['s1'], ['s2']] });
  });

  it('refuses briefs whose slices are invalid', async () => {
    const slices = SLICES.map((line) => (line === '    after: []' ? '    after: [s2]' : line));
    const dir = await project(briefText([...HEAD, ...slices]));
    const data = (await buildWaves([BRIEF], dir)).data as { error: string; errors: Array<{ field: string }> };
    expect(data.error).toBe('invalid_brief');
    expect(data.errors.map((e) => e.field)).toEqual(['slices']);
  });
});

describe('computeWaves', () => {
  it('orders slices by dependencies', () => {
    expect(computeWaves([slice('s2', ['src/b/**'], ['s1']), slice('s1', ['src/a/**']), slice('s3', ['src/c/**'], ['s1'])]))
      .toEqual([['s1'], ['s2', 's3']]);
  });

  it('runs disjoint slices together, in numeric id order', () => {
    expect(computeWaves([slice('s10', ['x/**']), slice('s2', ['y/**'])])).toEqual([['s2', 's10']]);
  });

  it('splits overlapping owns across waves and moves dependents later', () => {
    expect(computeWaves([slice('s1', ['src/auth/**']), slice('s2', ['src/auth/session.ts']), slice('s3', ['docs/**'], ['s2'])]))
      .toEqual([['s1'], ['s2'], ['s3']]);
  });
});

describe('globs', () => {
  it.each([
    ['src/auth/**', 'src/auth/session.ts', true],
    ['src/auth/**', 'src/auth/deep/a.ts', true],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/a/b/c.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['migrations/*auth*.sql', 'migrations/001_auth_users.sql', true],
    ['app/{login,logout}/**', 'app/logout/page.tsx', true],
    ['app/{login,logout}/**', 'app/signup/page.tsx', false],
    ['file?.ts', 'file1.ts', true],
    ['[!a]x.ts', 'bx.ts', true],
    ['[!a]x.ts', 'ax.ts', false],
    ['./src/a.ts', 'src/a.ts', true],
    ['src\\win\\a.ts', 'src/win/a.ts', true],
    ['a.b', 'axb', false],
  ])('glob %s matches %s: %s', (glob, file, expected) => {
    expect(fileMatchesGlob(file, glob)).toBe(expected);
  });

  it.each([
    ['src/auth/**', 'src/auth/session.ts', true],
    ['src/auth/**', 'src/routes/**', false],
    ['src/**', 'src/auth/*.ts', true],
    ['src/a.ts', './src/a.ts', true],
    ['src/a.ts', 'src/b.ts', false],
    ['src/*/x.ts', 'src/a/**', true],
    ['lib/**', 'src/**', false],
  ])('globsOverlap(%s, %s) = %s in both directions', (a, b, expected) => {
    expect(globsOverlap(a, b)).toBe(expected);
    expect(globsOverlap(b, a)).toBe(expected);
  });

  it('checks every pair in ownsOverlap and treats unbalanced braces literally', () => {
    expect(ownsOverlap(['docs/**', 'src/a/**'], ['src/a/x.ts'])).toBe(true);
    expect(ownsOverlap(['docs/**'], ['src/**'])).toBe(false);
    expect(globToRegExp('a{b').test('a{b')).toBe(true);
  });
});
