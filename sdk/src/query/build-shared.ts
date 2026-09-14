/**
 * Shared helpers for the build query handlers.
 *
 * Flag parsing that enforces the CLI negative-input rules, git access without a
 * shell, phase resolution, and the per-phase state directory that keeps check
 * results out of the working tree (<git-common-dir>/fvgsd/build/<phase>).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
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
