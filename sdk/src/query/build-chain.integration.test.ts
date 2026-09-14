import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizePhaseName } from './helpers.js';
import { buildWaves } from './build-brief.js';
import { buildMergeWave } from './build-merge.js';
import { buildRunChecks } from './build-checks.js';
import { initBuild } from './build-init.js';
import { buildFinalize } from './build-finalize.js';
import { roadmapAnalyze, requirementsMarkComplete } from './roadmap.js';
import { stateJson } from './state.js';
import { routeNextAction } from './route-next-action.js';

const PHASE_DIR = '.planning/phases/03-user-auth';
const BRIEF_PATH = `${PHASE_DIR}/03-01-PLAN.md`;
const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function put(root: string, file: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
}

afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe('build tool chain without a model', () => {
  it('builds, merges, checks, verifies and finalizes a two-slice phase', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-chain-'));
    const worktrees = await mkdtemp(join(tmpdir(), 'fvgsd-build-chain-wt-'));
    tempDirs.push(dir, worktrees);
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');

    await put(dir, '.planning/config.json', JSON.stringify({
      commit_docs: true,
      workflow: { build_command: 'node -e "process.exit(0)"', test_command: 'node -e "process.exit(0)"' },
    }));
    await put(dir, '.planning/ROADMAP.md', [
      '# Roadmap', '', '- [ ] **Phase 3: User Auth**', '- [ ] **Phase 4: Profiles**', '',
      '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** AUTH-01, AUTH-02', '',
      '### Phase 4: Profiles', '', '**Goal:** Users can edit their profile', '**Requirements:** PROF-01', '',
    ].join('\n'));
    await put(dir, '.planning/STATE.md', '# Project State\n\n**Current Phase:** 3\n**Status:** Executing\n');
    await put(dir, '.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in\n- [ ] **AUTH-02**: stay signed in\n');
    await put(dir, `${PHASE_DIR}/03-CONTEXT.md`, ['# Context', '', '<decisions>', '- **D-01:** argon2id hashing', '- **D-02:** 30-day sessions', '</decisions>', ''].join('\n'));
    await put(dir, BRIEF_PATH, [
      '---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', 'wave: 1', 'depends_on: []',
      'files_modified: [src/auth/session.ts, src/routes/login.ts]', 'autonomous: true', 'requirements: [AUTH-01, AUTH-02]',
      'must_haves:', '  truths: []', 'slices:',
      '  - id: s1', '    goal: "Session model"', '    owns: ["src/auth/**"]', '    after: []',
      '  - id: s2', '    goal: "Login route"', '    owns: ["src/routes/**"]', '    after: []',
      '---', '<objective>', 'Users can sign in.', '</objective>', '',
      '## Decisions', '| Decision | Where it lands | Status |', '|---|---|---|',
      '| D-01 | s1: argon2id in src/auth/session.ts | planned |', '| D-02 | s1: session expiry | planned |', '',
    ].join('\n'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'docs(03): build brief');
    const base = git(dir, 'rev-parse', 'HEAD');

    const { waves } = (await buildWaves([BRIEF_PATH], dir)).data as { waves: string[][] };
    expect(waves).toEqual([['s1', 's2']]);

    const results = [];
    for (const [slice, file, goal] of [['s1', 'src/auth/session.ts', 'session model'], ['s2', 'src/routes/login.ts', 'login route']]) {
      const worktree = join(worktrees, slice);
      git(dir, 'worktree', 'add', '-q', '-b', `worktree-agent-${slice}`, worktree, base);
      await put(worktree, file, `export const ${slice} = true;\n`);
      git(worktree, 'add', '-A');
      git(worktree, 'commit', '-q', '-m', `feat(03-${slice}): ${goal}`);
      results.push({ slice, status: 'done', commits: [git(worktree, 'rev-parse', 'HEAD')], branch: `worktree-agent-${slice}`, worktree_path: worktree });
    }

    const merge = (await buildMergeWave(['--phase', '3', '--base', base, '--results', JSON.stringify(results)], dir)).data as { merged: string[]; conflicts: unknown[] };
    expect(merge).toMatchObject({ merged: ['s1', 's2'], conflicts: [] });

    const checks = (await buildRunChecks(['--phase', '3', '--set', 'full'], dir)).data as { passed: boolean };
    expect(checks.passed).toBe(true);

    const before = (await initBuild(['3'], dir)).data as { resume: { state: string; base_commit: string; done_slices: string[] } };
    expect(before.resume).toMatchObject({ state: 'verifying', base_commit: base, done_slices: ['s1', 's2'] });

    await put(dir, `${PHASE_DIR}/03-VERIFICATION.md`, ['---', 'phase: 03-user-auth', 'verified: 2026-09-13T10:00:00Z', 'status: passed', 'score: 2/2', '---', '', '# Verification', ''].join('\n'));
    await put(dir, `${PHASE_DIR}/03-01-SUMMARY.md`, [
      '---', 'subsystem: auth', 'tags: [auth]', '---', '', '# Phase 3: User Auth — Build Summary', '',
      '## Decisions', '| Decision | Status | Notes |', '|---|---|---|', '| D-01 | done | argon2id |', '| D-02 | done | 30-day sessions |', '',
    ].join('\n'));

    const finalized = (await buildFinalize([
      '--phase', '3', '--plan', '01', '--base', before.resume.base_commit, '--engine', 'agents', '--tier', 'parallel',
      '--fix-rounds', '0', '--requirements-completed', 'AUTH-01,AUTH-02',
    ], dir)).data;
    expect(finalized).toMatchObject({ ok: true, phase_complete: true });

    const roadmap = (await roadmapAnalyze([], dir)).data as { phases: Array<{ number: string; roadmap_complete: boolean }> };
    expect(roadmap.phases.find((phase) => phase.number === '3')?.roadmap_complete).toBe(true);
    const requirements = (await requirementsMarkComplete(['AUTH-01,AUTH-02'], dir)).data as { already_complete: string[] };
    expect(requirements.already_complete).toEqual(['AUTH-01', 'AUTH-02']);
    const state = (await stateJson([], dir)).data as { current_phase: unknown };
    expect(normalizePhaseName(String(state.current_phase))).toBe('04');
    expect((await routeNextAction([], dir)).data).toMatchObject({ command: '/fvgsd-discuss-phase', args: '04' });
    expect(((await initBuild(['3'], dir)).data as { resume: { state: string } }).resume.state).toBe('complete');
  }, 120_000);
});
