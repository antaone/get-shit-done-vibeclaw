/**
 * Context engine — resolves which .planning/ state files exist per phase type.
 *
 * Different phases need different subsets of context files. The execute phase
 * only needs STATE.md + config.json (minimal). Research needs STATE.md +
 * ROADMAP.md + CONTEXT.md. Plan needs all files. Verify needs STATE.md +
 * ROADMAP.md + REQUIREMENTS.md + PLAN/SUMMARY files.
 *
 * Context reduction (issue #1614):
 * - Large files are truncated to keep prompts cache-friendly
 * - ROADMAP.md is narrowed to the current milestone when possible
 * - Truncation preserves headings + first paragraph per section
 */

import { readFile, access, readdir } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { constants } from 'node:fs';

import type { ContextFiles } from './types.js';
import { PhaseType } from './types.js';
import type { GSDLogger } from './logger.js';
import {
  truncateMarkdown,
  extractCurrentMilestone,
  DEFAULT_TRUNCATION_OPTIONS,
  type TruncationOptions,
} from './context-truncation.js';
import { relPlanningPath } from './workstream-utils.js';

// ─── File manifest per phase ─────────────────────────────────────────────────

interface FileSpec {
  key: Exclude<keyof ContextFiles, 'milestoneFile'>;
  filename: string;
  /** Other names tried at the .planning/ root when `filename` is missing. */
  fallbacks?: string[];
  required: boolean;
}

/**
 * Define which files each phase needs. Required files emit warnings when missing;
 * optional files silently return undefined.
 */
const PHASE_FILE_MANIFEST: Record<PhaseType, FileSpec[]> = {
  [PhaseType.Execute]: [
    { key: 'state', filename: 'STATE.md', required: true },
    { key: 'config', filename: 'config.json', required: false },
  ],
  [PhaseType.Research]: [
    { key: 'state', filename: 'STATE.md', required: true },
    { key: 'roadmap', filename: 'ROADMAP.md', required: true },
    { key: 'context', filename: 'CONTEXT.md', required: true },
    { key: 'requirements', filename: 'REQUIREMENTS.md', required: false },
  ],
  [PhaseType.Plan]: [
    { key: 'state', filename: 'STATE.md', required: true },
    { key: 'roadmap', filename: 'ROADMAP.md', required: true },
    { key: 'context', filename: 'CONTEXT.md', required: true },
    { key: 'research', filename: 'RESEARCH.md', required: false },
    { key: 'requirements', filename: 'REQUIREMENTS.md', required: false },
  ],
  [PhaseType.Verify]: [
    { key: 'state', filename: 'STATE.md', required: true },
    { key: 'roadmap', filename: 'ROADMAP.md', required: true },
    { key: 'requirements', filename: 'REQUIREMENTS.md', required: false },
    { key: 'plan', filename: 'PLAN.md', required: false },
    { key: 'summary', filename: 'SUMMARY.md', required: false },
  ],
  [PhaseType.Repair]: [
    { key: 'state', filename: 'STATE.md', required: true },
    { key: 'config', filename: 'config.json', required: false },
    { key: 'plan', filename: 'PLAN.md', required: false },
  ],
  [PhaseType.Discuss]: [
    { key: 'state', filename: 'STATE.md', required: true },
    { key: 'roadmap', filename: 'ROADMAP.md', required: false },
    { key: 'context', filename: 'CONTEXT.md', required: false },
  ],
  [PhaseType.Build]: [
    { key: 'state', filename: 'STATE.md', required: true },
    { key: 'roadmap', filename: 'ROADMAP.md', required: true },
    { key: 'context', filename: 'CONTEXT.md', required: true },
    { key: 'research', filename: 'RESEARCH.md', required: false },
    { key: 'requirements', filename: 'REQUIREMENTS.md', required: false },
    { key: 'milestone', filename: 'MILESTONE-CONTEXT.md', fallbacks: ['MILESTONE-BRIEF.md'], required: false },
  ],
};

/** Manifest keys looked up in the phase folder (`NN-CONTEXT.md`, `CONTEXT.md`) before the .planning/ root. */
const PHASE_FOLDER_KEYS: ReadonlySet<keyof ContextFiles> = new Set<keyof ContextFiles>(['context', 'research']);

// ─── ContextEngine class ─────────────────────────────────────────────────────

export class ContextEngine {
  private readonly projectDir: string;
  private readonly planningDir: string;
  private readonly logger?: GSDLogger;
  private readonly truncation: TruncationOptions;

  constructor(projectDir: string, logger?: GSDLogger, truncation?: Partial<TruncationOptions>, workstream?: string) {
    this.projectDir = projectDir;
    this.planningDir = join(projectDir, relPlanningPath(workstream));
    this.logger = logger;
    this.truncation = { ...DEFAULT_TRUNCATION_OPTIONS, ...truncation };
  }

  /**
   * Resolve context files appropriate for the given phase type.
   * Reads each file defined in the phase manifest, returning undefined
   * for missing optional files and warning for missing required files.
   *
   * Files exceeding the truncation threshold are reduced to headings +
   * first paragraphs. ROADMAP.md is narrowed to the current milestone.
   */
  async resolveContextFiles(phaseType: PhaseType, phaseDir?: string): Promise<ContextFiles> {
    const manifest = PHASE_FILE_MANIFEST[phaseType];
    const result: ContextFiles = {};

    for (const spec of manifest) {
      const filePath = await this.locateFile(spec, phaseDir);
      const content = await this.readFileIfExists(filePath);

      if (content !== undefined) {
        result[spec.key] = content;
        if (spec.key === 'milestone') result.milestoneFile = basename(filePath);
      } else if (spec.required) {
        this.logger?.warn(`Required context file missing for ${phaseType} phase: ${spec.filename}`, {
          phase: phaseType,
          file: spec.filename,
          path: filePath,
        });
      }
    }

    // Apply context reduction: milestone extraction then truncation
    if (result.roadmap && result.state) {
      const before = result.roadmap.length;
      result.roadmap = extractCurrentMilestone(result.roadmap, result.state);
      if (result.roadmap.length < before) {
        this.logger?.debug?.('ROADMAP.md narrowed to current milestone', {
          before,
          after: result.roadmap.length,
        });
      }
    }

    // Truncate oversized files (skip config.json — structured data, not markdown)
    const truncatable: Array<{ key: FileSpec['key']; filename: string }> = [
      { key: 'roadmap', filename: 'ROADMAP.md' },
      { key: 'context', filename: 'CONTEXT.md' },
      { key: 'research', filename: 'RESEARCH.md' },
      { key: 'requirements', filename: 'REQUIREMENTS.md' },
      { key: 'plan', filename: 'PLAN.md' },
      { key: 'summary', filename: 'SUMMARY.md' },
      { key: 'milestone', filename: result.milestoneFile ?? 'MILESTONE-CONTEXT.md' },
    ];

    for (const { key, filename } of truncatable) {
      const raw = result[key];
      if (raw && raw.length > this.truncation.maxContentLength) {
        const before = raw.length;
        result[key] = truncateMarkdown(raw, filename, this.truncation);
        this.logger?.debug?.(`${filename} truncated`, {
          before,
          after: result[key]!.length,
        });
      }
    }

    return result;
  }

  /**
   * Resolve where a manifest file is read from. CONTEXT.md and RESEARCH.md are
   * looked up in the phase folder first (first sorted `*-CONTEXT.md` or
   * `CONTEXT.md`), then at the .planning/ root. When a spec's root file is
   * missing, its `fallbacks` are tried at the root in order.
   */
  private async locateFile(spec: FileSpec, phaseDir?: string): Promise<string> {
    if (phaseDir && PHASE_FOLDER_KEYS.has(spec.key)) {
      const dir = isAbsolute(phaseDir) ? phaseDir : join(this.projectDir, phaseDir);
      try {
        const match = (await readdir(dir))
          .filter((name) => name === spec.filename || name.endsWith(`-${spec.filename}`))
          .sort()[0];
        if (match) return join(dir, match);
      } catch {
        // Missing phase folder: use the .planning/ root.
      }
    }
    const primary = join(this.planningDir, spec.filename);
    if (!spec.fallbacks || (await this.readFileIfExists(primary)) !== undefined) return primary;
    for (const name of spec.fallbacks) {
      const candidate = join(this.planningDir, name);
      if ((await this.readFileIfExists(candidate)) !== undefined) return candidate;
    }
    return primary;
  }

  /**
   * Check if a file exists and read it. Returns undefined if not found.
   */
  private async readFileIfExists(filePath: string): Promise<string | undefined> {
    try {
      await access(filePath, constants.R_OK);
      return await readFile(filePath, 'utf-8');
    } catch {
      return undefined;
    }
  }
}

export { PHASE_FILE_MANIFEST };
export type { FileSpec };
