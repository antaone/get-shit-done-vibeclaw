/**
 * build.finalize — close a build: fill the summary frontmatter, check that
 * every CONTEXT decision and phase requirement ID appears in the brief or in
 * the summary as the lead wrote it, update STATE, ROADMAP and REQUIREMENTS
 * through the existing handlers, and commit. See the spec's "Summary and finalize".
 */

import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { commit } from './commit.js';
import { parseDecisions } from './decisions.js';
import { extractFrontmatter } from './frontmatter.js';
import { escapeRegex, planningPaths, toPosixPath } from './helpers.js';
import { phaseComplete } from './phase-lifecycle.js';
import { requirementsMarkComplete } from './roadmap.js';
import { roadmapUpdatePlanProgress } from './roadmap-update-plan-progress.js';
import { stateRecordMetric, stateUpdateProgress } from './state-mutation.js';
import { readLatestChecks } from './build-checks.js';
import {
  changedFilesSince,
  codeHead,
  firstAddCommit,
  listPhasePlanFiles,
  parseFlags,
  phaseRequirementIds,
  readVerification,
  resolveBuildPhase,
  runGit,
  sameCodeTree,
} from './build-shared.js';
import type { QueryHandler } from './utils.js';

const ENGINES = ['agents', 'workflow'];
const TIERS = ['parallel', 'sequential', 'inline'];

function invalid(message: string): never {
  throw new GSDError(message, ErrorClassification.Validation);
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value);
  // No ':' in plain scalars: extractFrontmatter reads a list item such as `- a:b` as a map.
  const plain = /^[A-Za-z0-9_./@+-][A-Za-z0-9_ ./@+-]*$/.test(text)
    && text.trim() === text
    && !/^(?:true|false|null|yes|no|on|off|~)$/i.test(text);
  return plain ? text : JSON.stringify(text);
}

function yamlLines(key: string, value: unknown, indent: string): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${key}: []`];
    return [`${indent}${key}:`, ...value.map((item) => `${indent}  - ${yamlScalar(item)}`)];
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${indent}${key}: {}`];
    return [`${indent}${key}:`, ...entries.flatMap(([child, childValue]) => yamlLines(child, childValue, `${indent}  `))];
  }
  return [`${indent}${key}: ${yamlScalar(value)}`];
}

/** The frontmatter lines outside `ownedKeys` (nested lines follow their key), and the body. */
function withoutOwnedKeys(content: string, ownedKeys: ReadonlySet<string>): { kept: string[]; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  // Same closing-line rule as extractFrontmatter (frontmatter.ts): the first `\n---` after the
  // opening fence closes the block, whatever follows on that line. `[^\n]*` consumes any trailing
  // content on the closing line (for example a trailing space) so the body starts after that whole
  // line, not mid-line — otherwise this and extractFrontmatter would disagree about where the
  // frontmatter ends, either losing the lead's block to the body or eating body lines as frontmatter.
  const match = normalized.match(/^---\n([\s\S]*?)\n---[^\n]*(?:\n|$)/);
  const kept: string[] = [];
  if (match) {
    let keep = true;
    for (const line of match[1].split('\n')) {
      const key = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):(?:\s|$)/)?.[1];
      if (key !== undefined) keep = !ownedKeys.has(key);
      if (keep) kept.push(line);
    }
  }
  return { kept, body: match ? normalized.slice(match[0].length) : `\n${normalized}` };
}

/** Write `owned` keys first; keep every other top-level frontmatter block and the body unchanged. */
export function upsertFrontmatterKeys(content: string, owned: Record<string, unknown>): string {
  const { kept, body } = withoutOwnedKeys(content, new Set(Object.keys(owned)));
  const lines = [...Object.entries(owned).flatMap(([key, value]) => yamlLines(key, value, '')), ...kept];
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

function mentions(text: string, id: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegex(id)}(?![A-Za-z0-9_-])`).test(text);
}

export const buildFinalize: QueryHandler = async (args, projectDir, workstream) => {
  const { flags } = parseFlags(args, {
    values: ['phase', 'plan', 'base', 'engine', 'tier', 'fix-rounds', 'requirements-completed'],
  });
  const phaseArg = flags.phase;
  const plan = flags.plan;
  const base = flags.base;
  const engine = flags.engine;
  const tier = flags.tier;
  if (typeof phaseArg !== 'string') invalid('--phase is required');
  if (typeof plan !== 'string' || !/^\d{2,}$/.test(plan)) invalid('--plan must be a plan number such as 01');
  if (typeof base !== 'string' || !runGit(projectDir, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) {
    invalid('--base must name an existing commit');
  }
  if (typeof engine !== 'string' || !ENGINES.includes(engine)) invalid(`--engine must be one of ${ENGINES.join(', ')}`);
  if (typeof tier !== 'string' || !TIERS.includes(tier)) invalid(`--tier must be one of ${TIERS.join(', ')}`);
  const fixRounds = Number(flags['fix-rounds']);
  if (typeof flags['fix-rounds'] !== 'string' || !Number.isInteger(fixRounds) || fixRounds < 0) {
    invalid('--fix-rounds must be a non-negative integer');
  }
  const completedRaw = flags['requirements-completed'];
  const completedIds = typeof completedRaw === 'string'
    ? [...new Set(completedRaw.split(/[,\s]+/).map((id) => id.trim()).filter(Boolean))]
    : [];

  const phase = await resolveBuildPhase(projectDir, phaseArg, workstream);
  if (!phase) invalid(`phase ${phaseArg} not found`);
  const planFile = listPhasePlanFiles(phase.dirAbs, phase.padded).find((candidate) => candidate.nn === plan);
  if (!planFile || planFile.kind !== 'brief') invalid(`no build brief for plan ${plan} in ${phase.dir}`);
  const summaryRel = `${phase.dir}/${phase.padded}-${plan}-SUMMARY.md`;
  const summaryAbs = join(projectDir, summaryRel);
  if (!existsSync(summaryAbs)) invalid(`write ${summaryRel} (body, subsystem, tags) before running build.finalize`);
  const summaryContent = await readFile(summaryAbs, 'utf-8');
  const leadFrontmatter = extractFrontmatter(summaryContent);
  const missingKeys = ['subsystem', 'tags'].filter((key) => leadFrontmatter[key] === undefined || leadFrontmatter[key] === '');
  if (missingKeys.length > 0) invalid(`summary frontmatter is missing: ${missingKeys.join(', ')}`);

  // 1. Summary frontmatter (computed now; the write itself is deferred until ID coverage
  // passes below, so a refused run leaves the summary on disk byte-for-byte unchanged —
  // otherwise init.build could see a `kind: build-summary` for a build that never finalized).
  const now = new Date();
  const briefRel = `${phase.dir}/${planFile.file}`;
  const startedIso = firstAddCommit(projectDir, briefRel)?.time ?? now.toISOString();
  const startedMs = Date.parse(startedIso);
  const minutes = Number.isFinite(startedMs) ? Math.max(1, Math.round((now.getTime() - startedMs) / 60000)) : 1;
  const changes = changedFilesSince(projectDir, base);
  const created = changes.filter((change) => change.status === 'A').map((change) => change.path);
  const modified = changes.filter((change) => change.status !== 'A' && change.status !== 'D').map((change) => change.path);

  const head = codeHead(projectDir);
  const checks: Record<string, string> = {};
  let ran = 0;
  let allPassedAtHead = head !== null;
  for (const [name, entry] of Object.entries(readLatestChecks(projectDir, phase.padded))) {
    if (entry.skipped) {
      checks[name] = 'skipped';
      continue;
    }
    ran += 1;
    checks[name] = entry.passed ? 'pass' : entry.timed_out ? 'timeout' : 'fail';
    if (!entry.passed || head === null || !sameCodeTree(projectDir, entry.commit, head)) allPassedAtHead = false;
  }

  const owned: Record<string, unknown> = {
    phase: basename(phase.dir),
    plan,
    kind: 'build-summary',
    duration: `${minutes}min`,
    completed: now.toISOString().slice(0, 10),
    'key-files': { created, modified },
    'requirements-completed': completedIds,
    build: {
      started: startedIso,
      completed: now.toISOString(),
      engine,
      tier,
      slices: planFile.sliceIds,
      fix_rounds: fixRounds,
      checks,
      checks_passed_at: allPassedAtHead && ran > 0 ? head : null,
    },
  };

  // 2. ID coverage over the brief and the summary as the lead wrote it. Keys finalize owns,
  // requirements-completed included (from this run or an earlier one), never count.
  const contextFile = readdirSync(phase.dirAbs).sort().find((file) => file === 'CONTEXT.md' || file.endsWith('-CONTEXT.md'));
  const decisionIds = contextFile
    ? [...new Set(parseDecisions(await readFile(join(phase.dirAbs, contextFile), 'utf-8')).map((decision) => decision.id))]
    : [];
  const requirementIds = await phaseRequirementIds(projectDir, phase.number, workstream);
  const leadSummary = withoutOwnedKeys(summaryContent, new Set(Object.keys(owned)));
  const searchable = [await readFile(join(phase.dirAbs, planFile.file), 'utf-8'), ...leadSummary.kept, leadSummary.body].join('\n');
  const missing = {
    decisions: decisionIds.filter((id) => !mentions(searchable, id)),
    requirements: requirementIds.filter((id) => !mentions(searchable, id)),
  };
  if (missing.decisions.length > 0 || missing.requirements.length > 0) {
    return { data: { ok: false, missing } };
  }

  // Coverage passed: now it's safe to write the summary frontmatter.
  await writeFile(summaryAbs, upsertFrontmatterKeys(summaryContent, owned), 'utf-8');

  // 3. State updates through the existing handlers
  const warnings: string[] = [];
  const step = async (label: string, run: () => Promise<{ data: unknown }>): Promise<boolean> => {
    try {
      const { data } = await run();
      const error = data && typeof data === 'object' ? (data as Record<string, unknown>).error : undefined;
      if (typeof error !== 'string') return true;
      warnings.push(`${label}: ${error}`);
    } catch (err) {
      warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  };
  await step('state.update-progress', () => stateUpdateProgress([], projectDir, workstream));
  await step('state.record-metric', () => stateRecordMetric([
    '--phase', phase.padded, '--plan', plan, '--duration', `${minutes}min`,
    '--tasks', String(planFile.sliceIds.length), '--files', String(created.length + modified.length),
  ], projectDir, workstream));
  const verification = readVerification(phase.dirAbs, phase.padded);
  const verificationPassed = verification?.status === 'passed';
  // roadmap.update-plan-progress marks the phase's ROADMAP checkbox complete purely from plan/
  // summary file counts, so it must wait for a passed verification too — otherwise roadmap.analyze
  // would report a gaps_found phase as complete, the same "complete only on passed" spec rule that
  // gates phase.complete below.
  if (verificationPassed) {
    await step('roadmap.update-plan-progress', () => roadmapUpdatePlanProgress([phase.padded], projectDir, workstream));
  }
  if (completedIds.length > 0) {
    await step('requirements.mark-complete', () => requirementsMarkComplete(completedIds, projectDir, workstream));
  }
  const phaseCompleted = verificationPassed
    && await step('phase.complete', () => phaseComplete([phase.padded], projectDir, workstream));

  // 4. Commit
  const paths = planningPaths(projectDir, workstream);
  const files = [summaryAbs, verification?.path ?? '', join(phase.dirAbs, `${phase.padded}-HUMAN-UAT.md`), paths.state, paths.roadmap, paths.requirements]
    .filter((file) => file !== '' && existsSync(file))
    .map((file) => toPosixPath(relative(projectDir, file)));
  let commitHash: string | null = null;
  try {
    const { data } = await commit([`docs(${phase.padded}): build summary and verification`, '--files', ...files], projectDir, workstream);
    const record = data as Record<string, unknown>;
    if (record.committed === true && typeof record.hash === 'string') commitHash = record.hash;
    else if (typeof record.reason === 'string' && record.reason !== 'commit_docs disabled') warnings.push(`commit: ${record.reason}`);
  } catch (err) {
    warnings.push(`commit: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { data: { ok: true, phase_complete: phaseCompleted === true, commit: commitHash, warnings } };
};
