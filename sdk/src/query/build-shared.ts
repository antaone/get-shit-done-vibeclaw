/**
 * Shared helpers for the build query handlers.
 *
 * Flag parsing that enforces the CLI negative-input rules, git access without a
 * shell, phase resolution, and the per-phase state directory that keeps check
 * results out of the working tree (<git-common-dir>/fvgsd/build/<phase>).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { extractFrontmatter } from './frontmatter.js';
import { escapeRegex } from './helpers.js';
import { findPhase } from './phase.js';
import { roadmapGetPhase } from './roadmap.js';

export interface FlagSpec { values?: readonly string[]; booleans?: readonly string[] }
export interface ParsedFlags { flags: Record<string, string | boolean>; positionals: string[] }

function invalid(message: string): GSDError {
  return new GSDError(message, ErrorClassification.Validation);
}

/** Parse `--name value`, `--name=value` and boolean flags; everything else is positional. */
export function parseFlags(args: readonly string[], spec: FlagSpec): ParsedFlags {
  const values = new Set(spec.values ?? []);
  const booleans = new Set(spec.booleans ?? []);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!values.has(name) && !booleans.has(name)) throw invalid(`unknown flag --${name}`);
    if (Object.prototype.hasOwnProperty.call(flags, name)) throw invalid(`duplicate flag --${name}`);
    if (booleans.has(name)) {
      if (eq !== -1) throw invalid(`--${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = args[i + 1] === undefined ? undefined : String(args[i + 1]);
      i += 1;
    }
    if (value === undefined || value.startsWith('--')) throw invalid(`missing value for --${name}`);
    if (value.trim() === '') throw invalid(`empty value for --${name}`);
    if (value.startsWith('=')) throw invalid(`malformed value for --${name}`);
    flags[name] = value;
  }
  return { flags, positionals };
}

export interface GitResult { ok: boolean; code: number; stdout: string; stderr: string }

/** Run git with an argv array (never a shell). Trailing whitespace is trimmed; leading spaces are kept for porcelain output. */
export function runGit(cwd: string, args: readonly string[]): GitResult {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const code = result.status ?? 1;
  return {
    ok: code === 0 && !result.error,
    code,
    stdout: (result.stdout ?? '').replace(/\s+$/, ''),
    stderr: (result.stderr ?? '').replace(/\s+$/, ''),
  };
}

/**
 * Absolute git common dir, shared by every linked worktree; null outside a repository.
 *
 * Deliberately omits `--path-format=absolute` (git 2.31+ only). Git silently accepts and
 * echoes back options it doesn't recognise instead of failing, so on older git this would
 * exit 0 with stdout like "--path-format=absolute\n.git" — a two-line, mostly-garbage
 * value that callers would otherwise join paths onto. `--git-common-dir` alone works on
 * every git version and returns a path relative to `projectDir`, which `resolve` turns
 * absolute (and leaves untouched on the versions/setups that already return one).
 */
export function gitCommonDir(projectDir: string): string | null {
  const result = runGit(projectDir, ['rev-parse', '--git-common-dir']);
  if (!result.ok || !result.stdout) return null;
  const lines = result.stdout.split('\n');
  if (lines.length !== 1 || lines[0] === '') return null;
  return resolve(projectDir, lines[0]);
}

/** Full SHA of HEAD, or null when there is no repository or no commit. */
export function headCommit(projectDir: string): string | null {
  const result = runGit(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  return result.ok && /^[0-9a-f]{40,64}$/.test(result.stdout) ? result.stdout : null;
}

export interface BuildPhase { number: string; padded: string; name: string; dir: string; dirAbs: string }

/** Resolve a phase argument to its on-disk directory; null when the phase has no directory. */
export async function resolveBuildPhase(projectDir: string, phaseArg: string, workstream?: string): Promise<BuildPhase | null> {
  const trimmed = typeof phaseArg === 'string' ? phaseArg.trim() : '';
  if (!trimmed || trimmed.includes('\0')) return null;
  const found = await findPhase([trimmed], projectDir, workstream);
  const data = found.data as Record<string, unknown>;
  if (!data.found || typeof data.directory !== 'string' || typeof data.phase_number !== 'string') return null;
  const padded = data.phase_number;
  return {
    number: padded.replace(/^0+(?=\d)/, ''),
    padded,
    name: typeof data.phase_name === 'string' ? data.phase_name : '',
    dir: data.directory,
    dirAbs: join(projectDir, data.directory),
  };
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** <git-common-dir>/fvgsd/build/<padded>; null outside a repository. Throws for unsafe segments. */
export function buildStateDir(projectDir: string, padded: string): string | null {
  if (!SAFE_SEGMENT.test(padded)) throw invalid(`invalid phase for the build state directory: ${padded}`);
  const common = gitCommonDir(projectDir);
  return common ? join(common, 'fvgsd', 'build', padded) : null;
}

/** Write JSON through a temp file and rename, creating parent directories. */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmp, filePath);
}

/** Requirement IDs from the phase's `**Requirements:**` ROADMAP line; [] when absent or TBD. */
export async function phaseRequirementIds(projectDir: string, phase: string, workstream?: string): Promise<string[]> {
  if (!phase || !phase.trim()) return [];
  let section: string | undefined;
  try {
    const result = await roadmapGetPhase([phase.trim()], projectDir, workstream);
    const data = result.data as Record<string, unknown>;
    section = typeof data.section === 'string' ? data.section : undefined;
  } catch {
    return [];
  }
  const match = section?.match(/^\*\*Requirements:?\*\*[^\S\n]*:?[^\S\n]*([^\n]*)$/m);
  if (!match) return [];
  const ids = match[1]
    .replace(/[[\]]/g, '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && item.toUpperCase() !== 'TBD');
  return [...new Set(ids)];
}

// ─── Changed files (Task 5) ─────────────────────────────────────────────────

export interface ChangedFile {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  path: string;
}

/**
 * Files changed between `base` and HEAD, relative to the project directory,
 * excluding `.planning/`. Renames and copies report the new path.
 */
export function changedFilesSince(projectDir: string, base: string): ChangedFile[] {
  const result = runGit(projectDir, [
    'diff', '--name-status', '-z', '--find-renames', '--relative', `${base}..HEAD`, '--', '.', ':(exclude).planning',
  ]);
  if (!result.ok || result.stdout === '') return [];
  const parts = result.stdout.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  const changes: ChangedFile[] = [];
  let index = 0;
  while (index < parts.length) {
    const letter = (parts[index] ?? '').charAt(0);
    index += 1;
    if (letter === 'R' || letter === 'C') {
      index += 1; // skip the old path
      const path = parts[index];
      index += 1;
      if (path) changes.push({ status: letter, path });
    } else {
      const path = parts[index];
      index += 1;
      if (path && (letter === 'A' || letter === 'M' || letter === 'D' || letter === 'T')) {
        changes.push({ status: letter, path });
      }
    }
  }
  return changes;
}

/**
 * Latest commit on the first-parent line that changed files outside `.planning/`, or null.
 * `--first-parent` makes a `--no-ff` slice merge count as the change, instead of the
 * slice commit that history simplification would otherwise follow.
 */
export function codeHead(projectDir: string): string | null {
  const result = runGit(projectDir, ['log', '-1', '--first-parent', '--format=%H', '--', '.', ':(exclude).planning']);
  return result.ok && /^[0-9a-f]{40,64}$/.test(result.stdout) ? result.stdout : null;
}

// ─── Commit history (init.build, build.finalize) ────────────────────────────

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The oldest commit reachable from HEAD that added a path matching `pathspec`, with its
 * ISO 8601 committer date. Null when no commit added one, or outside a repository.
 */
export function firstAddCommit(projectDir: string, pathspec: string): { sha: string; time: string } | null {
  const log = runGit(projectDir, ['log', '--diff-filter=A', '--format=%H%x09%cI', '--', pathspec]);
  if (!log.ok || log.stdout === '') return null;
  const lines = log.stdout.split('\n');
  const [sha = '', time = ''] = lines[lines.length - 1].split('\t');
  return FULL_SHA.test(sha) && time !== '' ? { sha, time } : null;
}

/**
 * Decision 15: a check result recorded at `commit` still applies at `head` when both commits
 * have the same tree outside `.planning/`. False unless `commit` is a full lowercase SHA.
 */
export function sameCodeTree(projectDir: string, commit: string | null, head: string): boolean {
  if (typeof commit !== 'string' || !FULL_SHA.test(commit)) return false;
  if (commit === head) return true;
  return runGit(projectDir, ['diff', '--quiet', commit, head, '--', '.', ':(exclude).planning']).ok;
}

// ─── Plan and verification readers (init.build, routing) ────────────────────

export interface PhasePlanFile {
  file: string;
  nn: string;
  num: number;
  kind: string | null;
  gapClosure: boolean;
  sliceIds: string[];
  hasSummary: boolean;
}

/** Plans named `{padded}-{NN}[-slug]-PLAN.md`, sorted by plan number. */
export function listPhasePlanFiles(phaseDirAbs: string, padded: string): PhasePlanFile[] {
  let files: string[];
  try {
    files = readdirSync(phaseDirAbs);
  } catch {
    return [];
  }
  const prefix = escapeRegex(padded);
  const planPattern = new RegExp(`^${prefix}-(\\d{2,})(?:-[^/]*)?-PLAN\\.md$`);
  const plans: PhasePlanFile[] = [];
  for (const file of files) {
    const match = file.match(planPattern);
    if (!match) continue;
    const nn = match[1];
    const summaryPattern = new RegExp(`^${prefix}-${nn}(?:-[^/]*)?-SUMMARY\\.md$`);
    let frontmatter: Record<string, unknown> = {};
    try {
      frontmatter = extractFrontmatter(readFileSync(join(phaseDirAbs, file), 'utf-8'));
    } catch {
      // An unreadable plan is reported without kind, like a classic plan.
    }
    const slices = Array.isArray(frontmatter.slices) ? frontmatter.slices : [];
    plans.push({
      file,
      nn,
      num: Number.parseInt(nn, 10),
      kind: typeof frontmatter.kind === 'string' && frontmatter.kind !== '' ? frontmatter.kind : null,
      gapClosure: frontmatter.gap_closure === true || frontmatter.gap_closure === 'true',
      sliceIds: slices
        .map((slice) => (slice && typeof slice === 'object' ? String((slice as Record<string, unknown>).id ?? '') : ''))
        .filter((id) => id !== ''),
      hasSummary: files.some((candidate) => summaryPattern.test(candidate)),
    });
  }
  return plans.sort((a, b) => a.num - b.num || a.file.localeCompare(b.file));
}

/**
 * A summary only counts as finalized once `build.finalize` has written its `kind: build-summary`
 * marker, which it does only after its ID coverage check passes. A lead-written summary that never
 * went through finalize (STATE, ROADMAP and REQUIREMENTS not updated) leaves its brief unfinished.
 * Reads `{padded}-{nn}-SUMMARY.md`, the name build.finalize writes, also for a slug-named brief.
 */
export function summaryIsFinalized(phaseDirAbs: string, padded: string, nn: string): boolean {
  try {
    return extractFrontmatter(readFileSync(join(phaseDirAbs, `${padded}-${nn}-SUMMARY.md`), 'utf-8')).kind === 'build-summary';
  } catch {
    return false;
  }
}

export interface VerificationInfo {
  /** Absolute path of `{padded}-VERIFICATION.md`. */
  path: string;
  status: string | null;
  mtimeMs: number;
}

export function readVerification(phaseDirAbs: string, padded: string): VerificationInfo | null {
  const path = join(phaseDirAbs, `${padded}-VERIFICATION.md`);
  try {
    const { mtimeMs } = statSync(path);
    const frontmatter = extractFrontmatter(readFileSync(path, 'utf-8'));
    const status = typeof frontmatter.status === 'string' && frontmatter.status.trim() !== '' ? frontmatter.status.trim() : null;
    return { path, status, mtimeMs };
  } catch {
    return null;
  }
}
