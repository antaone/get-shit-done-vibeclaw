import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { resolveRuntimeCapabilities } from '../runtime-capabilities.js';
import { initBuild } from './build-init.js';
import { listPhasePlanFiles, readVerification } from './build-shared.js';

const PHASE_DIR = '.planning/phases/03-user-auth';
const ROADMAP = [
  '# Roadmap',
  '',
  '- [ ] **Phase 3: User Auth**',
  '- [ ] **Phase 4: Profiles**',
  '',
  '### Phase 3: User Auth',
  '',
  '**Goal:** Users can sign in',
  '**Requirements:** AUTH-01, AUTH-02',
  '',
  '### Phase 4: Profiles',
  '',
  '**Goal:** Users can edit their profile',
  '**Requirements:** PROF-01',
  '',
].join('\n');

function brief(nn: string, gap = false): string {
  return [
    '---',
    'phase: 03-user-auth',
    `plan: ${nn}`,
    'type: execute',
    'kind: brief',
    'wave: 1',
    'depends_on: []',
    'files_modified: []',
    'autonomous: true',
    'requirements: [AUTH-01, AUTH-02]',
    `gap_closure: ${gap}`,
    'must_haves:',
    '  truths: []',
    'slices:',
    '  - id: s1',
    '    goal: "Session model"',
    '    owns: ["src/auth/**"]',
    '    after: []',
    '  - id: s2',
    '    goal: "Login routes"',
    '    owns: ["src/routes/**"]',
    '    after: [s1]',
    '---',
    '<objective>',
    'Users can sign in.',
    '</objective>',
    '',
  ].join('\n');
}

function verification(status: string): string {
  return ['---', 'phase: 03-user-auth', 'verified: 2026-09-13T10:00:00Z', `status: ${status}`, 'score: 2/2', '---', '', '# Verification', ''].join('\n');
}

let dir: string;
let savedRuntime: string | undefined;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function put(file: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), content);
}

async function commit(file: string, content: string, message: string): Promise<string> {
  await put(file, content);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

/** Commit only `file` at a pinned time, so other untracked files (an uncommitted brief) stay out of git. */
async function commitAt(seconds: number, file: string, content: string, message: string): Promise<string> {
  await put(file, content);
  const date = `${seconds} +0000`;
  git('add', '--', file);
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return git('rev-parse', 'HEAD');
}

async function init(...args: string[]): Promise<Record<string, any>> {
  return (await initBuild(args, dir)).data as Record<string, any>;
}

beforeEach(async () => {
  savedRuntime = process.env.FVGSD_RUNTIME;
  delete process.env.FVGSD_RUNTIME;
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-init-'));
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  await put('.planning/config.json', JSON.stringify({ model_profile: 'balanced' }));
  await put('.planning/ROADMAP.md', ROADMAP);
  await put('.planning/STATE.md', '# State\n\n**Current Phase:** 3\n');
  await put('.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in\n- [ ] **AUTH-02**: stay signed in\n');
  await commit(`${PHASE_DIR}/03-CONTEXT.md`, '# Context\n', 'docs(03): context');
});

afterEach(async () => {
  if (savedRuntime === undefined) delete process.env.FVGSD_RUNTIME;
  else process.env.FVGSD_RUNTIME = savedRuntime;
  await rm(dir, { recursive: true, force: true });
});

describe('init.build', () => {
  it('returns phase, inputs, commands, runtime, config, models, resume and baseline', async () => {
    await put('.planning/config.json', JSON.stringify({ model_profile: 'balanced', workflow: { build_command: 'make all' } }));
    const head = git('rev-parse', 'HEAD');
    const data = await init('3');
    expect(data.phase_found).toBe(true);
    expect(data.phase).toEqual({ number: '3', padded: '03', name: 'user-auth', dir: PHASE_DIR });
    expect(data.inputs).toEqual({
      context: `${PHASE_DIR}/03-CONTEXT.md`, research: null, spec: null, ui_spec: null, milestone_brief: null,
      roadmap: '.planning/ROADMAP.md', requirements: '.planning/REQUIREMENTS.md', requirement_ids: ['AUTH-01', 'AUTH-02'],
    });
    expect(data.commands).toEqual({ build: 'make all', typecheck: null, lint: null, test: null });
    expect(data.runtime).toEqual({ name: 'claude', ...resolveRuntimeCapabilities('claude') });
    expect(data.config).toEqual({
      research: true, fix_rounds: 2, human_checks: 'defer', code_review: false, parallel: 'auto', engine: 'agents',
      max_concurrent_agents: 3, check_timeout_seconds: 1800, mode: 'interactive', security_enforcement: true, commit_docs: true,
    });
    expect(data.models).toEqual({ brief: 'opus', slice: 'sonnet', strong: 'opus', verifier: 'sonnet' });
    expect(data.resume).toEqual({
      state: 'new', plan: '01', brief: null, summary: null, done_slices: [], partial_slices: [], base_commit: head, verification: null,
    });
    expect(data.baseline).toEqual({ last_passing_commit: null, code_head: null, needs_run: true });
  });

  it('finds research, spec, UI spec and the milestone brief, never taking AI-SPEC.md as the spec', async () => {
    await put(`${PHASE_DIR}/03-RESEARCH.md`, '# Research\n');
    await put(`${PHASE_DIR}/03-AI-SPEC.md`, '# AI spec\n');
    await put(`${PHASE_DIR}/03-SPEC.md`, '# Spec\n');
    await put(`${PHASE_DIR}/03-UI-SPEC.md`, '# UI spec\n');
    await put('.planning/MILESTONE-BRIEF.md', '# Milestone\n');
    const { inputs } = await init('3');
    expect([inputs.research, inputs.spec, inputs.ui_spec, inputs.milestone_brief]).toEqual([
      `${PHASE_DIR}/03-RESEARCH.md`, `${PHASE_DIR}/03-SPEC.md`, `${PHASE_DIR}/03-UI-SPEC.md`, '.planning/MILESTONE-BRIEF.md',
    ]);
  });

  it('derives every resume state from files and git', async () => {
    const base = await commit(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'), 'docs(03): build brief');
    expect((await init('3')).resume).toMatchObject({ state: 'brief_written', plan: '01', brief: `${PHASE_DIR}/03-01-PLAN.md`, base_commit: base });

    await commit('src/auth/session.ts', 'export {};\n', 'feat(03-s1): session model');
    await commit('src/routes/wip.ts', 'export {};\n', 'chore(03-s2): partial — waiting for the session API');
    expect((await init('3')).resume).toMatchObject({ state: 'slices_in_progress', done_slices: ['s1'], partial_slices: ['s2'] });

    await commit('src/routes/login.ts', 'export {};\n', 'feat(03-s2): login routes');
    expect((await init('3')).resume.state).toBe('verifying');

    const verificationPath = join(dir, PHASE_DIR, '03-VERIFICATION.md');
    await writeFile(verificationPath, verification('gaps_found'));
    expect((await init('3')).resume).toMatchObject({
      state: 'gaps_found', verification: { path: `${PHASE_DIR}/03-VERIFICATION.md`, status: 'gaps_found' },
    });

    const past = new Date(Date.now() - 3_600_000);
    await utimes(verificationPath, past, past);
    expect((await init('3')).resume.state).toBe('verifying');

    await writeFile(verificationPath, verification('passed'));
    expect((await init('3')).resume.state).toBe('summarizing');

    await put(`${PHASE_DIR}/03-01-SUMMARY.md`, ['---', 'kind: build-summary', '---', '', '# Summary', ''].join('\n'));
    expect((await init('3')).resume).toMatchObject({ state: 'complete', summary: `${PHASE_DIR}/03-01-SUMMARY.md` });

    await writeFile(verificationPath, verification('human_needed'));
    expect((await init('3')).resume.state).toBe('human_needed');
  });

  it('reports summarizing, not complete, when the summary exists but has no kind: build-summary yet', async () => {
    await commit(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'), 'docs(03): build brief');
    await commit('src/auth/session.ts', 'export {};\n', 'feat(03-s1): session model');
    await commit('src/routes/login.ts', 'export {};\n', 'feat(03-s2): login routes');
    const verificationPath = join(dir, PHASE_DIR, '03-VERIFICATION.md');
    await writeFile(verificationPath, verification('passed'));

    // The lead has written the summary body and its own frontmatter, but build.finalize
    // hasn't run yet, so `kind: build-summary` is still missing.
    await put(`${PHASE_DIR}/03-01-SUMMARY.md`, ['---', 'subsystem: auth', 'tags: [auth]', '---', '', '# Summary', ''].join('\n'));
    expect((await init('3')).resume).toMatchObject({ state: 'summarizing', summary: `${PHASE_DIR}/03-01-SUMMARY.md` });

    await put(`${PHASE_DIR}/03-01-SUMMARY.md`, ['---', 'subsystem: auth', 'tags: [auth]', 'kind: build-summary', '---', '', '# Summary', ''].join('\n'));
    expect((await init('3')).resume.state).toBe('complete');
  });

  it('reports classic when the phase already has plans that are not briefs', async () => {
    await commit(`${PHASE_DIR}/03-01-PLAN.md`, '---\nphase: 03-user-auth\nplan: 01\n---\n# Plan\n', 'docs(03): plan');
    expect((await init('3')).resume).toMatchObject({ state: 'classic', plan: null, brief: null });
  });

  it('targets the next plan for --gaps, then resumes an unfinished gap brief', async () => {
    await commit(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'), 'docs(03): build brief');
    await commit(`${PHASE_DIR}/03-01-SUMMARY.md`, '# Summary\n', 'docs(03): build summary and verification');
    expect((await init('3', '--gaps')).resume).toMatchObject({ state: 'new', plan: '02', brief: null });

    await commit(`${PHASE_DIR}/03-02-PLAN.md`, brief('02', true), 'docs(03): build brief');
    expect((await init('3', '--gaps')).resume).toMatchObject({ state: 'brief_written', plan: '02' });
    expect((await init('3')).resume).toMatchObject({ state: 'brief_written', plan: '02' });
  });

  it('counts slice commits made after a brief that was never committed', async () => {
    const context = git('rev-parse', 'HEAD');
    const start = Number(git('log', '-1', '--format=%ct'));
    await put(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'));
    await utimes(join(dir, PHASE_DIR, '03-01-PLAN.md'), start + 10, start + 10);
    expect((await init('3')).resume).toMatchObject({ state: 'brief_written', plan: '01', base_commit: context });

    await commitAt(start + 20, 'src/auth/session.ts', 'export {};\n', 'feat(03-s1): session model');
    expect((await init('3')).resume).toMatchObject({
      state: 'slices_in_progress', plan: '01', brief: `${PHASE_DIR}/03-01-PLAN.md`, done_slices: ['s1'], base_commit: context,
    });
  });

  it('ignores slice commits dated before an uncommitted gap brief that reuses their slice ids', async () => {
    const start = Number(git('log', '-1', '--format=%ct'));
    await put(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'));
    await put(`${PHASE_DIR}/03-01-SUMMARY.md`, '# Summary\n');
    const earlier = await commitAt(start + 10, 'src/auth/session.ts', 'export {};\n', 'feat(03-s1): session model');
    await put(`${PHASE_DIR}/03-02-PLAN.md`, brief('02', true));
    await utimes(join(dir, PHASE_DIR, '03-02-PLAN.md'), start + 20, start + 20);
    expect((await init('3', '--gaps')).resume).toMatchObject({
      state: 'brief_written', plan: '02', brief: `${PHASE_DIR}/03-02-PLAN.md`, done_slices: [], base_commit: earlier,
    });

    await commitAt(start + 30, 'src/auth/session.ts', 'export const expiry = 1;\n', 'feat(03-s1): session expiry');
    expect((await init('3', '--gaps')).resume).toMatchObject({
      state: 'slices_in_progress', plan: '02', done_slices: ['s1'], base_commit: earlier,
    });
  });

  it('bases an uncommitted brief on a commit made in the same second as the brief', async () => {
    const briefSecond = Number(git('log', '-1', '--format=%ct')) + 200;
    await commitAt(briefSecond - 100, 'src/tooling/lint.ts', 'export {};\n', 'chore: add lint tooling');
    const sameSecond = await commitAt(briefSecond, 'src/tooling/format.ts', 'export {};\n', 'chore: add format tooling');
    await put(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'));
    await utimes(join(dir, PHASE_DIR, '03-01-PLAN.md'), briefSecond, briefSecond);
    await commitAt(briefSecond + 10, 'src/auth/session.ts', 'export {};\n', 'feat(03-s1): session model');
    expect((await init('3')).resume).toMatchObject({ state: 'slices_in_progress', done_slices: ['s1'], base_commit: sameSecond });
  });

  it('bases an uncommitted brief older than every commit on the root commit', async () => {
    const start = Number(git('log', '-1', '--format=%ct'));
    const root = git('rev-list', '--max-parents=0', 'HEAD');
    await commitAt(start + 10, 'src/auth/session.ts', 'export {};\n', 'feat(03-s1): session model');
    await put(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'));
    await utimes(join(dir, PHASE_DIR, '03-01-PLAN.md'), start - 100, start - 100);
    expect((await init('3')).resume).toMatchObject({ state: 'slices_in_progress', done_slices: ['s1'], base_commit: root });
  });

  it('skips the baseline only when the latest passing commit has the code head tree', async () => {
    const summary = (completed: string, passedAt: string) => [
      '---', 'phase: 02-setup', 'plan: 01', 'kind: build-summary', 'subsystem: setup', 'tags: [setup]',
      'build:', `  completed: ${completed}`, `  checks_passed_at: ${passedAt}`, '---', '', '# Summary', '',
    ].join('\n');
    const first = await commit('src/app.ts', 'export const a = 1;\n', 'feat(02-s1): app');
    const head = await commit('src/app.ts', 'export const a = 2;\n', 'fix(02-s1): app value');
    await put('.planning/phases/02-setup/02-01-SUMMARY.md', summary('2026-09-13T10:00:00Z', head));
    await put('.planning/phases/02-setup/02-02-SUMMARY.md', summary('2026-09-12T10:00:00Z', first));
    expect((await init('3')).baseline).toEqual({ last_passing_commit: head, code_head: head, needs_run: false });

    const next = await commit('src/app.ts', 'export const a = 3;\n', 'chore: bump');
    expect((await init('3')).baseline).toEqual({ last_passing_commit: head, code_head: next, needs_run: true });

    const restored = await commit('src/app.ts', 'export const a = 2;\n', 'chore: restore the app value');
    expect((await init('3')).baseline).toEqual({ last_passing_commit: head, code_head: restored, needs_run: false });
  });

  it('resolves the runtime from --runtime, falling back to detection for unsupported values', async () => {
    expect((await init('3', '--runtime', 'codex')).runtime).toEqual({ name: 'codex', ...resolveRuntimeCapabilities('codex') });
    expect((await init('3', '--runtime', 'not-a-runtime')).runtime.name).toBe('claude');
    expect((await init('3', '--runtime', '__FVGSD_RUNTIME__')).runtime.name).toBe('claude');
    process.env.FVGSD_RUNTIME = 'gemini';
    expect((await init('3')).runtime.name).toBe('gemini');
    expect((await init('3', '--runtime', '__FVGSD_RUNTIME__')).runtime.name).toBe('gemini');
  });

  it('normalizes build config values', async () => {
    const configFor = async (config: Record<string, unknown>) => {
      await put('.planning/config.json', JSON.stringify(config));
      return (await init('3')).config;
    };
    expect((await configFor({ parallelization: false })).parallel).toBe('off');
    expect(await configFor({ parallelization: { enabled: true, max_concurrent_agents: 5 } })).toMatchObject({ parallel: 'auto', max_concurrent_agents: 5 });
    expect((await configFor({ workflow: { use_worktrees: false } })).parallel).toBe('off');
    expect((await configFor({ workflow: { build_parallel: 'off' } })).parallel).toBe('off');
    expect((await configFor({ workflow: { build_fix_rounds: 9 } })).fix_rounds).toBe(5);
    expect((await configFor({ workflow: { build_fix_rounds: -1 } })).fix_rounds).toBe(0);
    expect(await configFor({
      mode: 'yolo', commit_docs: false,
      workflow: { research: false, build_human_checks: 'block', build_engine: 'workflow', build_code_review: true, build_check_timeout_seconds: 60, security_enforcement: false },
    })).toMatchObject({
      research: false, human_checks: 'block', engine: 'workflow', code_review: true, check_timeout_seconds: 60,
      mode: 'yolo', security_enforcement: false, commit_docs: false,
    });
  });

  it('reports inherit models when the project has no config.json', async () => {
    await rm(join(dir, '.planning', 'config.json'));
    expect((await init('3')).models).toEqual({ brief: 'inherit', slice: 'inherit', strong: 'inherit', verifier: 'inherit' });
  });

  it('handles a missing phase, a missing argument and a directory outside git', async () => {
    expect(await init('9')).toEqual({ phase_found: false, phase: { number: '9', padded: '09' } });
    const error = await initBuild([], dir).then(() => null, (err: unknown) => err);
    expect(error).toBeInstanceOf(GSDError);
    const outside = await mkdtemp(join(tmpdir(), 'fvgsd-build-init-nogit-'));
    const data = (await initBuild(['3'], outside)).data;
    await rm(outside, { recursive: true, force: true });
    expect(data).toEqual({ error: 'git_repository_required' });
  });
});

describe('build-shared plan readers', () => {
  it('lists slugged plans with kind, gap flag, slice ids and summaries', async () => {
    await put(`${PHASE_DIR}/03-02-auth-hardening-PLAN.md`, brief('02', true));
    await put(`${PHASE_DIR}/03-02-auth-hardening-SUMMARY.md`, '# Summary\n');
    await put(`${PHASE_DIR}/03-01-PLAN.md`, '---\nphase: 03-user-auth\nplan: 01\n---\n');
    const plans = listPhasePlanFiles(join(dir, PHASE_DIR), '03');
    expect(plans.map((plan) => [plan.nn, plan.kind, plan.gapClosure, plan.sliceIds, plan.hasSummary])).toEqual([
      ['01', null, false, [], false],
      ['02', 'brief', true, ['s1', 's2'], true],
    ]);
    expect(readVerification(join(dir, PHASE_DIR), '03')).toBeNull();
  });
});
