/**
 * Runtime gate — guards entry points that only support the Claude runtime.
 *
 * The autonomous SDK orchestrator (`fvgsd-sdk auto`) currently drives plan
 * execution through `@anthropic-ai/claude-agent-sdk`. It has no Codex /
 * Gemini / OpenCode dispatcher today, so silently routing a non-Claude
 * project's autonomous run through the Claude path is incorrect: it picks
 * Claude models, hits Claude APIs, and confuses users debugging "why is my
 * Codex run choosing claude-sonnet-4-6?" (issue #2832).
 *
 * Fail fast with an actionable error instead. The fix surfaces the limitation
 * up front and points users at the supported in-session GSD slash commands
 * for non-Claude runtimes.
 */
import { detectRuntime, SUPPORTED_RUNTIMES, type Runtime } from './query/helpers.js';

/**
 * Throw a clear error when the active runtime is not Claude.
 *
 * Precedence mirrors `detectRuntime`: `FVGSD_RUNTIME` env var > `config.runtime`
 * > `'claude'`. Unknown / missing runtime values default to Claude (the
 * historical behavior) so existing Claude users are unaffected.
 *
 * @param config Project config (with optional `runtime` field).
 * @throws Error with a runtime-specific actionable message when non-Claude.
 */
export function assertRuntimeSupportsAutoMode(config?: Record<string, unknown> | { runtime?: unknown }): void {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const runtime: Runtime = detectRuntime({ runtime: cfg.runtime });
  if (runtime === 'claude') return;

  // Source attribution must reflect what `detectRuntime()` actually used:
  // a `FVGSD_RUNTIME` value that isn't in SUPPORTED_RUNTIMES falls through to
  // the config tier, so reporting it as the source would be misleading.
  const env = process.env.FVGSD_RUNTIME;
  const envIsSupported =
    typeof env === 'string' && (SUPPORTED_RUNTIMES as readonly string[]).includes(env);
  const source = envIsSupported
    ? `FVGSD_RUNTIME=${env}`
    : `config.runtime="${String(cfg.runtime ?? '')}"`;

  throw new Error(
    `fvgsd-sdk auto currently supports the Claude runtime only ` +
    `(detected runtime=${runtime} via ${source}). ` +
    `Autonomous terminal runs through the Claude Agent SDK; non-Claude ` +
    `runtimes (Codex, Gemini, OpenCode, etc.) must drive GSD via the ` +
    `in-session slash commands (e.g. /fvgsd-discuss-phase, /fvgsd-plan-phase, ` +
    `/fvgsd-execute-phase) until issue #2832 lands a multi-runtime executor. ` +
    `To run on Claude anyway, unset FVGSD_RUNTIME and set runtime: "claude" ` +
    `in .planning/config.json.`,
  );
}
