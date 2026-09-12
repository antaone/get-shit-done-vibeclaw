'use strict';

process.env.FVGSD_TEST_MODE = '1';

/**
 * Bug #2643 / #2808: skill frontmatter name parity.
 *
 * Original (#2643): workflows emitted Skill(skill="gsd:<cmd>") and the
 * installer registered colon form in SKILL.md name: to match.
 *
 * Updated for VibeClaw: workflows use Skill(skill="fvgsd-<cmd>") (hyphen),
 * and the installer emits name: fvgsd-<cmd> (hyphen). Claude Code autocomplete
 * now shows the canonical hyphen form instead of the deprecated colon form.
 * Legacy gsd input remains accepted for upgrades.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  convertClaudeCommandToClaudeSkill,
  skillFrontmatterName,
} = require(path.join(ROOT, 'bin', 'install.js'));

const WORKFLOWS_DIR = path.join(ROOT, 'get-shit-done', 'workflows');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'gsd');

function collectFiles(dir, results) {
  if (!results) results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(full, results);
    else if (e.name.endsWith('.md')) results.push(full);
  }
  return results;
}

/**
 * Extract every `Skill(skill="<name>")` invocation as a structured record.
 *
 * Per project test rigor (`feedback_no_source_grep_tests.md`), this parses
 * each call as a unit instead of leaning on a single regex over raw bytes.
 * The flow is:
 *
 *   1. Strip HTML comments so commented-out examples don't count as drift.
 *   2. Walk the content for `Skill(` openers; for each, find the matching
 *      `)` closer (Skill bodies are simple kwarg lists, no nesting).
 *   3. Parse the call body for the `skill = "..."` keyword argument.
 *      Permissive whitespace around the keyword and `=`, permissive
 *      single/double quoting (with optional `\` escapes from string-
 *      embedded examples), permissive name body — so malformed drift like
 *      `Skill(skill="gsd:extract_learnings")` is surfaced rather than
 *      silently skipped by an over-strict character class.
 *
 * Returns `[{ name, raw }]` per call. Filtering by namespace happens at the
 * happens at the call site so the extractor stays neutral.
 */
function extractSkillCalls(content) {
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  const calls = [];
  // Body class excludes backslash so the extractor doesn't include an
  // escape character that precedes the closing quote in embedded examples
  // (e.g. `Skill(skill=\"fvgsd-plan-phase\", …)` written inside a string
  // context). A trailing `\` is permitted on the closing-quote side via the
  // optional `\\?` so both `\"` and `"` close the value cleanly.
  const argRe = /^\s*skill\s*=\s*\\?(['"])([^'"\\]+)\\?\1/i;
  let i = 0;
  while (i < stripped.length) {
    const open = stripped.indexOf('Skill(', i);
    if (open === -1) break;
    const close = stripped.indexOf(')', open);
    if (close === -1) break;
    const body = stripped.slice(open + 'Skill('.length, close);
    const match = body.match(argRe);
    if (match) calls.push({ name: match[2], raw: stripped.slice(open, close + 1) });
    i = close + 1;
  }
  return calls;
}

function extractSkillNamesHyphen(content) {
  return new Set(
    extractSkillCalls(content)
      .map((c) => c.name)
      .filter((n) => n.startsWith('fvgsd-')),
  );
}

function extractSkillNamesColon(content) {
  return new Set(
    extractSkillCalls(content)
      .map((c) => c.name)
      .filter((n) => /^(?:fvgsd|gsd):/.test(n)),
  );
}

describe('skill frontmatter name parity (#2643 / #2808)', () => {
  test('skillFrontmatterName helper emits hyphen form (#2808)', () => {
    assert.strictEqual(typeof skillFrontmatterName, 'function');
    assert.strictEqual(skillFrontmatterName('fvgsd-execute-phase'), 'fvgsd-execute-phase');
    assert.strictEqual(skillFrontmatterName('fvgsd-plan-phase'), 'fvgsd-plan-phase');
    assert.strictEqual(skillFrontmatterName('fvgsd-next'), 'fvgsd-next');
  });

  test('convertClaudeCommandToClaudeSkill emits name: fvgsd-<cmd> (hyphen)', () => {
    const input = '---\nname: old\ndescription: test\n---\n\nBody.';
    const result = convertClaudeCommandToClaudeSkill(input, 'fvgsd-execute-phase');
    // Parse the frontmatter block structurally: extract the name: field value.
    const frontmatterMatch = result.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatterMatch, 'output must have a frontmatter block delimited by ---');
    const frontmatterLines = frontmatterMatch[1].split('\n');
    const nameEntry = frontmatterLines.find((l) => l.startsWith('name:'));
    assert.ok(nameEntry, 'frontmatter must contain a name: field');
    const nameValue = nameEntry.replace(/^name:\s*/, '').trim();
    assert.strictEqual(
      nameValue,
      'fvgsd-execute-phase',
      `frontmatter name: must be 'fvgsd-execute-phase' (hyphen form), got '${nameValue}'`
    );
  });

  test('no workflow uses colon-form Skill(skill="<namespace>:<cmd>") calls', () => {
    const workflowFiles = collectFiles(WORKFLOWS_DIR);
    const colonRefs = [];
    for (const f of workflowFiles) {
      const src = fs.readFileSync(f, 'utf-8');
      for (const n of extractSkillNamesColon(src)) {
        colonRefs.push(path.basename(f) + ': ' + n);
      }
    }
    assert.deepStrictEqual(
      colonRefs,
      [],
      'deprecated colon-form Skill() calls found (update to hyphen): ' + colonRefs.join(', ')
    );
  });

  test('every workflow Skill(skill="fvgsd-<cmd>") resolves to an emitted skill name', () => {
    const workflowFiles = collectFiles(WORKFLOWS_DIR);
    const referenced = new Set();
    for (const f of workflowFiles) {
      const src = fs.readFileSync(f, 'utf-8');
      for (const n of extractSkillNamesHyphen(src)) referenced.add(n);
    }
    assert.ok(
      referenced.size > 0,
      `expected at least one Skill(skill="fvgsd-<cmd>") reference in workflows under ${WORKFLOWS_DIR}`
    );

    const emitted = new Set();
    const cmdFiles = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md'));
    for (const cmd of cmdFiles) {
      const base = cmd.replace(/\.md$/, '');
      const skillDirName = 'fvgsd-' + base;
      const src = fs.readFileSync(path.join(COMMANDS_DIR, cmd), 'utf-8');
      const out = convertClaudeCommandToClaudeSkill(src, skillDirName);
      const m = out.match(/^---\nname:\s*(.+)$/m);
      if (m) emitted.add(m[1].trim());
    }

    const missing = [];
    for (const r of referenced) if (!emitted.has(r)) missing.push(r);
    assert.deepStrictEqual(
      missing,
      [],
      'workflow refs not emitted as skill names: ' + missing.join(', '),
    );
  });
});
