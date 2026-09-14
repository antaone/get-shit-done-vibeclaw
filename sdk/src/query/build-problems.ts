/**
 * build.group-problems — map remaining build problems (new check failures,
 * verifier gaps, stub findings, critical review findings) to the brief slice
 * that owns their files, so the lead can start one fixing builder per group.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { parseFlags, runGit } from './build-shared.js';
import { fileMatchesGlob, loadBrief, type BriefSlice } from './build-brief.js';
import type { QueryHandler } from './utils.js';

export type ProblemKind = 'check' | 'gap' | 'stub' | 'review';
export interface BuildProblem { id?: string; kind: ProblemKind; summary: string; files?: string[] }
export interface ProblemGroup { slice: string; problems: BuildProblem[]; files: string[] }

const PROBLEM_KINDS: readonly ProblemKind[] = ['check', 'gap', 'stub', 'review'];

function invalid(message: string): never {
  throw new GSDError(message, ErrorClassification.Validation);
}

function normalizeFile(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function parseProblems(raw: string): BuildProblem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid('problems must be valid JSON');
  }
  if (!Array.isArray(parsed)) invalid('problems must be a JSON array');
  return parsed.map((item: unknown, index: number): BuildProblem => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(`problems[${index}] must be an object`);
    const record = item as Record<string, unknown>;
    if (!PROBLEM_KINDS.includes(record.kind as ProblemKind)) {
      invalid(`problems[${index}].kind must be one of ${PROBLEM_KINDS.join(', ')}`);
    }
    if (typeof record.summary !== 'string' || record.summary.trim() === '') {
      invalid(`problems[${index}].summary must be a non-empty string`);
    }
    if (record.id !== undefined && typeof record.id !== 'string') invalid(`problems[${index}].id must be a string`);
    const problem: BuildProblem = { kind: record.kind as ProblemKind, summary: record.summary as string };
    if (typeof record.id === 'string') problem.id = record.id;
    if (record.files !== undefined) {
      if (!Array.isArray(record.files) || record.files.some((file) => typeof file !== 'string' || file.trim() === '')) {
        invalid(`problems[${index}].files must be a list of non-empty strings`);
      }
      problem.files = (record.files as string[]).map(normalizeFile);
    }
    return problem;
  });
}

function directChildren(projectDir: string, dir: string, cache: Map<string, string[]>): string[] {
  const cached = cache.get(dir);
  if (cached) return cached;
  const listed = runGit(projectDir, ['-c', 'core.quotepath=off', 'ls-files', '--', dir]);
  const children = listed.ok
    ? listed.stdout.split('\n').map(normalizeFile).filter((file) => file !== '' && posix.dirname(file) === dir)
    : [];
  cache.set(dir, children);
  return children;
}

export function ownerOfFile(
  projectDir: string,
  file: string,
  slices: readonly BriefSlice[],
  cache: Map<string, string[]> = new Map(),
): string {
  for (const slice of slices) {
    if (slice.owns.some((glob) => fileMatchesGlob(file, glob))) return slice.id;
  }
  const children = directChildren(projectDir, posix.dirname(file), cache);
  let owner = 'fix';
  let best = 0;
  for (const slice of slices) {
    const count = children.filter((child) => slice.owns.some((glob) => fileMatchesGlob(child, glob))).length;
    if (count > best) {
      owner = slice.id;
      best = count;
    }
  }
  return owner;
}

export function groupProblems(
  projectDir: string,
  slices: readonly BriefSlice[],
  problems: readonly BuildProblem[],
): { groups: ProblemGroup[]; batches: string[][] } {
  const cache = new Map<string, string[]>();
  const bySlice = new Map<string, { problems: BuildProblem[]; files: Set<string> }>();
  for (const problem of problems) {
    const files = problem.files ?? [];
    const slice = files.length > 0 ? ownerOfFile(projectDir, files[0], slices, cache) : 'fix';
    const entry = bySlice.get(slice) ?? { problems: [], files: new Set<string>() };
    entry.problems.push(problem);
    for (const file of files) entry.files.add(file);
    bySlice.set(slice, entry);
  }

  const groups: ProblemGroup[] = [...slices.map((slice) => slice.id), 'fix']
    .filter((id) => bySlice.has(id))
    .map((id) => ({ slice: id, problems: bySlice.get(id)!.problems, files: [...bySlice.get(id)!.files] }));

  const batches: Array<{ slices: string[]; files: Set<string> }> = [];
  const fileless: string[] = [];
  for (const group of groups) {
    if (group.files.length === 0) {
      fileless.push(group.slice);
      continue;
    }
    const batch = batches.find((candidate) => group.files.every((file) => !candidate.files.has(file)));
    if (batch) {
      batch.slices.push(group.slice);
      for (const file of group.files) batch.files.add(file);
    } else {
      batches.push({ slices: [group.slice], files: new Set(group.files) });
    }
  }
  const ordered = batches.map((batch) => batch.slices);
  if (fileless.length > 0) ordered.push(fileless);
  return { groups, batches: ordered };
}

export const buildGroupProblems: QueryHandler = async (args, projectDir) => {
  const { flags } = parseFlags(args, { values: ['brief', 'problems', 'problems-file'] });
  if (typeof flags.brief !== 'string') invalid('--brief <path> is required');
  const inline = flags.problems;
  const fromFile = flags['problems-file'];
  if ((inline === undefined) === (fromFile === undefined)) {
    invalid('pass exactly one of --problems <json> or --problems-file <path>');
  }

  const brief = await loadBrief(projectDir, flags.brief);
  let raw: string;
  if (typeof inline === 'string') {
    raw = inline;
  } else {
    const filePath = String(fromFile);
    try {
      raw = await readFile(isAbsolute(filePath) ? filePath : resolve(projectDir, filePath), 'utf-8');
    } catch {
      invalid(`cannot read problems file: ${filePath}`);
    }
  }
  return { data: groupProblems(projectDir, brief.slices, parseProblems(raw)) };
};
