/**
 * Build brief queries — `build.check-brief` and `build.waves`.
 *
 * The brief is `{P}-{NN}-PLAN.md` with `kind: brief`. check-brief validates only the
 * fields code reads (spec "Brief"); waves orders slices by `after` and keeps slices
 * whose `owns` globs overlap out of the same wave.
 */

import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { extractFrontmatter } from './frontmatter.js';
import { FRONTMATTER_SCHEMAS } from './frontmatter-mutation.js';
import { escapeRegex, extractPhaseToken, toPosixPath } from './helpers.js';
import { parseFlags, phaseRequirementIds } from './build-shared.js';
import type { QueryHandler } from './utils.js';

export interface BriefSlice { id: string; goal: string; owns: string[]; after: string[]; strong: boolean }
export interface BriefError { field: string; message: string }
export interface LoadedBrief { absPath: string; relPath: string; content: string; frontmatter: Record<string, unknown>; slices: BriefSlice[] }

const SLICE_ID_RE = /^s[0-9]+$/;
const GLOB_META = /[*?[{]/;

function invalid(message: string): GSDError {
  return new GSDError(message, ErrorClassification.Validation);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Read and parse a brief inside the project. Throws GSDError(Validation) when missing or outside. */
export async function loadBrief(projectDir: string, briefPath: string): Promise<LoadedBrief> {
  if (typeof briefPath !== 'string' || briefPath.trim() === '' || briefPath.includes('\0')) throw invalid('brief path required');
  const root = resolve(projectDir);
  const absPath = isAbsolute(briefPath) ? resolve(briefPath) : resolve(root, briefPath);
  if (!isInside(root, absPath)) throw invalid(`brief path must be inside the project: ${briefPath}`);
  let content: string;
  let realFile: string;
  try {
    realFile = await realpath(absPath);
    content = await readFile(realFile, 'utf-8');
  } catch {
    throw invalid(`brief not found: ${briefPath}`);
  }
  if (!isInside(await realpath(root), realFile)) throw invalid(`brief path must be inside the project: ${briefPath}`);
  const frontmatter = extractFrontmatter(content);
  return { absPath, relPath: toPosixPath(relative(root, absPath)), content, frontmatter, slices: normalizeSlices(frontmatter) };
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter((item) => item !== '');
  if (typeof value === 'string' && value.trim() !== '' && value.trim() !== '[]') return [value.trim()];
  return [];
}

/** Tolerant slice normalization: missing `after` → [], `strong` "true" → true. */
export function normalizeSlices(frontmatter: Record<string, unknown>): BriefSlice[] {
  const raw = frontmatter.slices;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    return {
      id: typeof item.id === 'string' ? item.id.trim() : '',
      goal: typeof item.goal === 'string' ? item.goal : '',
      owns: listOf(item.owns),
      after: listOf(item.after),
      strong: item.strong === true || item.strong === 'true',
    };
  });
}

function sliceNumber(id: string): number {
  const n = Number.parseInt(id.slice(1), 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function compareSlices(a: BriefSlice, b: BriefSlice): number {
  return sliceNumber(a.id) - sliceNumber(b.id) || a.id.localeCompare(b.id);
}

function findCycle(slices: readonly BriefSlice[]): string[] | null {
  const byId = new Map(slices.map((s) => [s.id, s]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const mark = state.get(id);
    if (mark === 'done') return null;
    if (mark === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of byId.get(id)?.after ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const s of [...slices].sort(compareSlices)) {
    const cycle = visit(s.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Check the fields code reads. Nothing else about the brief is checked. */
export function validateBrief(brief: LoadedBrief, requirementIds: readonly string[]): BriefError[] {
  const errors: BriefError[] = [];
  const fm = brief.frontmatter;
  for (const key of FRONTMATTER_SCHEMAS.plan.required) {
    if (fm[key] === undefined || fm[key] === '') errors.push({ field: key, message: 'required' });
  }
  if (fm.kind !== 'brief') errors.push({ field: 'kind', message: 'must be "brief"' });
  if (requirementIds.length > 0 && listOf(Array.isArray(fm.requirements) ? fm.requirements : []).length === 0) {
    errors.push({ field: 'requirements', message: `must list the phase requirement IDs (${requirementIds.join(', ')})` });
  }

  const rawSlices = fm.slices;
  if (!Array.isArray(rawSlices) || rawSlices.length === 0) {
    errors.push({ field: 'slices', message: 'at least one slice is required' });
  } else {
    const ids = new Set<string>();
    rawSlices.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push({ field: `slices[${i}]`, message: 'must be a mapping with id, goal, owns and after' });
        return;
      }
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!SLICE_ID_RE.test(id)) errors.push({ field: `slices[${i}].id`, message: 'must match ^s[0-9]+$' });
      else if (ids.has(id)) errors.push({ field: `slices[${i}].id`, message: `duplicate slice id ${id}` });
      else ids.add(id);
      const owns = item.owns;
      if (!Array.isArray(owns) || owns.length === 0 || owns.some((glob) => typeof glob !== 'string' || glob.trim() === '')) {
        errors.push({ field: `slices[${i}].owns`, message: 'must list at least one non-empty glob' });
      }
    });
    brief.slices.forEach((s, i) => {
      s.after.forEach((dep, j) => {
        if (!ids.has(dep)) errors.push({ field: `slices[${i}].after[${j}]`, message: `unknown slice ${dep}` });
      });
    });
    const cycle = findCycle(brief.slices.filter((s) => ids.has(s.id)));
    if (cycle) errors.push({ field: 'slices', message: `dependency cycle: ${cycle.join(' -> ')}` });
  }

  const body = brief.content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  if (!/<objective>[\s\S]*?<\/objective>/.test(body)) errors.push({ field: 'objective', message: '<objective> block is required' });
  return errors;
}

/** Ordered waves: a slice runs after its `after` slices; overlapping `owns` never share a wave. */
export function computeWaves(slices: readonly BriefSlice[]): string[][] {
  const byId = new Map(slices.map((s) => [s.id, s]));
  const indegree = new Map<string, number>(slices.map((s) => [s.id, 0]));
  const dependents = new Map<string, string[]>(slices.map((s) => [s.id, []]));
  for (const s of slices) {
    for (const dep of new Set(s.after)) {
      if (!byId.has(dep)) continue;
      indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
      dependents.get(dep)!.push(s.id);
    }
  }
  const ready = slices.filter((s) => indegree.get(s.id) === 0).sort(compareSlices);
  const waveOf = new Map<string, number>();
  const waves: string[][] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    let wave = 0;
    for (const dep of current.after) {
      const depWave = waveOf.get(dep);
      if (depWave !== undefined) wave = Math.max(wave, depWave + 1);
    }
    while ((waves[wave] ?? []).some((otherId) => ownsOverlap(byId.get(otherId)!.owns, current.owns))) wave += 1;
    waveOf.set(current.id, wave);
    (waves[wave] ??= []).push(current.id);
    for (const next of dependents.get(current.id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) {
        ready.push(byId.get(next)!);
        ready.sort(compareSlices);
      }
    }
  }
  if (waveOf.size !== slices.length) throw invalid('brief slices contain a dependency cycle');
  return waves.filter((w) => Array.isArray(w) && w.length > 0);
}

function normalizePattern(pattern: string): string {
  let value = pattern.trim().replace(/\\/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  return value.replace(/\/{2,}/g, '/');
}

/** Glob to RegExp: `**` (any segments), `*`, `?`, `[..]` / `[!..]`, `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  const g = normalizePattern(glob);
  let re = '';
  let braces = 0;
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      const atSegmentStart = i === 0 || g[i - 1] === '/';
      if (g[i + 1] === '*' && atSegmentStart && g[i + 2] === '/') {
        re += '(?:[^/]*/)*';
        i += 2;
      } else if (g[i + 1] === '*' && atSegmentStart && i + 2 === g.length) {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
        if (g[i + 1] === '*') i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const close = g.indexOf(']', i + 1);
      if (close === -1) {
        re += '\\[';
        continue;
      }
      let body = g.slice(i + 1, close);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      re += `[${body.replace(/\\/g, '\\\\')}]`;
      i = close;
    } else if (c === '{') {
      braces += 1;
      re += '(?:';
    } else if (c === '}' && braces > 0) {
      braces -= 1;
      re += ')';
    } else if (c === ',' && braces > 0) {
      re += '|';
    } else {
      re += escapeRegex(c);
    }
  }
  if (braces > 0) return new RegExp(`^${escapeRegex(g)}$`);
  return new RegExp(`^${re}$`);
}

export function fileMatchesGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(normalizePattern(file));
}

function literalPrefix(glob: string): string[] {
  const segments = normalizePattern(glob).split('/').filter(Boolean);
  const index = segments.findIndex((segment) => GLOB_META.test(segment));
  return index === -1 ? segments : segments.slice(0, index);
}

/** Conservative overlap test: may report overlap that doesn't exist, never misses a literal match. */
export function globsOverlap(a: string, b: string): boolean {
  const aGlob = GLOB_META.test(a);
  const bGlob = GLOB_META.test(b);
  if (!aGlob && !bGlob) return normalizePattern(a) === normalizePattern(b);
  if (!aGlob) return fileMatchesGlob(a, b);
  if (!bGlob) return fileMatchesGlob(b, a);
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    if (pa[i] !== pb[i]) return false;
  }
  return true;
}

export function ownsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => globsOverlap(x, y)));
}

function briefPathArg(args: readonly string[], usage: string): string {
  const { positionals } = parseFlags(args, {});
  if (positionals.length !== 1) throw invalid(usage);
  return positionals[0];
}

export const buildCheckBrief: QueryHandler = async (args, projectDir, workstream) => {
  const brief = await loadBrief(projectDir, briefPathArg(args, 'usage: build.check-brief <path>'));
  const phaseValue = typeof brief.frontmatter.phase === 'string' ? brief.frontmatter.phase : '';
  const requirementIds = phaseValue ? await phaseRequirementIds(projectDir, extractPhaseToken(phaseValue), workstream) : [];
  const errors = validateBrief(brief, requirementIds);
  return { data: { valid: errors.length === 0, errors } };
};

export const buildWaves: QueryHandler = async (args, projectDir) => {
  const brief = await loadBrief(projectDir, briefPathArg(args, 'usage: build.waves <path>'));
  const errors = validateBrief(brief, []).filter((e) => e.field === 'slices' || e.field.startsWith('slices['));
  if (errors.length > 0) return { data: { error: 'invalid_brief', errors } };
  return { data: { waves: computeWaves(brief.slices) } };
};
