import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { extractFrontmatter, stripFrontmatter } from './frontmatter.js';
import { buildFinalize, upsertFrontmatterKeys } from './build-finalize.js';
import { buildStateDir, codeHead, writeJsonAtomic } from './build-shared.js';
import { roadmapAnalyze } from './roadmap.js';

const PHASE_DIR = '.planning/phases/03-user-auth';
const SUMMARY_PATH = `${PHASE_DIR}/03-01-SUMMARY.md`;
const ROADMAP = [
  '# Roadmap', '', '- [ ] **Phase 3: User Auth**', '- [ ] **Phase 4: Profiles**', '',
  '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** AUTH-01, AUTH-02', '',
  '### Phase 4: Profiles', '', '**Goal:** Users can edit their profile', '**Requirements:** PROF-01', '',
].join('\n');
const CONTEXT = ['# Phase 3 Context', '', '<decisions>', '### Sessions', '- **D-01:** Hash passwords with argon2id', '- **D-02:** Sessions last 30 days', '</decisions>', ''].join('\n');
const BRIEF = [
  '---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', 'wave: 1', 'depends_on: []',
  'files_modified: []', 'autonomous: true', 'requirements: [AUTH-01]', 'must_haves:', '  truths: []',
  'slices:', '  - id: s1', '    goal: "Session model"', '    owns: ["src/**"]', '    after: []',
  '---', '<objective>', 'Users can sign in.', '</objective>', '',
].join('\n');
const VERIFICATION = ['---', 'phase: 03-user-auth', 'verified: 2026-09-13T10:00:00Z', 'status: passed', 'score: 1/1', '---', '', '# Verification', ''].join('\n');

function summary(body: string[], frontmatter = ['subsystem: auth', 'tags: [auth, sessions]', 'provides:', '  - "session cookies"']): string {
  return ['---', ...frontmatter, '---', '', '# Phase 3: User Auth — Build Summary', '', ...body, ''].join('\n');
}

const COVERING_BODY = [
  '## Decisions', '', '| Decision | Status | Notes |', '|---|---|---|', '| D-01 | done | argon2id |', '',
  '### D-02: thirty-day sessions', '', '<requirements>AUTH-02 verified by the login tests</requirements>',
];

let dir: string;
let base: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function put(file: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), content);
}

/** Commit new src/app.ts content and return the commit. */
async function commitSource(content: string, message: string): Promise<string> {
  await put('src/app.ts', content);
  git('add', 'src/app.ts');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

function passedAt(commit: string) {
  return { command: 'node -e 0', commit, exit: 0, timed_out: false, skipped: false, passed: true, at: '2026-09-13T10:00:00Z' };
}

function finalize(requirements = 'AUTH-01,AUTH-02', tier = 'sequential') {
  return buildFinalize([
    '--phase', '3', '--plan', '01', '--base', base, '--engine', 'agents', '--tier', tier,
    '--fix-rounds', '1', '--requirements-completed', requirements,
  ], dir);
}

async function expectValidation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(GSDError);
  expect((error as GSDError).classification).toBe('validation');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-finalize-'));
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  await put('.planning/config.json', JSON.stringify({ commit_docs: true }));
  await put('.planning/ROADMAP.md', ROADMAP);
  await put('.planning/STATE.md', '# Project State\n\n**Current Phase:** 3\n**Status:** Executing\n');
  await put('.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in\n- [ ] **AUTH-02**: stay signed in\n');
  await put(`${PHASE_DIR}/03-CONTEXT.md`, CONTEXT);
  await put('src/app.ts', 'export const app = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: initial');
  await put(`${PHASE_DIR}/03-01-PLAN.md`, BRIEF);
  git('add', '-A');
  git('commit', '-q', '-m', 'docs(03): build brief');
  base = git('rev-parse', 'HEAD');
  await put('src/app.ts', 'export const app = 2;\n');
  await put('src/auth/session.ts', 'export const session = true;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat(03-s1): session model');
  await put(`${PHASE_DIR}/03-VERIFICATION.md`, VERIFICATION);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('build.finalize', () => {
  it('fills frontmatter, finds IDs in tables, headings and XML, updates state and commits', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    // Only AUTH-01 is passed, so AUTH-02 must be found in the summary's XML block.
    const data = (await finalize('AUTH-01')).data as Record<string, unknown>;
    expect(data).toMatchObject({ ok: true, phase_complete: true });
    expect(typeof data.commit).toBe('string');

    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm).toMatchObject({
      phase: '03-user-auth', plan: '01', kind: 'build-summary', subsystem: 'auth', tags: ['auth', 'sessions'],
      provides: ['session cookies'], 'key-files': { created: ['src/auth/session.ts'], modified: ['src/app.ts'] },
      'requirements-completed': ['AUTH-01'],
    });
    expect(fm.build).toMatchObject({ engine: 'agents', tier: 'sequential', slices: ['s1'], fix_rounds: '1', checks_passed_at: 'null' });
    expect(Number.parseInt(String(fm.duration), 10)).toBeGreaterThanOrEqual(1);
    expect(git('log', '-1', '--format=%s')).toBe('docs(03): build summary and verification');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('refuses when a decision or requirement ID is missing and leaves state and the summary untouched', async () => {
    await put(SUMMARY_PATH, summary(['| D-01 | done | argon2id |', 'D-020 is a different decision.']));
    const stateBefore = await readFile(join(dir, '.planning/STATE.md'), 'utf-8');
    const summaryBefore = await readFile(join(dir, SUMMARY_PATH), 'utf-8');
    const headBefore = git('rev-parse', 'HEAD');
    const data = (await finalize('AUTH-01')).data;
    expect(data).toEqual({ ok: false, missing: { decisions: ['D-02'], requirements: ['AUTH-02'] } });
    expect(await readFile(join(dir, '.planning/STATE.md'), 'utf-8')).toBe(stateBefore);
    // A refused run must not write finalize's frontmatter — otherwise init.build could see
    // kind: build-summary on disk for a build that never actually finalized.
    expect(await readFile(join(dir, SUMMARY_PATH), 'utf-8')).toBe(summaryBefore);
    expect(git('rev-parse', 'HEAD')).toBe(headBefore);
  });

  it('does not count an ID passed only in --requirements-completed, on the first run or a rerun', async () => {
    // requirements-completed is finalize-owned; write it into the lead's own frontmatter too, as a
    // lead copying the classic summary template might, so this still exercises F10's owned-key
    // exclusion even though a refused run no longer writes anything on its own.
    await put(SUMMARY_PATH, summary(
      ['## Decisions', '', '| Decision | Status | Notes |', '|---|---|---|', '| D-01 | done | argon2id |', '| D-02 | done | 30-day sessions |'],
      ['subsystem: auth', 'tags: [auth, sessions]', 'provides:', '  - "session cookies"', 'requirements-completed: [AUTH-01, AUTH-02]'],
    ));
    const before = await readFile(join(dir, SUMMARY_PATH), 'utf-8');
    const refused = { ok: false, missing: { decisions: [], requirements: ['AUTH-02'] } };
    expect((await finalize('AUTH-01,AUTH-02')).data).toEqual(refused);
    // Refused runs write nothing, and the lead's own requirements-completed value is excluded
    // from the coverage search either way, so the rerun is refused identically and the file
    // stays byte-for-byte unchanged.
    expect((await finalize('AUTH-01,AUTH-02')).data).toEqual(refused);
    expect(await readFile(join(dir, SUMMARY_PATH), 'utf-8')).toBe(before);
    await writeFile(join(dir, SUMMARY_PATH), `${before}\n## Follow-ups\n\n- AUTH-02 is covered by the login tests\n`);
    expect((await finalize('AUTH-01,AUTH-02')).data).toMatchObject({ ok: true });
  });

  it('sets checks_passed_at only when every non-skipped check passed at the code head', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const head = codeHead(dir)!;
    const entry = (overrides: Record<string, unknown>) => ({
      command: 'node -e 0', commit: head, exit: 0, timed_out: false, skipped: false, passed: true, at: '2026-09-13T10:00:00Z', ...overrides,
    });
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), {
      build: entry({}),
      lint: entry({ command: null, commit: null, exit: null, skipped: true, passed: false }),
    });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', lint: 'skipped' }, checks_passed_at: head });
  });

  it('leaves checks_passed_at null when a check failed or timed out', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const head = codeHead(dir)!;
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), {
      build: { command: 'node -e 0', commit: head, exit: 0, timed_out: false, skipped: false, passed: true, at: '2026-09-13T10:00:00Z' },
      test: { command: 'node -e 1', commit: head, exit: null, timed_out: true, skipped: false, passed: false, at: '2026-09-13T10:00:00Z' },
    });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', test: 'timeout' }, checks_passed_at: 'null' });
  });

  it('counts results recorded at an earlier commit with the same code tree after a fix round', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const fullRun = codeHead(dir)!;
    await commitSource('export const app = 3;\n', 'fix(03-s1): try another app value');
    const head = await commitSource('export const app = 2;\n', 'fix(03-s1): restore the app value');
    expect(codeHead(dir)).toBe(head);
    // The fix round reran only build; test keeps its result from the full run.
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), { build: passedAt(head), test: passedAt(fullRun) });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', test: 'pass' }, checks_passed_at: head });
  });

  it('leaves checks_passed_at null when a result was recorded at a commit with a different code tree', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const tried = await commitSource('export const app = 3;\n', 'fix(03-s1): try another app value');
    const head = await commitSource('export const app = 2;\n', 'fix(03-s1): restore the app value');
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), { build: passedAt(head), test: passedAt(tried) });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', test: 'pass' }, checks_passed_at: 'null' });
  });

  it('rejects a summary without subsystem or tags, a missing summary, a missing brief and a bad tier', async () => {
    await expectValidation(finalize());
    await put(SUMMARY_PATH, summary(COVERING_BODY, ['tags: [auth]']));
    await expectValidation(finalize());
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    await expectValidation(finalize('AUTH-01', 'everywhere'));
    await expectValidation(buildFinalize(['--phase', '3', '--plan', '02', '--base', base, '--engine', 'agents', '--tier', 'inline', '--fix-rounds', '0'], dir));
  });

  it('does not commit when commit_docs is false', async () => {
    await put('.planning/config.json', JSON.stringify({ commit_docs: false }));
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    expect((await finalize()).data).toMatchObject({ ok: true, commit: null });
  });

  it('completes the phase only when VERIFICATION.md is passed, but still commits a gaps_found one', async () => {
    await put(`${PHASE_DIR}/03-VERIFICATION.md`, ['---', 'phase: 03-user-auth', 'verified: 2026-09-13T10:00:00Z', 'status: gaps_found', 'score: 0/1', '---', '', '# Verification', ''].join('\n'));
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const data = (await finalize()).data as Record<string, unknown>;
    expect(data).toMatchObject({ ok: true, phase_complete: false });
    expect(typeof data.commit).toBe('string');

    const roadmap = (await roadmapAnalyze([], dir)).data as { phases: Array<{ number: string; roadmap_complete: boolean }> };
    expect(roadmap.phases.find((phase) => phase.number === '3')?.roadmap_complete).not.toBe(true);

    const committedFiles = git('diff-tree', '--no-commit-id', '-r', '--name-only', 'HEAD');
    expect(committedFiles).toContain(`${PHASE_DIR}/03-VERIFICATION.md`);
  });
});

describe('upsertFrontmatterKeys', () => {
  it('writes owned keys first and keeps the other blocks and the body', () => {
    const original = ['---', 'subsystem: auth', 'plan: 99', 'provides:', '  - "session cookies"', '---', '', '# Body', '', 'Text.', ''].join('\n');
    const result = upsertFrontmatterKeys(original, { plan: '01', build: { checks: {}, checks_passed_at: null, slices: ['s1'] } });
    expect(extractFrontmatter(result)).toMatchObject({ plan: '01', subsystem: 'auth', provides: ['session cookies'], build: { checks_passed_at: 'null', slices: ['s1'] } });
    expect(stripFrontmatter(result)).toBe(stripFrontmatter(original));
  });

  it('keeps the lead-written frontmatter when the closing fence has trailing content', () => {
    // A closing "--- " (trailing space) with no other "---" line anywhere later in the
    // content: extractFrontmatter (frontmatter.ts) still treats it as the closing fence.
    const original = ['---', 'subsystem: auth', 'tags: [auth]', '--- ', '', '# Body', '', 'No other dashes here.', ''].join('\n');
    const result = upsertFrontmatterKeys(original, { plan: '01' });
    expect(extractFrontmatter(result)).toMatchObject({ plan: '01', subsystem: 'auth', tags: ['auth'] });
    expect(stripFrontmatter(result)).toContain('No other dashes here.');
  });

  it('does not swallow a body line that looks like an owned key when a markdown rule follows a dirty closing fence', () => {
    // The true closing fence ("--- ", trailing space) comes first; a markdown horizontal
    // rule ("---" on its own line) comes later, after a body line named like an owned key.
    const original = [
      '---', 'subsystem: auth', 'tags: [auth]', '--- ', '# Body', '',
      'plan: see the brief', '', '---', '', 'More body text.', '',
    ].join('\n');
    const result = upsertFrontmatterKeys(original, { plan: '01' });
    expect(extractFrontmatter(result)).toMatchObject({ plan: '01', subsystem: 'auth', tags: ['auth'] });
    const body = stripFrontmatter(result);
    expect(body).toContain('plan: see the brief');
    expect(body).toContain('More body text.');
  });
});
