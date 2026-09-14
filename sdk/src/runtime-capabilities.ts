/**
 * Runtime capability table — per-runtime switches that pick the build tier.
 *
 * Source of truth: sdk/shared/runtime-capabilities.json. Values come from each
 * runtime's own documentation; anything not confirmed there is false. Turning a
 * switch on is the only change needed to give a runtime the faster behavior.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RUNTIME_CAPABILITY_KEYS = [
  'spawn_agents',
  'parallel_agents',
  'worktree_isolation',
  'per_call_model',
  'agent_effort',
  'background_tasks',
  'workflow_scripts',
] as const;

export type RuntimeCapabilityKey = (typeof RUNTIME_CAPABILITY_KEYS)[number];
export type RuntimeCapabilities = Record<RuntimeCapabilityKey, boolean>;

const TABLE_PATH = new URL('../shared/runtime-capabilities.json', import.meta.url);
const TABLE: Record<string, Record<string, unknown>> = JSON.parse(readFileSync(fileURLToPath(TABLE_PATH), 'utf-8'));

/** Resolve the switches for a runtime. Unknown runtimes resolve to all false. */
export function resolveRuntimeCapabilities(runtime: string): RuntimeCapabilities {
  const entry = Object.prototype.hasOwnProperty.call(TABLE, runtime) ? TABLE[runtime] : undefined;
  const result = {} as RuntimeCapabilities;
  for (const key of RUNTIME_CAPABILITY_KEYS) {
    result[key] = entry !== undefined && entry[key] === true;
  }
  return result;
}

/** Runtime names present in the table, sorted. */
export function capabilityTableRuntimes(): string[] {
  return Object.keys(TABLE).sort();
}
