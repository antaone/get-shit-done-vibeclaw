import { IDENTITY } from '../identity.js';

export const UNKNOWN_COMMAND_HINTS: readonly string[] = [
  'Use a registered `fvgsd-sdk query` subcommand (see sdk/src/query/QUERY-HANDLERS.md).',
  `Invoke \`node …/${IDENTITY.toolsScript}\` for CJS-only operations.`,
  'Unset FVGSD_QUERY_FALLBACK or set it to a non-restricted value to enable fallback.',
] as const;
