/**
 * init.build — one JSON bundle for the /fvgsd-build lead: phase paths and
 * inputs, check commands, runtime capabilities, build config, models, the
 * resume state derived from files and git, and the baseline decision.
 * See docs/superpowers/specs/2026-09-12-fvgsd-build-design.md "Setup".
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { loadConfig } from '../config.js';
import { SUPPORTED_RUNTIMES } from '../model-catalog.js';
import { resolveRuntimeCapabilities, type RuntimeCapabilities } from '../runtime-capabilities.js';
import { resolveModel } from './config-query.js';
import { extractFrontmatter } from './frontmatter.js';
import { detectRuntime, escapeRegex, normalizePhaseName, planningPaths, toPosixPath } from './helpers.js';
import { detectChecks, readBaselineResults } from './build-checks.js';
import {
  codeHead,
  firstAddCommit,
  gitCommonDir,
  headCommit,
  listPhasePlanFiles,
  parseFlags,
  phaseRequirementIds,
  readVerification,
  resolveBuildPhase,
  runGit,
  sameCodeTree,
  summaryIsFinalized,
  type BuildPhase,
  type PhasePlanFile,
} from './build-shared.js';
import type { QueryHandler } from './utils.js';

type ResumeState =
  | 'new' | 'brief_written' | 'slices_in_progress' | 'verifying' | 'gaps_found'
  | 'summarizing' | 'complete' | 'human_needed' | 'classic';

/**
 * The runtime's capabilities in this session. Claude Code in print mode (`claude -p` and the Agent SDK,
 * whose CLAUDE_CODE_ENTRYPOINT starts with `sdk-`) waits for background agents only up to
 * CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS (600 s by default) and then stops them, so background tasks count
 * as off there unless that wait is unlimited (`0`). The variables are Claude Code's; other runtimes keep
 * the table's values.
 */
export function sessionRuntimeCapabilities(runtime: string, env: Readonly<Record<string, string | undefined>>): RuntimeCapabilities {
  const capabilities = resolveRuntimeCapabilities(runtime);
  const printMode = (env.CLAUDE_CODE_ENTRYPOINT ?? '').startsWith('sdk-');
  if (runtime === 'claude' && printMode && env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS !== '0') {
    capabilities.background_tasks = false;
  }
  return capabilities;
}

function relPath(projectDir: string, absPath: string): string {
  return toPosixPath(relative(projectDir, absPath));
}

function findInput(files: readonly string[], name: string, exclude: readonly string[] = []): string | null {
  const matches = (file: string, candidate: string) => file === candidate || file.endsWith(`-${candidate}`);
  return files.find((file) => matches(file, name) && !exclude.some((other) => matches(file, other))) ?? null;
}

async function modelFor(agent: string, projectDir: string, workstream?: string): Promise<string> {
  const { data } = await resolveModel([agent], projectDir, workstream);
  const model = (data as Record<string, unknown>).model;
  return typeof model === 'string' && model !== '' ? model : 'inherit';
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function buildConfig(config: Record<string, unknown>) {
  const workflow = (config.workflow ?? {}) as Record<string, unknown>;
  const parallelization = config.parallelization;
  const parallelObject = typeof parallelization === 'object' && parallelization !== null
    ? parallelization as Record<string, unknown>
    : null;
  const parallelEnabled = parallelObject ? parallelObject.enabled !== false : parallelization !== false;
  const rounds = workflow.build_fix_rounds;
  return {
    research: workflow.research !== false,
    fix_rounds: typeof rounds === 'number' && Number.isInteger(rounds) ? Math.min(5, Math.max(0, rounds)) : 2,
    human_checks: workflow.build_human_checks === 'block' ? 'block' : 'defer',
    code_review: workflow.build_code_review === true,
    parallel: workflow.build_parallel === 'off' || !parallelEnabled || workflow.use_worktrees === false ? 'off' : 'auto',
    engine: workflow.build_engine === 'workflow' ? 'workflow' : 'agents',
    max_concurrent_agents: positiveInt(parallelObject?.max_concurrent_agents) ?? 3,
    check_timeout_seconds: positiveInt(workflow.build_check_timeout_seconds) ?? 1800,
    mode: String(config.mode ?? 'interactive'),
    security_enforcement: workflow.security_enforcement !== false,
    commit_docs: config.commit_docs !== false,
  };
}

interface SliceScan { done: Set<string>; partial: Set<string>; touched: Set<string>; lastWorkSeconds: number | null }

function scanSliceCommits(projectDir: string, base: string, padded: string): SliceScan {
  const scan: SliceScan = { done: new Set(), partial: new Set(), touched: new Set(), lastWorkSeconds: null };
  const log = runGit(projectDir, ['log', '--format=%H%x09%ct%x09%s', `${base}..HEAD`]);
  if (!log.ok) return scan;
  const scope = escapeRegex(padded);
  const feat = new RegExp(`^feat\\(${scope}-(s\\d+)\\):`);
  const fix = new RegExp(`^fix\\(${scope}-(s\\d+|fix)\\):`);
  const partial = new RegExp(`^chore\\(${scope}-(s\\d+)\\): partial`);
  for (const line of log.stdout.split('\n')) {
    const [, seconds, ...subjectParts] = line.split('\t');
    const subject = subjectParts.join('\t');
    const featMatch = subject.match(feat);
    const fixMatch = featMatch ? null : subject.match(fix);
    const partialMatch = featMatch || fixMatch ? null : subject.match(partial);
    const slice = (featMatch ?? fixMatch ?? partialMatch)?.[1];
    if (!slice) continue;
    scan.touched.add(slice);
    if (featMatch) scan.done.add(slice);
    if (partialMatch) scan.partial.add(slice);
    const time = Number(seconds);
    if ((featMatch || fixMatch) && Number.isFinite(time)) scan.lastWorkSeconds = Math.max(scan.lastWorkSeconds ?? 0, time);
  }
  return scan;
}

/**
 * The commit that slice commits for a brief are counted from.
 * - Committed brief: the commit that first added it.
 * - Brief never committed (`commit_docs: false`, or a git-ignored `.planning/`): the newest
 *   commit whose committer time is at or before the brief's mtime, in whole seconds, or the
 *   root commit when every commit is newer. Not the phase's first commit: an earlier build's
 *   `feat({P}-s1)` would then count as done for a gap brief that reuses `s1`.
 */
function resumeBase(projectDir: string, briefRel: string, briefAbs: string, head: string): string {
  const added = firstAddCommit(projectDir, briefRel);
  if (added) return added.sha;
  let briefSeconds: number;
  try {
    briefSeconds = Math.floor(statSync(briefAbs).mtimeMs / 1000);
  } catch {
    return head;
  }
  // Compare %ct directly: git's --before/--until date parsing misreads values such as @1.
  const log = runGit(projectDir, ['log', '--date-order', '--format=%H%x09%ct', 'HEAD']);
  if (!log.ok || log.stdout === '') return head;
  let oldest = head;
  for (const line of log.stdout.split('\n')) {
    const [sha, seconds] = line.split('\t');
    if (!sha) continue;
    if (Number(seconds) <= briefSeconds) return sha;
    oldest = sha;
  }
  // --date-order lists every commit before its parents, so the last one listed is a root commit.
  return oldest;
}

interface ResolvedResume {
  /** The `resume` object init.build returns. */
  resume: Record<string, unknown> & { state: ResumeState };
  /** The resume state describes a gap brief (`gap_closure: true`). */
  gapBrief: boolean;
}

function resolveResume(projectDir: string, phase: BuildPhase, gaps: boolean, head: string): ResolvedResume {
  const plans = listPhasePlanFiles(phase.dirAbs, phase.padded);
  const briefs = plans.filter((plan) => plan.kind === 'brief');
  const latestBrief = briefs.length > 0 ? briefs[briefs.length - 1] : null;
  const info = readVerification(phase.dirAbs, phase.padded);
  const verification = info ? { path: relPath(projectDir, info.path), status: info.status } : null;
  const untouched = { done_slices: [] as string[], partial_slices: [] as string[] };

  let target: PhasePlanFile | null = null;
  let plan: string;
  if (!gaps && latestBrief) {
    target = latestBrief;
    plan = latestBrief.nn;
  } else if (!gaps && plans.length > 0) {
    const resume = { state: 'classic' as const, plan: null, brief: null, summary: null, ...untouched, base_commit: head, verification };
    return { resume, gapBrief: false };
  } else if (!gaps) {
    plan = '01';
  } else if (latestBrief && !summaryIsFinalized(phase.dirAbs, phase.padded, latestBrief.nn)) {
    // --gaps starts a new plan only after the latest brief's summary is finalized. Until then it
    // resumes that brief, gap brief or not: the runner and route.next-action send the user back to it.
    target = latestBrief;
    plan = latestBrief.nn;
  } else {
    plan = String(plans.reduce((max, candidate) => Math.max(max, candidate.num), 0) + 1).padStart(2, '0');
  }

  if (!target) {
    const resume = { state: 'new' as const, plan, brief: null, summary: null, ...untouched, base_commit: head, verification };
    return { resume, gapBrief: false };
  }

  const briefRel = `${phase.dir}/${target.file}`;
  const base = resumeBase(projectDir, briefRel, join(phase.dirAbs, target.file), head);
  const scan = scanSliceCommits(projectDir, base, phase.padded);
  const slices = target.sliceIds;
  const done = slices.filter((id) => scan.done.has(id));
  const partial = slices.filter((id) => !scan.done.has(id) && scan.partial.has(id));
  const status = info?.status ?? null;
  const fresh = info !== null && (scan.lastWorkSeconds === null || info.mtimeMs >= scan.lastWorkSeconds * 1000);

  const finalized = summaryIsFinalized(phase.dirAbs, phase.padded, target.nn);
  let state: ResumeState;
  if (finalized && status === 'passed') state = 'complete';
  else if (finalized && status === 'human_needed') state = 'human_needed';
  else if (scan.touched.size === 0) state = 'brief_written';
  else if (done.length < slices.length) state = 'slices_in_progress';
  else if (!fresh) state = 'verifying';
  else if (status === 'gaps_found') state = 'gaps_found';
  else state = 'summarizing';

  const resume = {
    state,
    plan,
    brief: briefRel,
    summary: target.hasSummary ? `${phase.dir}/${phase.padded}-${target.nn}-SUMMARY.md` : null,
    done_slices: done,
    partial_slices: partial,
    base_commit: base,
    verification,
  };
  return { resume, gapBrief: target.gapClosure };
}

/**
 * Whether the lead must run a baseline. A build never re-baselines at a HEAD that holds its own
 * commits: a gap build (`--gaps`, or a resumed gap brief) and a build resumed past `brief_written`
 * keep the phase's `baseline.json`, or count every failure as new without one. A baseline taken at
 * `code_head`'s code tree still applies. Otherwise (Decision 15) the last passing checks count
 * when their commit has that code tree.
 */
function baselineNeeded(
  projectDir: string,
  padded: string,
  resolved: ResolvedResume,
  gaps: boolean,
  lastPassing: string | null,
  code: string | null,
): boolean {
  const { state } = resolved.resume;
  if (gaps || resolved.gapBrief || (state !== 'new' && state !== 'brief_written')) return false;
  if (code === null) return true;
  const baseline = readBaselineResults(projectDir, padded);
  if (baseline.length > 0 && baseline.every((result) => sameCodeTree(projectDir, result.commit, code))) return false;
  return lastPassing === null || !sameCodeTree(projectDir, lastPassing, code);
}

function lastPassingCommit(projectDir: string, workstream?: string): string | null {
  const phasesDir = planningPaths(projectDir, workstream).phases;
  let dirs: string[];
  try {
    dirs = readdirSync(phasesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return null;
  }
  let best: { completed: number; commit: string | null } | null = null;
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(join(phasesDir, dir)).filter((file) => file.endsWith('-SUMMARY.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      let frontmatter: Record<string, unknown>;
      try {
        frontmatter = extractFrontmatter(readFileSync(join(phasesDir, dir, file), 'utf-8'));
      } catch {
        continue;
      }
      const build = frontmatter.build;
      if (frontmatter.kind !== 'build-summary' || !build || typeof build !== 'object') continue;
      const record = build as Record<string, unknown>;
      const completed = Date.parse(String(record.completed ?? ''));
      if (!Number.isFinite(completed)) continue;
      const raw = record.checks_passed_at;
      // Only a full SHA reaches git: the value comes from a planning file.
      const commit = typeof raw === 'string' && /^[0-9a-f]{40,64}$/.test(raw) ? raw : null;
      if (!best || completed > best.completed) best = { completed, commit };
    }
  }
  return best ? best.commit : null;
}

export const initBuild: QueryHandler = async (args, projectDir, workstream) => {
  const { flags, positionals } = parseFlags(args, { values: ['phase', 'runtime'], booleans: ['gaps'] });
  const phaseArg = typeof flags.phase === 'string' ? flags.phase : positionals[0];
  if (!phaseArg) {
    throw new GSDError('phase required for init build', ErrorClassification.Validation);
  }

  const head = gitCommonDir(projectDir) === null ? null : headCommit(projectDir);
  if (head === null) return { data: { error: 'git_repository_required' } };

  const phase = await resolveBuildPhase(projectDir, phaseArg, workstream);
  if (!phase) {
    const padded = normalizePhaseName(phaseArg);
    return { data: { phase_found: false, phase: { number: padded.replace(/^0+(?=\d)/, ''), padded } } };
  }

  const config = await loadConfig(projectDir, workstream);
  const configRecord = config as unknown as Record<string, unknown>;
  const paths = planningPaths(projectDir, workstream);
  let files: string[] = [];
  try {
    files = readdirSync(phase.dirAbs).sort();
  } catch {
    files = [];
  }
  const phaseFile = (name: string | null) => (name ? `${phase.dir}/${name}` : null);
  const milestoneBrief = ['MILESTONE-CONTEXT.md', 'MILESTONE-BRIEF.md']
    .map((name) => join(paths.planning, name))
    .find((candidate) => existsSync(candidate));

  const detected = detectChecks(projectDir, (configRecord.workflow ?? {}) as Record<string, unknown>);
  // A --runtime value outside the supported runtimes, including the installer token
  // __FVGSD_RUNTIME__ left unreplaced, falls back to detection.
  const runtimeFlag = flags.runtime;
  const runtimeName = typeof runtimeFlag === 'string' && (SUPPORTED_RUNTIMES as readonly string[]).includes(runtimeFlag)
    ? runtimeFlag
    : detectRuntime(configRecord as { runtime?: unknown });
  const planningModel = await modelFor('fvgsd-planner', projectDir, workstream);
  const gaps = flags.gaps === true;
  const resolved = resolveResume(projectDir, phase, gaps, head);
  const lastPassing = lastPassingCommit(projectDir, workstream);
  const code = codeHead(projectDir);

  return {
    data: {
      phase_found: true,
      phase: { number: phase.number, padded: phase.padded, name: phase.name, dir: phase.dir },
      inputs: {
        context: phaseFile(findInput(files, 'CONTEXT.md')),
        research: phaseFile(findInput(files, 'RESEARCH.md')),
        // AI-SPEC.md is the ai-integration-phase design contract, not the phase spec; spec-phase skips it too.
        spec: phaseFile(findInput(files, 'SPEC.md', ['UI-SPEC.md', 'AI-SPEC.md'])),
        ui_spec: phaseFile(findInput(files, 'UI-SPEC.md')),
        milestone_brief: milestoneBrief ? relPath(projectDir, milestoneBrief) : null,
        roadmap: relPath(projectDir, paths.roadmap),
        requirements: existsSync(paths.requirements) ? relPath(projectDir, paths.requirements) : null,
        requirement_ids: await phaseRequirementIds(projectDir, phase.number, workstream),
      },
      commands: { build: detected.build, typecheck: detected.typecheck, lint: detected.lint, test: detected.test },
      runtime: { name: runtimeName, ...sessionRuntimeCapabilities(runtimeName, process.env) },
      config: buildConfig(configRecord),
      models: {
        brief: planningModel,
        slice: await modelFor('fvgsd-builder', projectDir, workstream),
        strong: planningModel,
        verifier: await modelFor('fvgsd-verifier', projectDir, workstream),
      },
      resume: resolved.resume,
      baseline: {
        last_passing_commit: lastPassing,
        code_head: code,
        needs_run: baselineNeeded(projectDir, phase.padded, resolved, gaps, lastPassing, code),
      },
    },
  };
};
