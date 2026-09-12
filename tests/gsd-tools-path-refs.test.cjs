/**
 * Regression guard for #1766: $FVGSD_TOOLS env var undefined
 *
 * All command files must use the resolved path to fvgsd-tools.cjs
 * ($HOME/.claude/fvgsd/bin/fvgsd-tools.cjs), not the undefined
 * $FVGSD_TOOLS variable. This test catches any command file that
 * references the undefined variable.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands', 'gsd');

describe('command files: fvgsd-tools path references (#1766)', () => {
  test('no command file references undefined $FVGSD_TOOLS variable', () => {
    const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md'));
    const violations = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf-8');
      // Match $FVGSD_TOOLS or "$FVGSD_TOOLS" or ${FVGSD_TOOLS} used as a path
      // (not as a documentation reference)
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\$FVGSD_TOOLS\b/.test(line) && /node\s/.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    assert.strictEqual(violations.length, 0,
      'Command files must not reference undefined $FVGSD_TOOLS. ' +
      'Use $HOME/.claude/fvgsd/bin/fvgsd-tools.cjs instead.\n' +
      'Violations:\n' + violations.join('\n'));
  });

  test('workstreams.md documents fvgsd-sdk query or legacy fvgsd-tools.cjs', () => {
    const content = fs.readFileSync(
      path.join(COMMANDS_DIR, 'workstreams.md'), 'utf-8'
    );

    assert.ok(
      /fvgsd-sdk\s+query/.test(content) || /fvgsd-tools\.cjs/.test(content),
      'workstreams.md should document fvgsd-sdk query or fvgsd-tools.cjs'
    );

    const lines = content.split('\n');
    for (const line of lines) {
      if (/node\s/.test(line)) {
        assert.ok(
          line.includes('fvgsd-tools.cjs'),
          'Each node invocation must reference fvgsd-tools.cjs, got: ' + line.trim()
        );
      }
    }
  });
});
