/**
 * Build checks — `checks.detect` and `build.run-checks`.
 *
 * Resolves build/typecheck/lint/test commands (configured values first, then the
 * detection rules execute-phase's post-merge gate used in shell) and runs a set of
 * them with a timeout. Results are stored under <git-common-dir>/fvgsd/build/<P>/:
 * `<label>.json` for each run and `latest.json` with each command's latest result.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { loadConfig } from '../config.js';
import { normalizePhaseName, toPosixPath } from './helpers.js';
import { buildStateDir, headCommit, parseFlags, resolveBuildPhase, writeJsonAtomic } from './build-shared.js';
import type { QueryHandler } from './utils.js';

export type CheckName = 'build' | 'typecheck' | 'lint' | 'test';
export const CHECK_NAMES: readonly CheckName[] = ['build', 'typecheck', 'lint', 'test'];
export type CheckSet = 'quick' | 'wave' | 'full';
export const CHECK_SETS: Readonly<Record<CheckSet, readonly CheckName[]>> = Object.freeze({
  quick: ['typecheck', 'lint'],
  wave: ['build', 'typecheck'],
  full: ['build', 'typecheck', 'lint', 'test'],
});
export type CheckSource = 'config' | 'detected' | 'none';
export interface DetectedChecks {
  build: string | null;
  typecheck: string | null;
  lint: string | null;
  test: string | null;
  sources: Record<CheckName, CheckSource>;
}
export interface DetectDeps { listXcodeSchemes?: (projectPath: string) => string[] }
export interface CheckResult {
  name: CheckName;
  command: string | null;
  commit: string | null;
  exit: number | null;
  timed_out: boolean;
  skipped: boolean;
  duration_ms: number;
  preexisting: boolean;
  output_tail: string;
}
export interface RunChecksData { set: CheckSet; label: string; passed: boolean; results: CheckResult[] }
export interface LatestCheckEntry {
  command: string | null;
  commit: string | null;
  exit: number | null;
  timed_out: boolean;
  skipped: boolean;
  passed: boolean;
  at: string;
}

const XCODE_DESTINATION = "-destination 'platform=iOS Simulator,name=iPhone 16'";
const PYTHON_SKIP = new Set(['.planning', 'node_modules', '.git', '.venv', 'venv', '__pycache__']);
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TAIL_BYTES = 256 * 1024;
const TAIL_LINES = 200;
const DEFAULT_TIMEOUT_SECONDS = 1800;
/** setTimeout's largest delay; a longer one fires at once. Timeouts beyond it (about 24.8 days) mean "no early timeout". */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function invalid(message: string): GSDError {
  return new GSDError(message, ErrorClassification.Validation);
}

function readText(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    // cmd.exe has no equivalent to POSIX single-quoting; wrap in double quotes and
    // escape embedded ones so the value survives CommandLineToArgvW-style parsing.
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasRecipe(text: string | null, name: string): boolean {
  return text !== null && new RegExp(`^${name}:`, 'm').test(text);
}

function justfileText(projectDir: string): string | null {
  for (const name of ['Justfile', 'justfile']) {
    const text = readText(join(projectDir, name));
    if (text !== null) return text;
  }
  return null;
}

function packageInfo(projectDir: string): { exists: boolean; scripts: Record<string, unknown> } {
  const text = readText(join(projectDir, 'package.json'));
  if (text === null) return { exists: false, scripts: {} };
  try {
    const parsed = JSON.parse(text) as { scripts?: unknown };
    const scripts = parsed && typeof parsed.scripts === 'object' && parsed.scripts !== null ? parsed.scripts as Record<string, unknown> : {};
    return { exists: true, scripts };
  } catch {
    return { exists: true, scripts: {} };
  }
}

function hasScript(scripts: Record<string, unknown>, name: string): boolean {
  return typeof scripts[name] === 'string' && (scripts[name] as string).trim() !== '';
}

function findXcodeProject(projectDir: string): string | null {
  const found: string[] = [];
  const scan = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.name.endsWith('.xcodeproj')) found.push(full);
      else if (depth < 2 && !entry.name.startsWith('.')) scan(full, depth + 1);
    }
  };
  scan(projectDir, 1);
  return found.sort()[0] ?? null;
}

function defaultListXcodeSchemes(projectPath: string): string[] {
  const result = spawnSync('xcodebuild', ['-list', '-json', '-project', projectPath], { encoding: 'utf-8', timeout: 30_000 });
  if (result.status !== 0 || !result.stdout) return [];
  try {
    const schemes = (JSON.parse(result.stdout) as { project?: { schemes?: unknown } }).project?.schemes;
    return Array.isArray(schemes) ? schemes.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function pythonFiles(projectDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (found.length >= 5000) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (PYTHON_SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.py')) found.push(toPosixPath(relative(projectDir, full)));
    }
  };
  walk(projectDir);
  return found.sort().slice(0, 20);
}

/** Resolve the four check commands: non-empty configured values win, then detection. */
export function detectChecks(projectDir: string, workflowConfig: Record<string, unknown>, deps: DetectDeps = {}): DetectedChecks {
  const configured = (key: string): string | null => {
    const value = workflowConfig[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  const exists = (name: string): boolean => existsSync(join(projectDir, name));
  const makefile = readText(join(projectDir, 'Makefile'));
  const justfile = justfileText(projectDir);
  const pkg = packageInfo(projectDir);
  const pyproject = readText(join(projectDir, 'pyproject.toml'));
  const isPython = pyproject !== null || exists('requirements.txt');
  const xcodeProject = findXcodeProject(projectDir);
  let scheme: string | null | undefined;
  const xcode = (action: 'build' | 'test'): string | null => {
    if (!xcodeProject) return null;
    if (scheme === undefined) scheme = (deps.listXcodeSchemes ?? defaultListXcodeSchemes)(xcodeProject)[0] ?? null;
    return scheme
      ? `xcodebuild ${action} -scheme ${shellQuote(scheme)} ${XCODE_DESTINATION}`
      : `xcodebuild ${action} ${XCODE_DESTINATION}`;
  };

  const detectBuild = (): string | null => {
    const fromXcode = xcode('build');
    if (fromXcode) return fromXcode;
    if (hasRecipe(makefile, 'build')) return 'make build';
    if (justfile !== null) return 'just build';
    if (exists('Cargo.toml')) return 'cargo build';
    if (exists('go.mod')) return 'go build ./...';
    if (isPython) {
      const files = pythonFiles(projectDir);
      return files.length > 0 ? `python -m py_compile ${files.map(shellQuote).join(' ')}` : null;
    }
    return hasScript(pkg.scripts, 'build') ? 'npm run build' : null;
  };
  const detectTest = (): string | null => {
    const fromXcode = xcode('test');
    if (fromXcode) return fromXcode;
    if (hasRecipe(makefile, 'test')) return 'make test';
    if (justfile !== null) return 'just test';
    if (pkg.exists) return 'npm test';
    if (exists('Cargo.toml')) return 'cargo test';
    if (exists('go.mod')) return 'go test ./...';
    return isPython ? 'python -m pytest -x -q --tb=short || uv run python -m pytest -x -q --tb=short' : null;
  };
  const detectTypecheck = (): string | null => {
    if (hasScript(pkg.scripts, 'typecheck')) return 'npm run typecheck';
    if (hasScript(pkg.scripts, 'type-check')) return 'npm run type-check';
    if (hasRecipe(makefile, 'typecheck')) return 'make typecheck';
    if (hasRecipe(justfile, 'typecheck')) return 'just typecheck';
    if (exists('tsconfig.json')) return 'npx tsc --noEmit';
    if ((pyproject !== null && /^\[tool\.mypy\b/m.test(pyproject)) || exists('mypy.ini')) return 'mypy .';
    return null;
  };
  const detectLint = (): string | null => {
    if (hasScript(pkg.scripts, 'lint')) return 'npm run lint';
    if (hasRecipe(makefile, 'lint')) return 'make lint';
    if (hasRecipe(justfile, 'lint')) return 'just lint';
    if (exists('Cargo.toml')) return 'cargo clippy';
    if (exists('go.mod')) return 'go vet ./...';
    if ((pyproject !== null && /^\[tool\.ruff\b/m.test(pyproject)) || exists('ruff.toml') || exists('.ruff.toml')) return 'ruff check .';
    return null;
  };

  const detectors: Record<CheckName, () => string | null> = { build: detectBuild, typecheck: detectTypecheck, lint: detectLint, test: detectTest };
  const result = { sources: {} } as DetectedChecks;
  for (const name of CHECK_NAMES) {
    const fromConfig = configured(`${name}_command`);
    const command = fromConfig ?? detectors[name]();
    result[name] = command;
    result.sources[name] = fromConfig ? 'config' : command ? 'detected' : 'none';
  }
  return result;
}

export const checksDetect: QueryHandler = async (args, projectDir, workstream) => {
  const { positionals } = parseFlags(args, {});
  if (positionals.length > 0) throw invalid('checks.detect takes no arguments');
  const config = await loadConfig(projectDir, workstream);
  return { data: detectChecks(projectDir, config.workflow as unknown as Record<string, unknown>) };
};

function tailOf(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-TAIL_LINES).join('\n');
}

/** Grace period after the direct child exits before we give up on 'close' and force completion. */
const KILL_GRACE_MS = 1000;

function killTree(child: ChildProcess): void {
  if (typeof child.pid !== 'number') return;
  if (process.platform === 'win32') {
    try {
      // /T kills the process tree, /F forces it — cmd.exe's SIGKILL never
      // reaches a descendant such as the node process behind `npm test`.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      return;
    } catch {
      // Fall through to killing the direct child only.
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to killing the direct child only.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already exited.
  }
}

function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<{ exit: number | null; timedOut: boolean; tail: string; durationMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    let buffer = '';
    let settled = false;
    let timedOut = false;
    let lastExitCode: number | null = null;
    let timer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const append = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      if (buffer.length > TAIL_BYTES) buffer = buffer.slice(buffer.length - TAIL_BYTES);
    };
    const finish = (exit: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve({ exit: timedOut ? null : exit, timedOut, tail: tailOf(buffer), durationMs: Date.now() - started });
    };
    // A descendant that escaped the process group (setsid, or a detached helper
    // inheriting stdio) can keep the pipes open indefinitely, so 'close' alone
    // would wait for that descendant's full natural runtime — including when the
    // direct child already exited (e.g. right after firing off such a detached
    // helper) before the timeout below even fires. Once timed out, give 'close' a
    // short grace period and then force completion ourselves regardless of
    // whether the direct child's own 'exit' arrives before or after that point.
    const scheduleGrace = (): void => {
      if (graceTimer || settled) return;
      graceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(lastExitCode);
      }, KILL_GRACE_MS);
    };
    let child: ChildProcess;
    try {
      child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      append(err instanceof Error ? err.message : String(err));
      finish(127);
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      scheduleGrace();
    }, Math.min(timeoutMs, MAX_TIMER_DELAY_MS));
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (err) => {
      append(`\n${err.message}\n`);
      finish(127);
    });
    child.on('exit', (code) => {
      lastExitCode = code ?? 1;
      if (timedOut) scheduleGrace();
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function isFailure(result: { exit: number | null; timed_out: boolean; skipped: boolean }): boolean {
  return !result.skipped && (result.timed_out || result.exit !== 0);
}

async function withLock<T>(lockDir: string, fn: () => T): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let acquired = false;
    try {
      mkdirSync(lockDir);
      acquired = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let stale = false;
      try {
        stale = Date.now() - statSync(lockDir).mtimeMs > 60_000;
      } catch {
        stale = false;
      }
      if (stale) rmSync(lockDir, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (acquired) {
      try {
        return fn();
      } finally {
        rmSync(lockDir, { recursive: true, force: true });
      }
    }
  }
  throw new GSDError(`could not acquire ${lockDir}`, ErrorClassification.Execution);
}

/** Latest result per check name for a phase; {} when nothing has run. */
export function readLatestChecks(projectDir: string, padded: string): Record<string, LatestCheckEntry> {
  const dir = buildStateDir(projectDir, padded);
  if (!dir) return {};
  const parsed = readJson(join(dir, 'latest.json'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, LatestCheckEntry> : {};
}

/** Results of the phase's baseline run (`baseline.json`); [] when it never ran or is unreadable. */
export function readBaselineResults(projectDir: string, padded: string): CheckResult[] {
  const dir = buildStateDir(projectDir, padded);
  if (!dir) return [];
  const parsed = readJson(join(dir, 'baseline.json'));
  const results = parsed && typeof parsed === 'object' ? (parsed as Partial<RunChecksData>).results : undefined;
  return Array.isArray(results) ? results : [];
}

export const buildRunChecks: QueryHandler = async (args, projectDir, workstream) => {
  const { flags, positionals } = parseFlags(args, { values: ['phase', 'set', 'label', 'only'] });
  if (positionals.length > 0) throw invalid(`unexpected argument: ${positionals[0]}`);
  if (typeof flags.phase !== 'string') throw invalid('--phase is required');
  const phaseArg = flags.phase.trim();
  // Key the results folder off the phase's actual on-disk directory when one exists
  // (case preserved, e.g. "03a"), so it agrees with build.finalize's later
  // readLatestChecks(phase.padded) lookup on case-sensitive filesystems. Only fall
  // back to re-normalizing the flag (which uppercases letter suffixes) when the
  // phase has no directory yet.
  const resolvedPhase = await resolveBuildPhase(projectDir, phaseArg, workstream);
  const padded = resolvedPhase?.padded ?? normalizePhaseName(phaseArg);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(padded)) throw invalid(`invalid --phase: ${flags.phase}`);
  if (typeof flags.set !== 'string') throw invalid('--set is required');
  if (!Object.prototype.hasOwnProperty.call(CHECK_SETS, flags.set)) throw invalid('--set must be quick, wave or full');
  const set = flags.set as CheckSet;
  const label = typeof flags.label === 'string' ? flags.label : set;
  if (!LABEL_RE.test(label)) throw invalid(`invalid --label: ${label}`);
  // latest.json holds each command's latest result; a run labelled `latest` would overwrite it.
  if (label === 'latest') throw invalid(`invalid --label: ${label} is reserved`);
  let names = [...CHECK_SETS[set]];
  if (typeof flags.only === 'string') {
    const only = flags.only.split(',').map((item) => item.trim()).filter(Boolean);
    for (const name of only) {
      if (!(CHECK_NAMES as readonly string[]).includes(name)) throw invalid(`unknown check in --only: ${name}`);
    }
    names = names.filter((name) => only.includes(name));
    if (names.length === 0) throw invalid(`--only selects no checks from set ${set}`);
  }

  const stateDir = buildStateDir(projectDir, padded);
  if (!stateDir) return { data: { error: 'git_repository_required' } };

  const config = await loadConfig(projectDir, workstream);
  const workflow = config.workflow as unknown as Record<string, unknown>;
  const detected = detectChecks(projectDir, workflow);
  const timeoutRaw = workflow.build_check_timeout_seconds;
  const timeoutSeconds = typeof timeoutRaw === 'number' && Number.isInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_SECONDS;
  const commit = headCommit(projectDir);
  const baselineResults = label === 'baseline' ? [] : readBaselineResults(projectDir, padded);

  const results: CheckResult[] = [];
  for (const name of names) {
    const command = detected[name];
    if (command === null) {
      results.push({ name, command: null, commit, exit: null, timed_out: false, skipped: true, duration_ms: 0, preexisting: false, output_tail: '' });
      continue;
    }
    const outcome = await runShellCommand(command, projectDir, timeoutSeconds * 1000);
    const current = { exit: outcome.exit, timed_out: outcome.timedOut, skipped: false };
    const preexisting = isFailure(current)
      && baselineResults.some((prior) => prior.name === name && prior.command === command && isFailure(prior));
    results.push({
      name,
      command,
      commit,
      exit: outcome.exit,
      timed_out: outcome.timedOut,
      skipped: false,
      duration_ms: outcome.durationMs,
      preexisting,
      output_tail: outcome.tail,
    });
  }

  const data: RunChecksData = { set, label, passed: results.every((r) => !isFailure(r)), results };
  writeJsonAtomic(join(stateDir, `${label}.json`), data);
  await withLock(join(stateDir, 'latest.lock'), () => {
    const latestPath = join(stateDir, 'latest.json');
    const existing = readJson(latestPath);
    const latest: Record<string, LatestCheckEntry> = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing as Record<string, LatestCheckEntry>
      : {};
    const at = new Date().toISOString();
    for (const r of results) {
      latest[r.name] = { command: r.command, commit: r.commit, exit: r.exit, timed_out: r.timed_out, skipped: r.skipped, passed: !r.skipped && !isFailure(r), at };
    }
    writeJsonAtomic(latestPath, latest);
  });
  return { data };
};
