/**
 * Regression tests for bug #3584
 *
 * Runtime/user-facing strings emitted by get-shit-done/bin/lib/*.cjs hardcoded
 * the deprecated `/gsd:<cmd>` colon form (16 files, ~50 occurrences). After
 * #2808 unified GSD installs to register skills under the hyphen form
 * (`name: fvgsd-execute-phase`), pasting the emitted `/fvgsd:execute-phase` into
 * Claude Code yields `Unknown command: /fvgsd:execute-phase. Did you mean
 * /fvgsd-execute-phase?`. Codex installs require `$gsd-<cmd>` (shell-var) form.
 *
 * Fix: a runtime-aware slash formatter (`runtime-slash.cjs`) is now the single
 * source of truth for emitting `/gsd-<cmd>` (hyphen) for skills-based runtimes
 * and `$gsd-<cmd>` for Codex. Tests assert on the formatter's typed output and
 * — for the integration tests in `bug-3584-runtime-slash-emitters.test.cjs` —
 * on the structured `--json` payloads from the runtime command handlers.
 */

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { formatGsdSlash, resolveRuntime } = require(
  path.join(ROOT, 'get-shit-done', 'bin', 'lib', 'runtime-slash.cjs'),
);

describe('formatGsdSlash — runtime-aware slash command formatter', () => {
  describe('hyphen-form runtimes (claude, cursor, opencode, kilo, etc.)', () => {
    test('emits /gsd-<cmd> for claude', () => {
      assert.strictEqual(formatGsdSlash('execute-phase', 'claude'), '/fvgsd-execute-phase');
    });

    test('emits /gsd-<cmd> for cursor', () => {
      assert.strictEqual(formatGsdSlash('plan-phase', 'cursor'), '/fvgsd-plan-phase');
    });

    test('emits /gsd-<cmd> for opencode', () => {
      assert.strictEqual(formatGsdSlash('discuss-phase', 'opencode'), '/fvgsd-discuss-phase');
    });

    test('emits /gsd-<cmd> for kilo', () => {
      assert.strictEqual(formatGsdSlash('health', 'kilo'), '/fvgsd-health');
    });

    test('unknown runtime defaults to hyphen form', () => {
      assert.strictEqual(
        formatGsdSlash('new-project', 'some-future-runtime'),
        '/fvgsd-new-project',
      );
    });

    test('null/undefined runtime defaults to hyphen form (claude)', () => {
      assert.strictEqual(formatGsdSlash('new-milestone', null), '/fvgsd-new-milestone');
      assert.strictEqual(formatGsdSlash('new-milestone', undefined), '/fvgsd-new-milestone');
    });
  });

  describe('codex shell-var form', () => {
    test('emits $gsd-<cmd> for codex', () => {
      assert.strictEqual(formatGsdSlash('execute-phase', 'codex'), '$fvgsd-execute-phase');
    });

    test('codex output is lowercased', () => {
      assert.strictEqual(
        formatGsdSlash('Execute-Phase', 'codex'),
        '$fvgsd-execute-phase',
      );
    });
  });

  describe('input normalization', () => {
    test('strips existing /gsd: colon prefix', () => {
      assert.strictEqual(
        formatGsdSlash('/fvgsd:execute-phase', 'claude'),
        '/fvgsd-execute-phase',
      );
    });

    test('strips existing /gsd- hyphen prefix (idempotent)', () => {
      assert.strictEqual(
        formatGsdSlash('/fvgsd-plan-phase', 'claude'),
        '/fvgsd-plan-phase',
      );
    });

    test('strips bare gsd: prefix without leading slash', () => {
      assert.strictEqual(
        formatGsdSlash('fvgsd:new-project', 'claude'),
        '/fvgsd-new-project',
      );
    });

    test('strips existing $gsd- shell prefix (codex idempotent)', () => {
      assert.strictEqual(
        formatGsdSlash('$fvgsd-execute-phase', 'codex'),
        '$fvgsd-execute-phase',
      );
    });

    test('runtime swap: /fvgsd:execute-phase + codex → $fvgsd-execute-phase', () => {
      assert.strictEqual(
        formatGsdSlash('/fvgsd:execute-phase', 'codex'),
        '$fvgsd-execute-phase',
      );
    });

    test('case-insensitive prefix stripping', () => {
      assert.strictEqual(
        formatGsdSlash('GSD:execute-phase', 'claude'),
        '/fvgsd-execute-phase',
      );
    });
  });

  describe('defensive returns for unsafe inputs', () => {
    test('non-string commandName returns input unchanged', () => {
      assert.strictEqual(formatGsdSlash(null, 'claude'), null);
      assert.strictEqual(formatGsdSlash(undefined, 'claude'), undefined);
      assert.strictEqual(formatGsdSlash(42, 'claude'), 42);
    });

    test('empty string returns empty string', () => {
      assert.strictEqual(formatGsdSlash('', 'claude'), '');
    });

    test('whitespace-only string returns empty string (no spurious /gsd- emission)', () => {
      assert.strictEqual(formatGsdSlash('   ', 'claude'), '');
      assert.strictEqual(formatGsdSlash('\t\n', 'codex'), '');
    });

    test('degenerate prefix-only input returns empty (does NOT re-emit colon form)', () => {
      // Regression guard for the CodeRabbit finding on the original PR:
      // a previous fallback returned `commandName` unchanged when the bare
      // tail was empty, which re-introduced the deprecated `/gsd:` shape for
      // inputs like `/gsd:`, `gsd:`, or `fvgsd-`. The formatter must never
      // emit the colon form — return empty so callers detect "no command"
      // instead of receiving an unroutable string.
      assert.strictEqual(formatGsdSlash('/gsd:', 'claude'), '');
      assert.strictEqual(formatGsdSlash('gsd:', 'claude'), '');
      assert.strictEqual(formatGsdSlash('fvgsd-', 'claude'), '');
      assert.strictEqual(formatGsdSlash('/gsd-', 'codex'), '');
      assert.strictEqual(formatGsdSlash('$gsd-', 'codex'), '');
    });

    test('commands with arguments preserve the argument tail', () => {
      // `execute-phase 03` is a valid call shape — the formatter only
      // rewrites the command token; everything after the first whitespace
      // belongs to the caller.
      assert.strictEqual(
        formatGsdSlash('execute-phase 03', 'claude'),
        '/fvgsd-execute-phase 03',
      );
      assert.strictEqual(
        formatGsdSlash('/fvgsd:execute-phase 03', 'claude'),
        '/fvgsd-execute-phase 03',
      );
    });

    test('codex form lowercases only the command token, not the argument tail', () => {
      // Regression for codex review finding: a previous implementation
      // lowercased the full input including arguments, which would corrupt
      // Windows paths and case-sensitive flag values passed as args.
      assert.strictEqual(
        formatGsdSlash('Map-Codebase --paths C:\\Users\\Me\\Project', 'codex'),
        '$fvgsd-map-codebase --paths C:\\Users\\Me\\Project',
      );
      assert.strictEqual(
        formatGsdSlash('execute-phase 03 --Name FooBar', 'codex'),
        '$fvgsd-execute-phase 03 --Name FooBar',
      );
    });

    test('hyphen form preserves token case (it does not get lowercased)', () => {
      // Symmetry with codex: only codex lowercases the token. Hyphen-form
      // runtimes preserve whatever case the caller supplied for the token.
      assert.strictEqual(
        formatGsdSlash('Plan-Phase 03', 'claude'),
        '/fvgsd-Plan-Phase 03',
      );
    });
  });
});

describe('resolveRuntime — env > config > default', () => {
  test('process.env.FVGSD_RUNTIME wins over everything', () => {
    const saved = process.env.FVGSD_RUNTIME;
    try {
      process.env.FVGSD_RUNTIME = 'codex';
      assert.strictEqual(resolveRuntime(null), 'codex');
      assert.strictEqual(resolveRuntime('/nonexistent'), 'codex');
    } finally {
      if (saved === undefined) delete process.env.FVGSD_RUNTIME;
      else process.env.FVGSD_RUNTIME = saved;
    }
  });

  test('defaults to claude when env is unset and projectDir missing', () => {
    const saved = process.env.FVGSD_RUNTIME;
    try {
      delete process.env.FVGSD_RUNTIME;
      assert.strictEqual(resolveRuntime(null), 'claude');
      assert.strictEqual(resolveRuntime(undefined), 'claude');
    } finally {
      if (saved !== undefined) process.env.FVGSD_RUNTIME = saved;
    }
  });

  test('reads config.runtime when env is unset and projectDir has a config', (t) => {
    const fs = require('fs');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-3584-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

    fs.mkdirSync(path.join(tmp, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.planning', 'config.json'),
      JSON.stringify({ runtime: 'codex' }),
    );

    const saved = process.env.FVGSD_RUNTIME;
    try {
      delete process.env.FVGSD_RUNTIME;
      assert.strictEqual(resolveRuntime(tmp), 'codex');
    } finally {
      if (saved !== undefined) process.env.FVGSD_RUNTIME = saved;
    }
  });

  test('lowercases the resolved runtime', () => {
    const saved = process.env.FVGSD_RUNTIME;
    try {
      process.env.FVGSD_RUNTIME = 'CLAUDE';
      assert.strictEqual(resolveRuntime(null), 'claude');
    } finally {
      if (saved === undefined) delete process.env.FVGSD_RUNTIME;
      else process.env.FVGSD_RUNTIME = saved;
    }
  });
});
