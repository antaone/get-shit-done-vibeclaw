'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { buildRules, rewriteText, planRenames } = require('../scripts/rename-identity.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'rename-identity.cjs');

const FIXTURE = {
  'agents/gsd-planner.md': 'name: gsd-planner\nRun /vgsd-plan-phase.\n',
  'hooks/gsd-context-monitor.js': "// gsd-hook-version: {{GSD_VERSION}}\nconst hook = 'gsd-context-monitor';\n",
  'hooks/lib/gsd-graphify-rebuild.sh': 'echo rebuild\n',
  'get-shit-done/bin/gsd-tools.cjs': "module.exports = 'gsd-';\n",
  'commands/gsd/help.md': 'name: vgsd:help\nnode "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" --runtime __VGSD_RUNTIME__\n',
  '.gitignore': '/.vibe/\n',
  'CHANGELOG.md': 'vgsd gsd-planner\n',
  'tests/vgsd-sample.test.cjs': "process.env.GSD_TEST_MODE = '1';\n",
};

const EXPECTED_TOTALS = {
  'fork-prefix': 3,
  'install-path': 1,
  'agent-names': 1,
  'hook-names': 1,
  bins: 1,
  'vibe-paths': 1,
  'env-vars': 2,
  'code-literals': 1,
};

const EXPECTED_RENAMES = [
  { from: 'agents/gsd-planner.md', to: 'agents/fvgsd-planner.md' },
  { from: 'get-shit-done/bin/gsd-tools.cjs', to: 'get-shit-done/bin/fvgsd-tools.cjs' },
  { from: 'hooks/gsd-context-monitor.js', to: 'hooks/fvgsd/context-monitor.js' },
  { from: 'hooks/lib/gsd-graphify-rebuild.sh', to: 'hooks/fvgsd/lib/graphify-rebuild.sh' },
  { from: 'tests/vgsd-sample.test.cjs', to: 'tests/fvgsd-sample.test.cjs' },
];

function makeRepo(t) {
  const root = createTempDir('fvgsd-rename-');
  t.after(() => cleanup(root));
  for (const [rel, content] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'fixture');
  return root;
}

function runScript(root, extra = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--json', ...extra], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('rewriteText reports each replacement by rule', () => {
  const rules = buildRules({ agentRoles: ['gsd-planner'], hookNames: ['gsd-statusline'], helperNames: [] });
  const { replacements } = rewriteText(
    'Use /vgsd-help with gsd-planner and ~/.claude/hooks/gsd-statusline.js; GSD_HOME is read.',
    rules,
    { isCode: false },
  );
  assert.deepEqual(replacements.map((r) => [r.ruleId, r.match, r.replacement]), [
    ['fork-prefix', 'vgsd', 'fvgsd'],
    ['agent-names', 'gsd-planner', 'fvgsd-planner'],
    ['hook-names', 'gsd-statusline', 'fvgsd/statusline'],
    ['env-vars', 'GSD_HOME', 'FVGSD_HOME'],
  ]);
});

test('rewriteText is idempotent', () => {
  const rules = buildRules({
    agentRoles: ['gsd-planner'],
    hookNames: ['gsd-statusline'],
    helperNames: ['gsd-graphify-rebuild'],
  });
  const source = "const a = 'gsd-'; // /vgsd-x ~/.codex/get-shit-done/ .planning-vibe .vibe/worktrees " +
    'GSD:profile-start gsd-sdk gsd-planner hooks/lib/gsd-graphify-rebuild.sh hooks/gsd-statusline.js';
  const once = rewriteText(source, rules, { isCode: true });
  const twice = rewriteText(once.text, rules, { isCode: true });
  assert.equal(once.replacements.length > 0, true);
  assert.deepEqual(twice.replacements, []);
});

test('rewriteText keeps the upstream gsd-build slug in quoted code literals', () => {
  const rules = buildRules({ agentRoles: [], hookNames: [], helperNames: [] });
  const source = "const repoSlug = 'gsd-build/get-shit-done';\n" +
    'const upstream = "gsd-build/get-shit-done";\n' +
    "const prefix = 'gsd-';\n";
  const { text, replacements } = rewriteText(source, rules, { isCode: true });
  assert.deepEqual(replacements.map((r) => [r.ruleId, r.match, r.replacement]), [
    ['code-literals', "'gsd-", "'fvgsd-"],
  ]);
  assert.equal(text, "const repoSlug = 'gsd-build/get-shit-done';\n" +
    'const upstream = "gsd-build/get-shit-done";\n' +
    "const prefix = 'fvgsd-';\n");
});

test('rewriteText renames .vibe paths but leaves vibe branch ranges alone', () => {
  const rules = buildRules({ agentRoles: [], hookNames: [], helperNames: [] });
  const source = 'git diff vibe/project-001/project/gemini-001..vibe/project-001/project/codex-002\n' +
    "/.vibe/\nSee `.vibe/worktrees`.\nconst dir = '.vibe';\n";
  for (const isCode of [false, true]) {
    const { text, replacements } = rewriteText(source, rules, { isCode });
    assert.deepEqual(replacements.map((r) => [r.ruleId, r.match, r.replacement]), [
      ['vibe-paths', '.vibe', '.fvgsd-vibe'],
      ['vibe-paths', '.vibe', '.fvgsd-vibe'],
      ['vibe-paths', '.vibe', '.fvgsd-vibe'],
    ]);
    assert.equal(text, 'git diff vibe/project-001/project/gemini-001..vibe/project-001/project/codex-002\n' +
      "/.fvgsd-vibe/\nSee `.fvgsd-vibe/worktrees`.\nconst dir = '.fvgsd-vibe';\n");
  }
});

test('rewriteText renames \bgsd- regex prefixes in code only', () => {
  const rules = buildRules({ agentRoles: [], hookNames: [], helperNames: [] });
  const source = String.raw`const matches = content.match(/\bgsd-[a-z][a-z-]*/g);` + '\n';
  const code = rewriteText(source, rules, { isCode: true });
  assert.deepEqual(code.replacements.map((r) => [r.ruleId, r.match, r.replacement]), [
    ['code-literals', String.raw`\bgsd-`, String.raw`\bfvgsd-`],
  ]);
  assert.equal(code.text, String.raw`const matches = content.match(/\bfvgsd-[a-z][a-z-]*/g);` + '\n');
  assert.deepEqual(rewriteText(code.text, rules, { isCode: true }).replacements, []);
  assert.deepEqual(rewriteText(source, rules, { isCode: false }).replacements, []);
});

test('planRenames maps the SDK tools module', () => {
  assert.deepEqual(planRenames(['sdk/src/gsd-tools.ts']), [
    { from: 'sdk/src/gsd-tools.ts', to: 'sdk/src/fvgsd-tools.ts' },
  ]);
});

test('rewriteText renames gsd-* prefix globs and nests hook globs under fvgsd/', () => {
  const rules = buildRules({ agentRoles: [], hookNames: [], helperNames: [] });
  const source = 'ls skills/gsd-*/\nrm hooks/gsd-*.js\nls hooks/dist/gsd-*\n';
  for (const isCode of [false, true]) {
    const once = rewriteText(source, rules, { isCode });
    assert.deepEqual(once.replacements.map((r) => [r.ruleId, r.match, r.replacement]), [
      ['prefix-globs', 'hooks/gsd-*', 'hooks/fvgsd/*'],
      ['prefix-globs', 'hooks/dist/gsd-*', 'hooks/dist/fvgsd/*'],
      ['prefix-globs', 'gsd-*', 'fvgsd-*'],
    ]);
    assert.equal(once.text, 'ls skills/fvgsd-*/\nrm hooks/fvgsd/*.js\nls hooks/dist/fvgsd/*\n');
    assert.deepEqual(rewriteText(once.text, rules, { isCode }).replacements, []);
  }
});

test('dry run reports totals and renames without writing', (t) => {
  const root = makeRepo(t);
  const before = Object.fromEntries(Object.keys(FIXTURE).map((rel) => [rel, hash(path.join(root, rel))]));
  const report = runScript(root, ['--dry-run']);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.totals, EXPECTED_TOTALS);
  assert.deepEqual(report.renames, EXPECTED_RENAMES);
  for (const [rel, digest] of Object.entries(before)) {
    assert.equal(hash(path.join(root, rel)), digest, rel);
  }
});

test('apply renames files, leaves exclusions alone, and a second run changes nothing', (t) => {
  const root = makeRepo(t);
  const changelog = hash(path.join(root, 'CHANGELOG.md'));
  const applied = runScript(root);
  assert.deepEqual(applied.totals, EXPECTED_TOTALS);
  for (const { from, to } of EXPECTED_RENAMES) {
    assert.equal(fs.existsSync(path.join(root, from)), false, from);
    assert.equal(fs.statSync(path.join(root, to)).isFile(), true, to);
  }
  assert.equal(hash(path.join(root, 'CHANGELOG.md')), changelog);
  execFileSync('git', ['add', '-A'], { cwd: root });
  const again = runScript(root);
  assert.deepEqual(again.totals, {});
  assert.deepEqual(again.renames, []);
});
