import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { routeNextAction } from './route-next-action.js';

describe('routeNextAction', () => {
  it('suggests new-project when STATE.md is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({
      command: '/fvgsd-new-project',
      reason: expect.stringContaining('STATE.md'),
    });
  });

  it('routes to resume-work when paused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    await writeFile(
      join(dir, '.planning', 'STATE.md'),
      `---
milestone: v1.0
---

**Paused At:** Phase 2

`,
      'utf-8',
    );
    await writeFile(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n', 'utf-8');
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({
      command: '/fvgsd-resume-work',
    });
  });

  it('blocks when .continue-here.md exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    await writeFile(join(dir, '.planning', '.continue-here.md'), 'checkpoint\n', 'utf-8');
    await writeFile(
      join(dir, '.planning', 'STATE.md'),
      `---
milestone: v1.0
---

**Current Phase:** 3

`,
      'utf-8',
    );
    await writeFile(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n', 'utf-8');
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({
      command: '',
      gates: expect.objectContaining({ continue_here: true }),
    });
  });
});

const PHASE = '.planning/phases/03-user-auth';
const BRIEF = ['---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', '---', '<objective>', 'Sign-in flow.', '</objective>', ''].join('\n');
const CLASSIC_PLAN = ['---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', '---', '<objective>', 'Sign-in flow.', '</objective>', ''].join('\n');
/** A summary build.finalize has marked. A summary without `kind: build-summary` was never finalized. */
const BUILD_SUMMARY = ['---', 'phase: 03-user-auth', 'plan: 01', 'kind: build-summary', '---', '', '# Summary', ''].join('\n');

/** `files` entries override the base fixture; a null value leaves that file out. */
async function buildProject(files: Record<string, string | null>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-build-'));
  const base: Record<string, string> = {
    '.planning/STATE.md': ['---', 'milestone: v1.0', '---', '', '**Current Phase:** 3', ''].join('\n'),
    '.planning/ROADMAP.md': ['# Roadmap', '', '## v1.0: Launch', '', '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '', '### Phase 4: Billing', '', '**Goal:** Users can pay', ''].join('\n'),
    [`${PHASE}/03-CONTEXT.md`]: '# Context\n',
  };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    if (content === null) continue;
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf-8');
  }
  return dir;
}

describe('routeNextAction — build mode', () => {
  it('routes a discussed phase with no plans to /fvgsd-build', async () => {
    const { data } = await routeNextAction([], await buildProject({}));
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03' });
  });

  it('keeps /fvgsd-plan-phase when workflow.build_mode is false', async () => {
    const dir = await buildProject({ '.planning/config.json': JSON.stringify({ workflow: { build_mode: false } }) });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-plan-phase', args: '03' });
  });

  it('routes a researched phase without CONTEXT.md to /fvgsd-discuss-phase', async () => {
    const dir = await buildProject({ [`${PHASE}/03-CONTEXT.md`]: null, [`${PHASE}/03-RESEARCH.md`]: '# Research\n' });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-discuss-phase', args: '03' });
  });

  it('resumes /fvgsd-build when an incomplete plan is a brief', async () => {
    const { data } = await routeNextAction([], await buildProject({ [`${PHASE}/03-01-PLAN.md`]: BRIEF }));
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03', reason: 'Build in progress — resume' });
  });

  it('resumes /fvgsd-build for an unfinished brief even when workflow.build_mode is false', async () => {
    const dir = await buildProject({
      '.planning/config.json': JSON.stringify({ workflow: { build_mode: false } }),
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03', reason: 'Build in progress — resume' });
  });

  it('resumes /fvgsd-build when build.finalize never marked the summary, even though verification passed', async () => {
    const dir = await buildProject({
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: '# Summary\n',
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: passed', '---', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03', reason: 'Build in progress — resume' });
  });

  it('resumes /fvgsd-build, not --gaps, when a summary with verification gaps was never finalized', async () => {
    const dir = await buildProject({
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: '# Summary\n',
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: gaps_found', '---', '', '# Verification', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03', reason: 'Build in progress — resume' });
  });

  it('resumes /fvgsd-build for a never-finalized summary even when workflow.build_mode is false', async () => {
    const dir = await buildProject({
      '.planning/config.json': JSON.stringify({ workflow: { build_mode: false } }),
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: '# Summary\n',
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: gaps_found', '---', '', '# Verification', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03', reason: 'Build in progress — resume' });
  });

  it('keeps /fvgsd-execute-phase for an incomplete classic plan', async () => {
    const { data } = await routeNextAction([], await buildProject({ [`${PHASE}/03-01-PLAN.md`]: CLASSIC_PLAN }));
    expect(data).toMatchObject({ command: '/fvgsd-execute-phase', args: '03' });
  });

  it('routes a build phase whose verification found gaps to /fvgsd-build --gaps', async () => {
    const dir = await buildProject({
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: BUILD_SUMMARY,
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: gaps_found', '---', '', '# Verification', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03 --gaps', reason: 'Verification found gaps' });
  });

  it('keeps /fvgsd-verify-work for verification gaps when workflow.build_mode is false', async () => {
    const dir = await buildProject({
      '.planning/config.json': JSON.stringify({ workflow: { build_mode: false } }),
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: BUILD_SUMMARY,
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: gaps_found', '---', '', '# Verification', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-verify-work' });
  });

  it('advances to the next phase once a build phase passed verification', async () => {
    const dir = await buildProject({
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: BUILD_SUMMARY,
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: passed', '---', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-discuss-phase', args: '4' });
  });
});
