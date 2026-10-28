/**
 * Project pack — `pack.show`.
 *
 * The pack is the `pack` section of .planning/config.json: project facts that
 * fvgsd's specialist agents read instead of guessing (deploy targets, migrations,
 * naming, the handoff file). `pack.show` returns it with the fields still missing,
 * any value problems, and the check, research and verifier settings it sits next to.
 */

import { GSDError, ErrorClassification } from '../errors.js';
import { loadConfig } from '../config.js';
import { detectChecks } from './build-checks.js';
import { parseFlags } from './build-shared.js';
import { validatePackSetting } from './config-mutation.js';
import type { QueryHandler } from './utils.js';

export const PACK_FIELDS = ['name', 'deploy', 'migrations', 'candidates', 'message_prefix', 'handoff_path'] as const;

export const packShow: QueryHandler = async (args, projectDir, workstream) => {
  const { positionals } = parseFlags(args, {});
  if (positionals.length > 0) throw new GSDError('pack.show takes no arguments', ErrorClassification.Validation);
  const config = await loadConfig(projectDir, workstream) as unknown as Record<string, unknown>;
  const workflow = (config.workflow ?? {}) as Record<string, unknown>;
  const raw = config.pack;
  const pack = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const problems: string[] = [];
  if (raw !== undefined && pack === null) problems.push('pack must be a JSON object');
  for (const [key, value] of Object.entries(pack ?? {})) {
    if (!(PACK_FIELDS as readonly string[]).includes(key)) {
      problems.push(`pack.${key}: unknown field`);
      continue;
    }
    const message = validatePackSetting(`pack.${key}`, value);
    if (message) problems.push(`pack.${key}: ${message}`);
  }
  return {
    data: {
      pack,
      missing: PACK_FIELDS.filter((field) => pack?.[field] === undefined),
      problems,
      checks: detectChecks(projectDir, workflow),
      research: workflow.research ?? true,
      verify_report: workflow.build_verify_report === 'lite' ? 'lite' : 'full',
    },
  };
};
