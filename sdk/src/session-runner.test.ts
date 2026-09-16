/**
 * Unit tests for session-runner.ts
 *
 * Regression test for #2194: runPhaseStepSession was passing the full prompt
 * string as both the user-visible prompt: message and systemPrompt.append,
 * doubling the token cost on every phase step invocation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PhaseStepType } from './types.js';
import { CONFIG_DEFAULTS } from './config.js';
import type { GSDConfig } from './config.js';

// ─── Mock the Agent SDK ───────────────────────────────────────────────────────

// Capture the query call options so we can assert on them without making real API calls.
const mockQueryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  async function* fakeQueryStream() {
    // Yield a minimal success result message so processQueryStream completes.
    yield {
      type: 'result',
      subtype: 'success',
      session_id: 'test-session',
      total_cost_usd: 0,
      duration_ms: 1,
      num_turns: 1,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
  }

  return {
    query: vi.fn((args: { prompt: string; options: Record<string, unknown> }) => {
      mockQueryCalls.push({ prompt: args.prompt, options: args.options });
      return fakeQueryStream();
    }),
  };
});

// ─── Import SUT after mock is hoisted ────────────────────────────────────────

import { runPhaseStepSession } from './session-runner.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<GSDConfig> = {}): GSDConfig {
  return { ...CONFIG_DEFAULTS, ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runPhaseStepSession', () => {
  beforeEach(() => {
    mockQueryCalls.length = 0;
  });

  it('does not duplicate the prompt in both the user message and systemPrompt.append', async () => {
    const fullPrompt = 'You are a researcher. Investigate the topic thoroughly.\n\n## Context\nDetailed instructions here...';

    await runPhaseStepSession(fullPrompt, PhaseStepType.Research, makeConfig());

    expect(mockQueryCalls).toHaveLength(1);

    const call = mockQueryCalls[0];
    const appendValue = (call.options.systemPrompt as { append?: string })?.append;

    // The full prompt must appear in systemPrompt.append (that is its correct location).
    expect(appendValue).toBe(fullPrompt);

    // The user-visible prompt: must NOT be the full prompt — it should be a short directive.
    expect(call.prompt).not.toBe(fullPrompt);
    expect(call.prompt.length).toBeLessThan(fullPrompt.length);
  });

  it('passes the full prompt in systemPrompt.append', async () => {
    const fullPrompt = 'Complex multi-line\nprompt with $VARIABLES and $(command) patterns.';

    await runPhaseStepSession(fullPrompt, PhaseStepType.Execute, makeConfig());

    const call = mockQueryCalls[0];
    const appendValue = (call.options.systemPrompt as { append?: string })?.append;

    expect(appendValue).toBe(fullPrompt);
  });

  it('returns a successful PlanResult', async () => {
    const result = await runPhaseStepSession('Test prompt', PhaseStepType.Verify, makeConfig());

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('test-session');
  });

  // ─── #2832: runtime-aware model resolution ─────────────────────────────────
  // Issue: with `runtime: codex` and `model_profile: balanced`, resolveModel
  // mapped balanced -> 'claude-sonnet-4-6' and forced the Codex run through
  // a Claude model. For non-Claude runtimes the SDK must NOT inject a Claude
  // model id; it should leave model unset (or honor explicit overrides) and
  // let the runtime use its configured default.
  describe('resolveModel runtime awareness (#2832)', () => {
    it('does NOT pass a Claude profile model id when runtime is codex', async () => {
      await runPhaseStepSession(
        'prompt',
        PhaseStepType.Execute,
        makeConfig({ runtime: 'codex', model_profile: 'balanced' } as Partial<GSDConfig>),
      );
      const opts = mockQueryCalls[0].options as { model?: string };
      expect(opts.model).toBeUndefined();
    });

    it('does NOT pass a Claude profile model id when resolve_model_ids is "omit"', async () => {
      await runPhaseStepSession(
        'prompt',
        PhaseStepType.Execute,
        makeConfig({ resolve_model_ids: 'omit', model_profile: 'balanced' } as Partial<GSDConfig>),
      );
      const opts = mockQueryCalls[0].options as { model?: string };
      expect(opts.model).toBeUndefined();
    });

    it('still maps profile -> Claude id when runtime is claude (no regression)', async () => {
      await runPhaseStepSession(
        'prompt',
        PhaseStepType.Execute,
        makeConfig({ runtime: 'claude', model_profile: 'balanced' } as Partial<GSDConfig>),
      );
      const opts = mockQueryCalls[0].options as { model?: string };
      expect(opts.model).toBe('claude-sonnet-4-6');
    });

    it('respects FVGSD_RUNTIME env precedence over config (no Claude id when env=codex)', async () => {
      const prev = process.env.FVGSD_RUNTIME;
      process.env.FVGSD_RUNTIME = 'codex';
      try {
        await runPhaseStepSession(
          'prompt',
          PhaseStepType.Execute,
          makeConfig({ model_profile: 'balanced' } as Partial<GSDConfig>),
        );
        const opts = mockQueryCalls[0].options as { model?: string };
        expect(opts.model).toBeUndefined();
      } finally {
        if (prev === undefined) delete process.env.FVGSD_RUNTIME;
        else process.env.FVGSD_RUNTIME = prev;
      }
    });

    it('explicit options.model wins for any runtime', async () => {
      await runPhaseStepSession(
        'prompt',
        PhaseStepType.Execute,
        makeConfig({ runtime: 'codex' } as Partial<GSDConfig>),
        { model: 'gpt-5.3-codex' },
      );
      const opts = mockQueryCalls[0].options as { model?: string };
      expect(opts.model).toBe('gpt-5.3-codex');
    });
  });

  // Claude Code in print mode stops background agents after CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS
  // (600 s by default); a Build session runs slice builders in the background.
  describe('build session environment', () => {
    const CEILING = 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS';
    const PROBE = 'FVGSD_SESSION_ENV_PROBE';
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = { [CEILING]: process.env[CEILING], [PROBE]: process.env[PROBE] };
      delete process.env[CEILING];
      process.env[PROBE] = 'kept';
    });

    afterEach(() => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('waits for background agents in a Build session and keeps the rest of process.env', async () => {
      await runPhaseStepSession('prompt', PhaseStepType.Build, makeConfig());
      const env = mockQueryCalls[0].options.env as Record<string, string | undefined>;
      expect([env[CEILING], env[PROBE]]).toEqual(['0', 'kept']);
    });

    it('keeps a background wait the caller set', async () => {
      process.env[CEILING] = '900000';
      await runPhaseStepSession('prompt', PhaseStepType.Build, makeConfig());
      expect((mockQueryCalls[0].options.env as Record<string, string | undefined>)[CEILING]).toBe('900000');
    });

    it('leaves the environment of other step sessions to the SDK default', async () => {
      await runPhaseStepSession('prompt', PhaseStepType.Research, makeConfig());
      expect(mockQueryCalls[0].options.env).toBeUndefined();
    });
  });
});
