# fvgsd Identity and Side-by-Side Installs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repository install as `fvgsd` next to upstream GSD and vgsd in every runtime, without modifying or deleting their files.

**Architecture:**
- A frozen identity module is the single source of names for code.
- A re-runnable rename script rewrites prompt, doc and test text and renames files.
- The installer, the Codex `config.toml` handling and the installer migrations only touch fvgsd-owned names.
- The update-check hooks stay installed but never contact npm, and `/fvgsd-update` pulls the local clone.

**Tech Stack:** Node.js ≥ 22 (CommonJS), `node:test` + `node:assert/strict` at the root, TypeScript + Vitest in `sdk/`, git.

**Spec:** `docs/superpowers/specs/2026-09-12-fvgsd-identity-design.md` (read it before starting; this plan argues from it).

## Global Constraints

- Node.js ≥ 22. Root code is CommonJS, strict mode, two-space indentation, semicolons, `node:` imports for built-ins. SDK code is strict TypeScript (ESM/NodeNext).
- Root tests use `node:test` and `node:assert/strict`, with helpers from `tests/helpers.cjs`. Name them `*.test.cjs`; tests that spawn the installer end in `.install.test.cjs`.
- No source-grep tests, and no raw text matching on output (CONTRIBUTING.md, "Prohibited: Source-Grep Tests" and "Prohibited: Raw Text Matching on Test Outputs"). Assert on typed values, parsed JSON, filesystem facts or hashes.
- At most 2 test files per production module (`scripts/lint-test-file-count.cjs`).
- fvgsd never deletes or rewrites a file, `settings.json` entry, `config.toml` section, `hooks.json` hook or permission key that isn't fvgsd's.
- `.planning/` is shared and never renamed.
- `CHANGELOG.md`, `docs/RELEASE-*.md`, `.changeset/**` and `docs/superpowers/specs/**` are never rewritten by the rename.
- Names are exactly those in the spec's Names table (for example `fvgsd`, `fvgsd-<role>`, `hooks/fvgsd/<hook>.js`, `fvgsd-file-manifest.json`).
- Every task ends with its tests passing and one commit. Use Conventional Commit subjects and end each message with the session attribution trailers:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Y2xNugfFgRuj9q6Sq7cM9w
  ```
- Work on a branch, not `main`: `git switch -c feat/fvgsd-identity` from `docs/fvgsd-specs` before Task 1.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `get-shit-done/bin/lib/identity.cjs` (new) | Frozen fvgsd names | 1 |
| `scripts/gen-identity-ts.cjs` (new), `sdk/src/identity.ts` (generated) | SDK copy of the identity plus freshness check | 2 |
| `scripts/rename-identity.cjs`, `scripts/identity-rename.map.json` (new) | Rule-driven text rewrite and file renames | 3 |
| `tests/fvgsd-coexistence.install.test.cjs`, `tests/helpers/foreign-installs.cjs`, `tests/fixtures/foreign-installer-matchers.json` (new) | Coexistence proof against fake GSD and vgsd installs | 4 |
| Whole repository (script output), `scripts/build-hooks.js`, `bin/install.js` (hook copy), `hooks/fvgsd/check-update-worker.js` | Apply the rename and the `hooks/fvgsd/` layout | 5 |
| `bin/install.js`, `get-shit-done/bin/lib/*.cjs`, `bin/vibe.js`, `sdk/src/query/*.ts` | Read names from the identity module | 6 |
| `bin/install.js`, `get-shit-done/bin/lib/shell-command-projection.cjs` | Installer ownership and managed-hook matching | 7 |
| `bin/install.js` (Codex functions) | Codex `config.toml` placement, own-only removal, `codex_hooks` retention | 8 |
| `get-shit-done/bin/lib/installer-migrations/000-first-time-baseline.cjs`, `installer-migration-report.cjs` | Migrations only consider fvgsd surfaces | 9 |
| `hooks/fvgsd/check-update-worker.js`, `get-shit-done/bin/check-latest-version.cjs`, `get-shit-done/workflows/update.md`, `bin/install.js` | Disabled update check, `.fvgsd-source`, clone-based update | 10 |
| `package.json`, `sdk/package.json`, `.github/workflows/release.yml`, `README.md`, `.changeset/`, hook message text | Metadata, docs, final suites | 11 |
| — | Manual acceptance on this machine (requires the maintainer's approval) | 12 |

---

### Task 1: Identity module

**Files:**
- Create: `get-shit-done/bin/lib/identity.cjs`
- Test: `tests/identity.test.cjs`

**Interfaces:**
- Produces: `require('get-shit-done/bin/lib/identity.cjs')` returns a frozen object with exactly the keys asserted below. Every later task reads names from it.

- [ ] **Step 1: Write the failing test**

Create `tests/identity.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');

test('identity names every fvgsd surface', () => {
  assert.deepEqual({ ...IDENTITY, bins: { ...IDENTITY.bins } }, {
    name: 'fvgsd',
    commandPrefix: 'fvgsd',
    installDir: 'fvgsd',
    agentPrefix: 'fvgsd-',
    hooksDir: 'fvgsd',
    toolsScript: 'fvgsd-tools.cjs',
    bins: { installer: 'fvgsd', sdk: 'fvgsd-sdk', tools: 'fvgsd-tools', vibe: 'fvgsd-vibe' },
    packageName: 'fvgsd',
    sdkPackageName: '@fvgsd/sdk',
    manifestFile: 'fvgsd-file-manifest.json',
    patchesDir: 'fvgsd-local-patches',
    profileFile: '.fvgsd-profile',
    sourceFile: '.fvgsd-source',
    surfaceFile: '.fvgsd-surface.json',
    pristineDir: 'fvgsd-pristine',
    installStateFile: 'fvgsd-install-state.json',
    migrationLockFile: 'fvgsd-install-migration.lock',
    migrationJournalDir: 'fvgsd-migration-journal',
    updateCacheDir: 'fvgsd',
    updateCacheFile: 'update-check.json',
    codexMarker: '# FVGSD Agent Configuration — managed by fvgsd installer',
    codexHooksOwnershipPrefix: '# FVGSD codex_hooks ownership: ',
    tempPrefix: 'fvgsd-',
    branchPrefix: 'fvgsd/',
    executionsDir: 'fvgsd/executions',
    runtimePlaceholder: '__FVGSD_RUNTIME__',
    vibeStateDir: '.planning-fvgsd-vibe',
    vibeWorktreeRoot: '.fvgsd-vibe/worktrees',
    claudeMdMarker: 'FVGSD',
    envPrefix: 'FVGSD_',
  });
});

test('identity and its bins map are frozen', () => {
  assert.equal(Object.isFrozen(IDENTITY), true);
  assert.equal(Object.isFrozen(IDENTITY.bins), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/identity.test.cjs`
Expected: FAIL with `Cannot find module '../get-shit-done/bin/lib/identity.cjs'`.

- [ ] **Step 3: Write the module**

Create `get-shit-done/bin/lib/identity.cjs`:

```js
'use strict';

/**
 * identity.cjs — the single source of fvgsd's installed and user-visible names.
 *
 * fvgsd installs next to upstream GSD and vgsd. Every name here is chosen so
 * those installers never mistake an fvgsd file, hook, section or key for their
 * own (see docs/superpowers/specs/2026-09-12-fvgsd-identity-design.md, "Name safety").
 * Code must read names from this module instead of repeating literals.
 */

module.exports = Object.freeze({
  name: 'fvgsd',
  commandPrefix: 'fvgsd',
  installDir: 'fvgsd',
  agentPrefix: 'fvgsd-',
  hooksDir: 'fvgsd',
  toolsScript: 'fvgsd-tools.cjs',
  bins: Object.freeze({ installer: 'fvgsd', sdk: 'fvgsd-sdk', tools: 'fvgsd-tools', vibe: 'fvgsd-vibe' }),
  packageName: 'fvgsd',
  sdkPackageName: '@fvgsd/sdk',
  manifestFile: 'fvgsd-file-manifest.json',
  patchesDir: 'fvgsd-local-patches',
  profileFile: '.fvgsd-profile',
  sourceFile: '.fvgsd-source',
  surfaceFile: '.fvgsd-surface.json',
  pristineDir: 'fvgsd-pristine',
  installStateFile: 'fvgsd-install-state.json',
  migrationLockFile: 'fvgsd-install-migration.lock',
  migrationJournalDir: 'fvgsd-migration-journal',
  updateCacheDir: 'fvgsd',
  updateCacheFile: 'update-check.json',
  codexMarker: '# FVGSD Agent Configuration — managed by fvgsd installer',
  codexHooksOwnershipPrefix: '# FVGSD codex_hooks ownership: ',
  tempPrefix: 'fvgsd-',
  branchPrefix: 'fvgsd/',
  executionsDir: 'fvgsd/executions',
  runtimePlaceholder: '__FVGSD_RUNTIME__',
  vibeStateDir: '.planning-fvgsd-vibe',
  vibeWorktreeRoot: '.fvgsd-vibe/worktrees',
  claudeMdMarker: 'FVGSD',
  envPrefix: 'FVGSD_',
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/identity.test.cjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add get-shit-done/bin/lib/identity.cjs tests/identity.test.cjs
git commit -m "feat: add fvgsd identity module"
```

---

### Task 2: SDK identity copy and freshness check

**Files:**
- Create: `scripts/gen-identity-ts.cjs`, `sdk/src/identity.ts` (generated), `tests/gen-identity-ts.test.cjs`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `get-shit-done/bin/lib/identity.cjs` (Task 1).
- Produces: `sdk/src/identity.ts` exporting `IDENTITY` (same values, `as const`). CLI `node scripts/gen-identity-ts.cjs [--out <path>] [--check] [--json]`. With `--json` it prints `{ "ok": boolean, "fresh": boolean, "path": string }`; `--check` exits 0 when fresh and 1 when stale. Exported pure function `buildIdentityTs(identity) → string`.

- [ ] **Step 1: Write the failing test**

Create `tests/gen-identity-ts.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'gen-identity-ts.cjs');

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--json'], { encoding: 'utf8' });
  return { status: r.status, report: JSON.parse(r.stdout) };
}

test('generates a fresh identity.ts and detects drift', (t) => {
  const dir = createTempDir('fvgsd-identity-ts-');
  t.after(() => cleanup(dir));
  const out = path.join(dir, 'identity.ts');

  const generated = run(['--out', out]);
  assert.equal(generated.status, 0);
  assert.deepEqual(generated.report, { ok: true, fresh: true, path: out });

  const fresh = run(['--check', '--out', out]);
  assert.equal(fresh.status, 0);
  assert.equal(fresh.report.fresh, true);

  fs.writeFileSync(out, 'export const IDENTITY = {} as const;\n');
  const stale = run(['--check', '--out', out]);
  assert.equal(stale.status, 1);
  assert.deepEqual(stale.report, { ok: false, fresh: false, path: out });
});

test('the committed sdk/src/identity.ts is fresh', () => {
  const r = run(['--check']);
  assert.equal(r.status, 0);
  assert.equal(r.report.fresh, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/gen-identity-ts.test.cjs`
Expected: FAIL (the spawned script does not exist, so `JSON.parse` throws on empty stdout).

- [ ] **Step 3: Write the generator**

Create `scripts/gen-identity-ts.cjs`:

```js
#!/usr/bin/env node
'use strict';

/**
 * Generates sdk/src/identity.ts from get-shit-done/bin/lib/identity.cjs so the
 * SDK and the CommonJS code share one set of fvgsd names.
 *
 *   node scripts/gen-identity-ts.cjs            # write sdk/src/identity.ts
 *   node scripts/gen-identity-ts.cjs --check    # exit 1 when the file is stale
 *   --out <path>  write/check another path (tests)
 *   --json        print { ok, fresh, path }
 */

const fs = require('node:fs');
const path = require('node:path');

const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');

const DEFAULT_OUT = path.join(__dirname, '..', 'sdk', 'src', 'identity.ts');
const HEADER = '// Generated by scripts/gen-identity-ts.cjs from get-shit-done/bin/lib/identity.cjs. Do not edit.\n';

function buildIdentityTs(identity) {
  return `${HEADER}export const IDENTITY = ${JSON.stringify(identity, null, 2)} as const;\n`;
}

function main(argv) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? DEFAULT_OUT : path.resolve(argv[outIndex + 1]);
  const check = argv.includes('--check');
  const json = argv.includes('--json');
  const expected = buildIdentityTs(IDENTITY);

  let fresh;
  if (check) {
    fresh = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === expected;
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, expected);
    fresh = true;
  }

  const report = { ok: fresh, fresh, path: out };
  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else if (!fresh) {
    process.stderr.write(`${out} is stale. Run: node scripts/gen-identity-ts.cjs\n`);
  }
  return fresh ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { buildIdentityTs };
```

- [ ] **Step 4: Generate the SDK file and wire the scripts**

Run: `node scripts/gen-identity-ts.cjs`
Expected: `sdk/src/identity.ts` is created.

In `package.json` `scripts`, add these two entries after `"check:execution-branch-guards"`:

```json
"gen:identity-ts": "node scripts/gen-identity-ts.cjs",
"check:identity-fresh": "node scripts/gen-identity-ts.cjs --check",
```

Then change `pretest` from
`"npm run build:sdk && npm run lint:skill-deps && npm run check:execution-branch-guards"`
to
`"npm run build:sdk && npm run lint:skill-deps && npm run check:execution-branch-guards && npm run check:identity-fresh"`.

- [ ] **Step 5: Run the tests and the SDK type-check**

Run: `node --test tests/gen-identity-ts.test.cjs && npm run check:identity-fresh && (cd sdk && npx tsc --noEmit)`
Expected: 2 tests PASS; the check exits 0; `tsc` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-identity-ts.cjs sdk/src/identity.ts tests/gen-identity-ts.test.cjs package.json
git commit -m "feat: generate SDK identity copy with freshness check"
```

---

### Task 3: Rename script

**Files:**
- Create: `scripts/rename-identity.cjs`, `scripts/identity-rename.map.json`
- Test: `tests/rename-identity-script.test.cjs`

**Interfaces:**
- Produces:
  - `buildRules({ agentRoles: string[], hookNames: string[], helperNames: string[] }) → Rule[]`
  - `rewriteText(text, rules, { isCode: boolean }) → { text, replacements: [{ ruleId, match, replacement }] }`
  - `planRenames(relPaths: string[]) → [{ from, to }]`, sorted by `from`
  - `run({ root, dryRun }) → { dryRun, totals: { [ruleId]: number }, files: [{ path, counts }], renames }`
  - CLI `node scripts/rename-identity.cjs [--root <dir>] [--dry-run] [--json]`
- Rule ids, in application order: `fork-prefix`, `install-path`, `agent-names`, `hook-names`, `bins`, `bookkeeping`, `vibe-paths`, `profile-markers`, `env-vars`, `code-literals`.

Rule notes (these extend the spec's rules 1–9 as agreed during planning):
- `hook-names` also covers the lib helper (`gsd-graphify-rebuild` → `graphify-rebuild`) and `hooks/lib/` → `hooks/fvgsd/lib/`.
- `code-literals` applies only to `.js`, `.cjs`, `.mjs` and `.ts` files. It turns string literals starting with `gsd-`, the regex source `^gsd-` and `agents.gsd-` into their `fvgsd-` forms, so prefix checks in code stop matching other installs' files.
- The script, its map, its test, the identity module and its SDK copy, and the Task 4 coexistence files are excluded, because they intentionally contain gsd/vgsd names.

- [ ] **Step 1: Write the failing test**

Create `tests/rename-identity-script.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { buildRules, rewriteText } = require('../scripts/rename-identity.cjs');

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/rename-identity-script.test.cjs`
Expected: FAIL with `Cannot find module '../scripts/rename-identity.cjs'`.

- [ ] **Step 3: Write the rule map**

Create `scripts/identity-rename.map.json`:

```json
{
  "exclude": [
    "CHANGELOG.md",
    "docs/RELEASE-*.md",
    ".changeset/**",
    "docs/superpowers/specs/**",
    "docs/superpowers/plans/**",
    "node_modules/**",
    "sdk/node_modules/**",
    "sdk/dist/**",
    "hooks/dist/**",
    "scripts/rename-identity.cjs",
    "scripts/identity-rename.map.json",
    "tests/rename-identity-script.test.cjs",
    "get-shit-done/bin/lib/identity.cjs",
    "sdk/src/identity.ts",
    "tests/identity.test.cjs",
    "tests/fvgsd-coexistence.install.test.cjs",
    "tests/helpers/foreign-installs.cjs",
    "tests/fixtures/foreign-installer-matchers.json"
  ],
  "codeExtensions": [".js", ".cjs", ".mjs", ".ts"]
}
```

- [ ] **Step 4: Write the script**

Create `scripts/rename-identity.cjs`:

```js
#!/usr/bin/env node
'use strict';

/**
 * rename-identity.cjs — rewrite vgsd/GSD names to fvgsd across tracked files and
 * rename files (docs/superpowers/specs/2026-09-12-fvgsd-identity-design.md).
 *
 *   node scripts/rename-identity.cjs --dry-run --json   # report only
 *   node scripts/rename-identity.cjs --json             # apply
 *   --root <dir>                                         # another git repository (tests)
 *
 * Every rule skips text that is already renamed, so re-running is safe.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAP = require('./identity-rename.map.json');

const TOKEN_BEFORE = '(?<![A-Za-z0-9_-])';
const TOKEN_AFTER = '(?![A-Za-z0-9_-])';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenRule(id, from, to) {
  return { id, pattern: new RegExp(`${TOKEN_BEFORE}${escapeRegExp(from)}${TOKEN_AFTER}`, 'g'), replace: () => to };
}

function byLengthDesc(a, b) {
  return b.length - a.length || a.localeCompare(b);
}

function buildRules({ agentRoles, hookNames, helperNames }) {
  const rules = [
    { id: 'fork-prefix', pattern: /(?<![fF])vgsd/g, replace: () => 'fvgsd' },
    { id: 'fork-prefix', pattern: /(?<![fF])VGSD/g, replace: () => 'FVGSD' },
    {
      id: 'install-path',
      pattern: /((?:~|\$HOME|\$\{HOME\})\/\.(?:claude|codex|gemini|config\/opencode))\/get-shit-done\//g,
      replace: (match, base) => `${base}/fvgsd/`,
    },
  ];
  for (const role of [...agentRoles].sort(byLengthDesc)) {
    rules.push(tokenRule('agent-names', role, `f${role}`));
  }
  for (const hook of [...hookNames].sort(byLengthDesc)) {
    rules.push(tokenRule('hook-names', hook, `fvgsd/${hook.slice('gsd-'.length)}`));
  }
  for (const helper of [...helperNames].sort(byLengthDesc)) {
    rules.push(tokenRule('hook-names', helper, helper.slice('gsd-'.length)));
  }
  rules.push({ id: 'hook-names', pattern: /hooks\/lib\//g, replace: () => 'hooks/fvgsd/lib/' });
  rules.push({ id: 'bins', pattern: /@gsd-build\/sdk/g, replace: () => '@fvgsd/sdk' });
  for (const [from, to] of [['get-shit-done-cc', 'fvgsd'], ['gsd-tools', 'fvgsd-tools'], ['gsd-sdk', 'fvgsd-sdk']]) {
    rules.push(tokenRule('bins', from, to));
  }
  for (const name of [
    'gsd-file-manifest.json', 'gsd-local-patches', 'gsd-pristine', 'gsd-install-state.json',
    'gsd-install-migration.lock', 'gsd-migration-journal', '.gsd-profile', '.gsd-source',
  ]) {
    rules.push(tokenRule('bookkeeping', name, name.replace('gsd-', 'fvgsd-')));
  }
  rules.push({ id: 'vibe-paths', pattern: /(?<![A-Za-z0-9_-])\.planning-vibe(?![A-Za-z0-9_-])/g, replace: () => '.planning-fvgsd-vibe' });
  rules.push({ id: 'vibe-paths', pattern: /(?<![A-Za-z0-9_-])\.vibe(?![A-Za-z0-9_-])/g, replace: () => '.fvgsd-vibe' });
  rules.push({ id: 'profile-markers', pattern: /(?<![A-Za-z])GSD:profile-(start|end)/g, replace: (match, edge) => `FVGSD:profile-${edge}` });
  rules.push({ id: 'env-vars', pattern: /(?<![A-Za-z0-9_])GSD_([A-Z0-9_]+)/g, replace: (match, rest) => `FVGSD_${rest}` });
  rules.push({ id: 'code-literals', codeOnly: true, pattern: /(['"`])gsd-/g, replace: (match, quote) => `${quote}fvgsd-` });
  rules.push({ id: 'code-literals', codeOnly: true, pattern: /\^gsd-/g, replace: () => '^fvgsd-' });
  rules.push({ id: 'code-literals', codeOnly: true, pattern: /agents(\\?\.)gsd-/g, replace: (match, dot) => `agents${dot}fvgsd-` });
  return rules;
}

function rewriteText(text, rules, { isCode }) {
  const replacements = [];
  let next = text;
  for (const rule of rules) {
    if (rule.codeOnly && !isCode) continue;
    next = next.replace(rule.pattern, (...args) => {
      const replacement = rule.replace(...args);
      replacements.push({ ruleId: rule.id, match: args[0], replacement });
      return replacement;
    });
  }
  return { text: next, replacements };
}

function renamedPath(relPath) {
  const parts = relPath.split('/');
  if (parts.length === 2 && parts[0] === 'agents' && /^gsd-.+\.md$/.test(parts[1])) return `agents/f${parts[1]}`;
  if (parts.length === 2 && parts[0] === 'hooks' && /^gsd-.+\.(?:js|sh)$/.test(parts[1])) {
    return `hooks/fvgsd/${parts[1].slice('gsd-'.length)}`;
  }
  if (parts.length === 3 && parts[0] === 'hooks' && parts[1] === 'lib') return `hooks/fvgsd/lib/${parts[2].replace(/^gsd-/, '')}`;
  if (relPath === 'get-shit-done/bin/gsd-tools.cjs') return 'get-shit-done/bin/fvgsd-tools.cjs';
  if (relPath === 'bin/gsd-sdk.js') return 'bin/fvgsd-sdk.js';
  const forked = relPath.replace(/(?<![fF])vgsd/g, 'fvgsd');
  return forked === relPath ? null : forked;
}

function planRenames(relPaths) {
  return relPaths
    .map((from) => ({ from, to: renamedPath(from) }))
    .filter((entry) => entry.to !== null)
    .sort((a, b) => a.from.localeCompare(b.from));
}

function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (glob[i] === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegExp(glob[i]);
    }
  }
  return new RegExp(`^${source}$`);
}

function namesFrom(root, dir, pattern) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name.replace(/\.(?:md|js|sh)$/, ''));
}

function run({ root, dryRun }) {
  const exclude = MAP.exclude.map(globToRegExp);
  const rules = buildRules({
    agentRoles: namesFrom(root, 'agents', /^gsd-.+\.md$/),
    hookNames: namesFrom(root, 'hooks', /^gsd-.+\.(?:js|sh)$/),
    helperNames: namesFrom(root, path.join('hooks', 'lib'), /^gsd-.+\.(?:js|sh)$/),
  });
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((rel) => !exclude.some((re) => re.test(rel)));

  const totals = {};
  const files = [];
  for (const rel of tracked) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const buffer = fs.readFileSync(abs);
    if (buffer.includes(0)) continue;
    const isCode = MAP.codeExtensions.includes(path.extname(rel));
    const { text, replacements } = rewriteText(buffer.toString('utf8'), rules, { isCode });
    if (replacements.length === 0) continue;
    const counts = {};
    for (const { ruleId } of replacements) {
      counts[ruleId] = (counts[ruleId] || 0) + 1;
      totals[ruleId] = (totals[ruleId] || 0) + 1;
    }
    files.push({ path: rel, counts });
    if (!dryRun) fs.writeFileSync(abs, text);
  }

  const renames = planRenames(tracked);
  if (!dryRun) {
    for (const { from, to } of renames) {
      fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
      execFileSync('git', ['mv', from, to], { cwd: root });
    }
  }
  return { dryRun, totals, files, renames };
}

function main(argv) {
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex === -1 ? path.resolve(__dirname, '..') : path.resolve(argv[rootIndex + 1]);
  const report = run({ root, dryRun: argv.includes('--dry-run') });
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${report.dryRun ? 'Would change' : 'Changed'} ${report.files.length} file(s), ${report.renames.length} rename(s)\n`);
    for (const [id, count] of Object.entries(report.totals)) process.stdout.write(`  ${id}: ${count}\n`);
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { buildRules, rewriteText, planRenames, globToRegExp, run };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/rename-identity-script.test.cjs`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/rename-identity.cjs scripts/identity-rename.map.json tests/rename-identity-script.test.cjs
git commit -m "feat: add re-runnable fvgsd rename script"
```

---

### Task 4: Coexistence test (expected to fail until Task 9)

**Files:**
- Create: `tests/helpers/foreign-installs.cjs`, `tests/fixtures/foreign-installer-matchers.json`, `tests/fvgsd-coexistence.install.test.cjs`

**Interfaces:**
- Consumes: `IDENTITY` (Task 1); `INSTALL_SCRIPT`, `RUNTIME_META`, `installerEnv` from `tests/helpers/install-shared.cjs`; `parseTomlToObject` exported by `bin/install.js`.
- Produces:
  - `seedForeignInstalls(configDir, runtime) → string[]` (sorted relative paths)
  - `listFiles(root) → string[]`
  - `snapshot(configDir, relPaths) → { [rel]: sha256 }`
- Relies on a later export: `codexConfigLayout(content) → { markers: [{ owner: 'fvgsd'|'gsd', line }], agentSections: [{ name, line }] }` from `bin/install.js`, added in Task 8.
- These files are written after Task 3 and are excluded from the rename, because they intentionally use gsd/vgsd names. The test uses post-rename names (`FVGSD_TEST_MODE`) because it only runs meaningfully after Task 5.

- [ ] **Step 1: Write the matcher fixture**

Create `tests/fixtures/foreign-installer-matchers.json` (taken from `bin/install.js` at 29f1b1a6):

```json
{
  "fileNamePrefixes": ["gsd-", "vgsd-"],
  "hookCommandSubstrings": [
    "gsd-check-update", "gsd-context-monitor", "gsd-prompt-guard", "gsd-read-guard",
    "gsd-read-injection-scanner", "gsd-workflow-guard", "gsd-validate-commit",
    "gsd-graphify-update", "gsd-session-state", "gsd-phase-boundary", "gsd-update-banner", "gsd-statusline"
  ],
  "codexSectionPrefixes": ["agents.gsd-"],
  "permissionKeySubstrings": ["get-shit-done"]
}
```

- [ ] **Step 2: Write the seeding helper**

Create `tests/helpers/foreign-installs.cjs`:

```js
'use strict';

/**
 * Seeds fake upstream GSD and vgsd installs into a runtime config directory and
 * snapshots it for tests/fvgsd-coexistence.install.test.cjs. This file uses
 * gsd/vgsd names on purpose and is excluded from scripts/rename-identity.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function hookCommand(configDir, name) {
  return `node "${configDir.replace(/\\/g, '/')}/hooks/${name}"`;
}

function seedForeignInstalls(configDir, runtime) {
  const settings = {
    statusLine: { type: 'command', command: hookCommand(configDir, 'gsd-statusline.js') },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(configDir, 'gsd-check-update.js') }] }],
      PostToolUse: [{
        matcher: 'Bash|Edit|Write|MultiEdit|Agent|Task',
        hooks: [{ type: 'command', command: hookCommand(configDir, 'gsd-context-monitor.js'), timeout: 10 }],
      }],
    },
  };
  const files = {
    'get-shit-done/VERSION': '1.42.3\n',
    'get-shit-done/workflows/help.md': '# gsd help\n',
    'agents/gsd-planner.md': '---\nname: gsd-planner\n---\n',
    'skills/gsd-help/SKILL.md': '---\nname: gsd-help\n---\n',
    'skills/vgsd-help/SKILL.md': '---\nname: vgsd-help\n---\n',
    'commands/gsd/help.md': '---\nname: gsd:help\n---\n',
    'commands/vgsd/help.md': '---\nname: vgsd:help\n---\n',
    'command/gsd-help.md': '---\nname: gsd-help\n---\n',
    'hooks/gsd-statusline.js': '// gsd-hook-version: 1.42.3\n',
    'hooks/gsd-context-monitor.js': '// gsd-hook-version: 1.42.3\n',
    'hooks/gsd-check-update.js': '// gsd-hook-version: 1.42.3\n',
    'hooks/lib/git-cmd.js': 'module.exports = {};\n',
    'gsd-file-manifest.json': `${JSON.stringify({ version: '1.42.3', files: { 'agents/gsd-planner.md': 'x' } }, null, 2)}\n`,
    'settings.json': `${JSON.stringify(settings, null, 2)}\n`,
  };
  if (runtime === 'codex') {
    files['config.toml'] = [
      'model = "gpt-5"',
      '',
      '[features]',
      'codex_hooks = true',
      '',
      '# GSD Agent Configuration — managed by get-shit-done installer',
      '',
      '[agents.gsd-planner]',
      'description = "GSD planner"',
      'config_file = "agents/gsd-planner.toml"',
      '',
    ].join('\n');
    files['agents/gsd-planner.toml'] = 'developer_instructions = "plan"\n';
    files['hooks.json'] = `${JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(configDir, 'gsd-check-update.js') }] }] },
    }, null, 2)}\n`;
  }
  if (runtime === 'opencode' || runtime === 'kilo') {
    const key = `${configDir.replace(/\\/g, '/')}/get-shit-done/*`;
    files[`${runtime}.json`] = `${JSON.stringify({ permission: { read: { [key]: 'allow' } } }, null, 2)}\n`;
  }
  for (const [rel, content] of Object.entries(files)) writeFile(configDir, rel, content);
  return Object.keys(files).sort();
}

function listFiles(root, rel = '') {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, child));
    else out.push(child);
  }
  return out.sort();
}

function snapshot(configDir, relPaths) {
  return Object.fromEntries(relPaths.map((rel) => [
    rel,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(configDir, rel))).digest('hex'),
  ]));
}

module.exports = { seedForeignInstalls, listFiles, snapshot };
```

- [ ] **Step 3: Write the coexistence test, marked `todo`**

Create `tests/fvgsd-coexistence.install.test.cjs`:

```js
// allow-test-rule: structural-regression-guard
// Name-safety guard: fvgsd's installed names must not contain the prefixes and
// substrings that the gsd and vgsd installers use to find their own entries.

'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { spawnSync } = require('node:child_process');

const { INSTALL_SCRIPT, RUNTIME_META, installerEnv } = require('./helpers/install-shared.cjs');
const { seedForeignInstalls, listFiles, snapshot } = require('./helpers/foreign-installs.cjs');
const MATCHERS = require('./fixtures/foreign-installer-matchers.json');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const installer = require('../bin/install.js');

const STRUCTURED = new Set(['settings.json', 'hooks.json', 'opencode.json', 'kilo.json', 'gsd-file-manifest.json', 'config.toml']);

function runInstaller(runtime, root, configDir, extra = []) {
  const r = spawnSync(process.execPath, [INSTALL_SCRIPT, `--${runtime}`, '--global', '--config-dir', configDir, ...extra], {
    cwd: root,
    encoding: 'utf8',
    env: installerEnv({ HOME: root, USERPROFILE: root }),
  });
  assert.equal(r.status, 0, `${runtime} ${extra.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
}

function parsed(configDir, rel) {
  const text = fs.readFileSync(path.join(configDir, rel), 'utf8');
  return rel === 'config.toml' ? installer.parseTomlToObject(text) : JSON.parse(text);
}

function hookCommands(settings) {
  const out = [];
  for (const entries of Object.values((settings && settings.hooks) || {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) if (typeof hook.command === 'string') out.push(hook.command);
    }
  }
  return out;
}

function matchesForeignInstaller(value) {
  const base = path.posix.basename(value.replace(/\\/g, '/'));
  return MATCHERS.fileNamePrefixes.some((prefix) => base.startsWith(prefix))
    || MATCHERS.hookCommandSubstrings.some((needle) => value.includes(needle))
    || MATCHERS.codexSectionPrefixes.some((prefix) => value.startsWith(prefix))
    || MATCHERS.permissionKeySubstrings.some((needle) => value.includes(needle));
}

describe('fvgsd installs next to gsd and vgsd', () => {
  for (const runtime of Object.keys(RUNTIME_META)) {
    test(`${runtime}: install and uninstall leave gsd and vgsd untouched`, { todo: 'passes after Task 9' }, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `${IDENTITY.tempPrefix}coexist-${runtime}-`));
      try {
        const configDir = path.join(root, 'config');
        const seeded = seedForeignInstalls(configDir, runtime);
        const plain = seeded.filter((rel) => !STRUCTURED.has(rel));
        const before = {
          files: listFiles(configDir),
          hashes: snapshot(configDir, plain),
          parsed: Object.fromEntries(seeded.filter((rel) => STRUCTURED.has(rel)).map((rel) => [rel, parsed(configDir, rel)])),
        };

        runInstaller(runtime, root, configDir);

        assert.deepEqual(snapshot(configDir, plain), before.hashes);
        assert.deepEqual(parsed(configDir, 'gsd-file-manifest.json'), before.parsed['gsd-file-manifest.json']);
        const settings = parsed(configDir, 'settings.json');
        assert.deepEqual(settings.statusLine, before.parsed['settings.json'].statusLine);
        const seededCommands = hookCommands(before.parsed['settings.json']);
        const commands = hookCommands(settings);
        for (const command of seededCommands) assert.equal(commands.includes(command), true, `lost ${command}`);

        const manifest = JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.manifestFile), 'utf8'));
        const owned = [...Object.keys(manifest.files), ...commands.filter((command) => !seededCommands.includes(command))];

        if (runtime === 'codex') {
          const config = parsed(configDir, 'config.toml');
          assert.deepEqual(config.agents['gsd-planner'], before.parsed['config.toml'].agents['gsd-planner']);
          owned.push(...Object.keys(config.agents).filter((name) => name !== 'gsd-planner').map((name) => `agents.${name}`));
          const layout = installer.codexConfigLayout(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
          const gsdMarker = layout.markers.find((marker) => marker.owner === 'gsd');
          const ownSections = layout.agentSections.filter((section) => section.name.startsWith(IDENTITY.agentPrefix));
          assert.equal(ownSections.length > 0, true);
          for (const section of ownSections) assert.equal(section.line < gsdMarker.line, true, `${section.name} is below the GSD marker`);
          const hooksJsonCommands = hookCommands(parsed(configDir, 'hooks.json'));
          for (const command of hookCommands(before.parsed['hooks.json'])) {
            assert.equal(hooksJsonCommands.includes(command), true, `hooks.json lost ${command}`);
          }
        }

        if (runtime === 'opencode' || runtime === 'kilo') {
          const config = parsed(configDir, `${runtime}.json`);
          const seededKeys = Object.keys(before.parsed[`${runtime}.json`].permission.read);
          for (const key of seededKeys) assert.equal(config.permission.read[key], 'allow');
          for (const table of Object.values(config.permission || {})) {
            owned.push(...Object.keys(table).filter((key) => !seededKeys.includes(key)));
          }
        }

        assert.deepEqual(owned.filter(matchesForeignInstaller), [], `${runtime}: fvgsd names collide with gsd/vgsd matchers`);

        runInstaller(runtime, root, configDir, ['--uninstall']);

        assert.deepEqual(listFiles(configDir), before.files);
        assert.deepEqual(snapshot(configDir, plain), before.hashes);
        for (const [rel, value] of Object.entries(before.parsed)) {
          assert.equal(isDeepStrictEqual(parsed(configDir, rel), value), true, `${rel} differs after uninstall`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
```

- [ ] **Step 4: Run it and confirm it is reported as todo**

Run: `node --test tests/fvgsd-coexistence.install.test.cjs`
Expected: the run exits 0 and reports 15 `todo` tests. At this point they fail inside the `todo` wrapper because the installer is still named vgsd.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/foreign-installs.cjs tests/fixtures/foreign-installer-matchers.json tests/fvgsd-coexistence.install.test.cjs
git commit -m "test: add fvgsd coexistence test against fake gsd and vgsd installs"
```

---

### Task 5: Apply the rename, the install folder and the `hooks/fvgsd/` layout

**Files:**
- Modify: the whole repository (script output), `scripts/build-hooks.js`, `bin/install.js`, `hooks/fvgsd/check-update.js`, `hooks/fvgsd/check-update-worker.js`, `tests/helpers/install-shared.cjs`, `tests/bug-3628-bundled-hook-classifier-whitelist.test.cjs`, `tests/managed-hooks.test.cjs`
- Regenerate: `hooks/dist/`, `docs/INVENTORY-MANIFEST.json`, `sdk/dist/`, execution-branch guard blocks

**Interfaces:**
- Consumes: `scripts/rename-identity.cjs` (Task 3); `IDENTITY` (Task 1).
- Produces: a repository where every name is fvgsd and the full suite passes. The installer writes `<config>/fvgsd/` and `<config>/hooks/fvgsd/**`. `bin/install.js` has `const IDENTITY = require(path.join(_gsdLibDir, 'identity.cjs'));` for later tasks.

- [ ] **Step 1: Dry run and check the rename classes**

```bash
node scripts/rename-identity.cjs --dry-run --json > "$TMPDIR/fvgsd-rename.json"
node -e '
const r = require(process.argv[1]);
const classes = {};
for (const { to } of r.renames) {
  const k = to.startsWith("agents/") ? "agents"
    : to.startsWith("hooks/fvgsd/lib/") ? "hook-lib"
    : to.startsWith("hooks/fvgsd/") ? "hooks"
    : /^(bin\/fvgsd-sdk\.js|get-shit-done\/bin\/fvgsd-tools\.cjs)$/.test(to) ? "bins" : "fork-named";
  classes[k] = (classes[k] || 0) + 1;
}
console.log(JSON.stringify({ totals: r.totals, classes }, null, 2));
' "$TMPDIR/fvgsd-rename.json"
```

Expected: `classes.agents` is 33, `classes.hooks` is 13, `classes["hook-lib"]` is 2, `classes.bins` is 2, and every `fork-named` target is an existing path with `vgsd` swapped for `fvgsd`. If anything else appears, stop and report it.

- [ ] **Step 2: Apply and prove it is idempotent**

```bash
node scripts/rename-identity.cjs --json > "$TMPDIR/fvgsd-rename-applied.json"
git add -A
node scripts/rename-identity.cjs --dry-run --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const r=JSON.parse(s);console.log(JSON.stringify({totals:r.totals,renames:r.renames.length}))})'
```

Expected: `{"totals":{},"renames":0}`.

- [ ] **Step 3: Point install targets at `IDENTITY.installDir`**

In `bin/install.js`, directly after the line that defines `_gsdLibDir`, add:

```js
const IDENTITY = require(path.join(_gsdLibDir, 'identity.cjs'));
```

Then replace every **install-target** use of `'get-shit-done'` with `IDENTITY.installDir`. Leave the two **source** uses (`path.join(__dirname, '..', 'get-shit-done', ...)` and `path.join(src, 'get-shit-done')`) unchanged:
- `path.join(targetDir, 'get-shit-done', ...)` and `path.join(configDir, 'get-shit-done')` (uninstall, `writeManifest`, CHANGELOG, VERSION, Codex snapshot and rollback VERSION paths, the Copilot template path)
- `const skillDest = path.join(targetDir, IDENTITY.installDir);` and `verifyInstalled(skillDest, IDENTITY.installDir)` / `failures.push(IDENTITY.installDir)`
- `manifest.files['get-shit-done/' + rel]` → ``manifest.files[`${IDENTITY.installDir}/${rel}`]``
- `const codexGsdPath = \`${path.resolve(targetDir, IDENTITY.installDir).replace(/\\/g, '/')}/\`;`, plus the two regexes above it: `/~\/\.claude\/fvgsd\//g` and `/\$HOME\/\.claude\/fvgsd\//g`
- the OpenCode and Kilo uninstall key checks: ``key.includes(`/${IDENTITY.installDir}/`)``

Check: `grep -n "'get-shit-done'" bin/install.js` now shows only the `_gsdLibDir` and `skillSrc` lines.

In `hooks/fvgsd/check-update.js`:
- replace each `'get-shit-done', 'VERSION'` with `'fvgsd', 'VERSION'`
- set `const workerPath = path.join(__dirname, 'check-update-worker.js');`

Then run `grep -rn "__dirname, 'fvgsd/" hooks/fvgsd` and change each hit to the bare sibling name.

- [ ] **Step 4: Build hooks from `hooks/fvgsd/`**

In `scripts/build-hooks.js`:
- set `const HOOKS_SUBDIRS_TO_COPY = ['fvgsd/lib'];`
- inside the `for (const hook of HOOKS_TO_COPY)` loop, replace the staging lines with:

```js
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const stagedDest = path.join(STAGE_DIR, `${hook.replace(/\//g, '__')}.${Date.now()}`);
```

The rename already turned `HOOKS_TO_COPY` entries into `fvgsd/<hook>` paths.

- [ ] **Step 5: Copy the hook tree recursively at install time**

In `bin/install.js`, find the block starting `const hooksSrc = path.join(src, 'hooks', 'dist');`. Replace everything from `const hookEntries = fs.readdirSync(hooksSrc);` through the end of the `for (const entry of hookEntries) { ... }` loop (including the one-level subdirectory branch) with:

```js
      const configDirReplacement = getConfigDirFromHome(runtime, isGlobal);
      const templateHook = (srcFile, destFile) => {
        if (srcFile.endsWith('.js')) {
          let content = fs.readFileSync(srcFile, 'utf8');
          content = content.replace(/'\.claude'/g, configDirReplacement);
          content = content.replace(/\/\.claude\//g, `/${getDirName(runtime)}/`);
          content = content.replace(/\.claude\//g, `${getDirName(runtime)}/`);
          if (isQwen) {
            content = content.replace(/CLAUDE\.md/g, 'QWEN.md');
            content = content.replace(/\bClaude Code\b/g, 'Qwen Code');
          }
          if (isHermes) {
            content = content.replace(/CLAUDE\.md/g, 'HERMES.md');
            content = content.replace(/\bClaude Code\b/g, 'Hermes Agent');
          }
          content = content.replace(/\{\{FVGSD_VERSION\}\}/g, pkg.version);
          fs.writeFileSync(destFile, content);
          try { fs.chmodSync(destFile, 0o755); } catch (e) { /* Windows doesn't support chmod */ }
        } else if (srcFile.endsWith('.sh')) {
          const content = fs.readFileSync(srcFile, 'utf8').replace(/\{\{FVGSD_VERSION\}\}/g, pkg.version);
          fs.writeFileSync(destFile, content);
          try { fs.chmodSync(destFile, 0o755); } catch (e) { /* Windows doesn't support chmod */ }
        } else {
          fs.copyFileSync(srcFile, destFile);
        }
      };
      const copyHookTree = (srcDir, destDir) => {
        fs.mkdirSync(destDir, { recursive: true });
        for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
          const srcPath = path.join(srcDir, entry.name);
          const destPath = path.join(destDir, entry.name);
          if (entry.isDirectory()) copyHookTree(srcPath, destPath);
          else if (entry.isFile()) templateHook(srcPath, destPath);
        }
      };
      copyHookTree(hooksSrc, hooksDest);
```

Delete the now-duplicate `const configDirReplacement = ...` line that preceded the old loop.

In the `hooks/lib/` install step, use `path.join(src, 'hooks', IDENTITY.hooksDir, 'lib')` and `path.join(targetDir, 'hooks', IDENTITY.hooksDir, 'lib')`.

In uninstall, set `const hooksLibDir = path.join(hooksDir, IDENTITY.hooksDir, 'lib');`. After the lib cleanup, add `try { fs.rmdirSync(path.join(hooksDir, IDENTITY.hooksDir)); } catch (_) { /* not empty or absent */ }`.

In `writeManifest`, replace the `hooks/` readdir loop and the `hooks/lib/` loop with:

```js
      const ownHooksDir = path.join(hooksDir, IDENTITY.hooksDir);
      for (const [rel, hash] of Object.entries(generateManifest(ownHooksDir))) {
        manifest.files[`hooks/${IDENTITY.hooksDir}/${rel}`] = hash;
      }
```

In the Codex hook copy, replace the `for (const entry of fs.readdirSync(codexHooksSrc))` loop header and its `includes` guard with a loop over the list, so the `fvgsd/` subpath is copied:

```js
      for (const entry of CODEX_HOOKS_TO_COPY) {
        const srcFile = path.join(codexHooksSrc, entry);
        if (!fs.existsSync(srcFile) || !fs.statSync(srcFile).isFile()) continue;
        const destFile = path.join(codexHooksDest, entry);
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
```

Keep the existing body of that loop.

- [ ] **Step 6: Scan stale hooks by path in the worker**

In `hooks/fvgsd/check-update-worker.js`, replace
`const hookFiles = fs.readdirSync(hooksDir).filter(f => MANAGED_HOOKS.includes(f));`
with
`const hookFiles = MANAGED_HOOKS.filter(f => fs.existsSync(path.join(hooksDir, f)));`
The entries are now `fvgsd/<hook>` paths relative to `hooks/`.

- [ ] **Step 7: Regenerate generated files**

```bash
rm -rf hooks/dist && npm run build:hooks
node scripts/sync-execution-branch-guards.cjs
node scripts/gen-inventory-manifest.cjs --write
node scripts/gen-identity-ts.cjs
(cd sdk && npm run build)
```

Expected: each command exits 0, and `hooks/dist/fvgsd/` contains the 13 hooks plus `lib/`.

- [ ] **Step 8: Update the three tests that pin the old hook layout**

- `tests/helpers/install-shared.cjs`: `EXPECTED_*` entries are now `fvgsd/<hook>` paths. Wherever this helper compares them with `fs.readdirSync(HOOKS_DIST)` or a hooks directory, compare with `walk(dir).map((f) => path.relative(dir, f).split(path.sep).join('/'))` instead. `simulateHookCopy` must recurse: copy each entry of `walk(hooksSrc)` to the same relative path under `hooksDest`, creating parent folders.
- `tests/bug-3628-bundled-hook-classifier-whitelist.test.cjs`: replace the `relPath.includes('fvgsd-')` assertion with `relPath.startsWith('hooks/fvgsd/')`. In the "no shipping drift" test, list `fs.readdirSync(path.join(hooksDir, 'fvgsd'), { withFileTypes: true })` filtered to files matching `/\.(?:js|sh|cjs|mjs)$/` and mapped to `` `hooks/fvgsd/${e.name}` ``.
- `tests/managed-hooks.test.cjs`: build `shippedHooks` from `fs.readdirSync(path.join(HOOKS_DIR, 'fvgsd'))` filtered to `.js`/`.sh` files and mapped to `` `fvgsd/${f}` ``.

- [ ] **Step 9: Run the suites and fix only rename fallout**

Run: `npm test 2>&1 | tail -60` and `(cd sdk && npm test 2>&1 | tail -40)`.
Expected: everything passes except the 15 `todo` coexistence tests.

For any other failure, apply only these fixes:

| Failure | Fix |
|---|---|
| Expects a `gsd-`/`vgsd-` name or path the rename changed | Update the expectation to the fvgsd name from the Names table |
| Lists `hooks/` or `hooks/dist/` flat | Walk `hooks/fvgsd/` recursively as in Step 8 |
| Expects `get-shit-done/` under a config dir | Use `IDENTITY.installDir` |

Never delete an assertion or weaken a check to get green. If a failure isn't explained by the table, stop and report it.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rename vgsd to fvgsd and install hooks under hooks/fvgsd"
```

---

### Task 6: Read names from the identity module

**Files:**
- Modify:
  - `get-shit-done/bin/lib/runtime-slash.cjs`, `runtime-artifact-layout.cjs`, `execution-branch.cjs`, `surface.cjs`, `profile-output.cjs`, `core.cjs`
  - `get-shit-done/bin/lib/vibe/store.cjs`, `vibe/git.cjs`, `vibe/schemas.cjs`, `vibe/orchestrator.cjs`
  - `get-shit-done/bin/lib/installer-migrations.cjs`
  - `bin/install.js`, `bin/vibe.js`
  - `sdk/src/query/query-unknown-command-hints.ts`, `sdk/src/query/skill-manifest.ts`, `sdk/src/query/profile-output.ts`
- Test: `tests/identity.test.cjs` (extend)

**Interfaces:**
- Consumes: `IDENTITY` (CJS) and `IDENTITY` from `sdk/src/identity.ts` (Tasks 1–2).
- Produces: no new exports. The observable names are unchanged from Task 5, but now derive from `IDENTITY`.

- [ ] **Step 1: Add the failing consumer test**

Append to `tests/identity.test.cjs`:

```js
test('runtime formatter and artifact layout derive from the identity', () => {
  const { formatGsdSlash } = require('../get-shit-done/bin/lib/runtime-slash.cjs');
  const { resolveRuntimeArtifactLayout } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
  assert.equal(formatGsdSlash('help 1', 'claude'), `/${IDENTITY.commandPrefix}-help 1`);
  assert.equal(formatGsdSlash('help', 'gemini'), `/${IDENTITY.commandPrefix}:help`);
  assert.equal(formatGsdSlash('/vgsd:help', 'codex'), `$${IDENTITY.commandPrefix}-help`);
  const layout = resolveRuntimeArtifactLayout('claude', '/tmp/fvgsd-layout', 'local');
  assert.deepEqual(layout.kinds.map((kind) => [kind.kind, kind.prefix, kind.destSubpath]), [
    ['commands', `${IDENTITY.commandPrefix}-`, `commands/${IDENTITY.commandPrefix}`],
    ['agents', IDENTITY.agentPrefix, 'agents'],
  ]);
});
```

Run: `node --test tests/identity.test.cjs`
Expected: FAIL on the `/vgsd:help` case, because the Task 5 strip regex accepts only `fvgsd` and `gsd`.

- [ ] **Step 2: Replace literals with `IDENTITY` lookups**

In each file, add `const IDENTITY = require('./identity.cjs');` (use `'../identity.cjs'` from `vibe/`), then:

- **`runtime-slash.cjs`**
  - strip regex: `new RegExp(\`^[/$]?(?:${IDENTITY.commandPrefix}|vgsd|gsd)[-:]\`, 'i')`, so legacy input is still accepted
  - emitted shapes: `` `$${IDENTITY.commandPrefix}-${token.toLowerCase()}${tail}` ``, `` `/${IDENTITY.commandPrefix}:${token}${tail}` `` and `` `/${IDENTITY.commandPrefix}-${token}${tail}` ``
- **`runtime-artifact-layout.cjs`**
  - every `'fvgsd-'` → `` `${IDENTITY.commandPrefix}-` ``
  - `'commands/fvgsd'` → `` `commands/${IDENTITY.commandPrefix}` ``
  - `'skills/fvgsd'` → `` `skills/${IDENTITY.commandPrefix}` ``
  - the agents prefix → `IDENTITY.agentPrefix`
  - `'.fvgsd-source'` → `IDENTITY.sourceFile`
- **`execution-branch.cjs`**
  - `SMART_BRANCH_PREFIX = IDENTITY.branchPrefix`
  - `metadataDirectory` returns `path.join(commonDir, ...IDENTITY.executionsDir.split('/'))`
  - the ref filter is `` `refs/heads/${IDENTITY.branchPrefix}` ``
- **`surface.cjs`:** `SURFACE_FILE_NAME = IDENTITY.surfaceFile`; the two `'fvgsd-'` prefix literals → `IDENTITY.agentPrefix`.
- **`profile-output.cjs`:** markers `` `<!-- ${IDENTITY.claudeMdMarker}:profile-start -->` `` and `` `<!-- ${IDENTITY.claudeMdMarker}:profile-end -->` ``, plus every other use of those marker strings in the file.
- **`core.cjs`:** `function reapStaleTempFiles(prefix = IDENTITY.tempPrefix, ...)`.
- **`vibe/store.cjs`:** `STATE_DIR = IDENTITY.vibeStateDir`.
- **`vibe/git.cjs`, `vibe/schemas.cjs`, `vibe/orchestrator.cjs`:**
  - `'.fvgsd-vibe/worktrees'` → `IDENTITY.vibeWorktreeRoot`
  - `'.fvgsd-vibe'` → `IDENTITY.vibeWorktreeRoot.split('/')[0]`
  - `'.planning-fvgsd-vibe'` → `IDENTITY.vibeStateDir`
  - template strings that embed them interpolate the same values
- **`installer-migrations.cjs`:** `MANIFEST_NAME = IDENTITY.manifestFile`, `INSTALL_STATE_NAME = IDENTITY.installStateFile`, `INSTALL_MIGRATION_LOCK_NAME = IDENTITY.migrationLockFile`; the two `'fvgsd-migration-journal'` literals → `IDENTITY.migrationJournalDir`.
- **`bin/install.js`**
  - `PATCHES_DIR_NAME = IDENTITY.patchesDir`
  - `MANIFEST_NAME = IDENTITY.manifestFile`
  - the `'fvgsd-pristine'` directory → `IDENTITY.pristineDir`
  - `'.fvgsd-profile'` → `IDENTITY.profileFile`
  - `FVGSD_CODEX_MARKER = IDENTITY.codexMarker`
  - `FVGSD_CODEX_HOOKS_OWNERSHIP_PREFIX = IDENTITY.codexHooksOwnershipPrefix`
  - replace both ownership regex literals (`/^\r?\n# GSD codex_hooks ownership: (section|root_dotted)\r?\n/` and the `(?:section|root_dotted)` variant) with regexes built from the prefix:

    ```js
    const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const CODEX_OWNERSHIP_LINE_RE = new RegExp(`^\\r?\\n${escapeForRegExp(IDENTITY.codexHooksOwnershipPrefix)}(section|root_dotted)\\r?\\n`);
    ```

    Use `afterMarker.match(CODEX_OWNERSHIP_LINE_RE)` in `getManagedCodexHooksOwnership` and `afterMarker.replace(CODEX_OWNERSHIP_LINE_RE, eol)` in `setManagedCodexHooksOwnership`.
- **`bin/vibe.js`:** the usage text uses `${IDENTITY.bins.vibe}` instead of the bare `vibe` command name (require `../get-shit-done/bin/lib/identity.cjs`).
- **SDK:**
  - `query-unknown-command-hints.ts`: add `import { IDENTITY } from '../identity.js';` and change the second hint to `` `Invoke \`node …/${IDENTITY.toolsScript}\` for CJS-only operations.` ``
  - `skill-manifest.ts` and `profile-output.ts`: `startsWith(IDENTITY.agentPrefix)`

- [ ] **Step 3: Run the tests**

Run: `node --test tests/identity.test.cjs && npm test 2>&1 | tail -40 && (cd sdk && npm test 2>&1 | tail -20)`
Expected: all pass except the 15 `todo` coexistence tests.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: derive fvgsd names from the identity module"
```

---

### Task 7: Installer ownership and managed-hook matching

**Files:**
- Modify: `bin/install.js`, `get-shit-done/bin/lib/shell-command-projection.cjs`
- Test: `tests/fvgsd-install-ownership.test.cjs`

**Interfaces:**
- Consumes: `IDENTITY`; `installRuntimeArtifacts`, `uninstallRuntimeArtifacts` exported by `bin/install.js`; `isManagedHookCommand`, `isManagedHookBasename` exported by `shell-command-projection.cjs`.
- Produces: `isManagedHookCommand(command, opts)` is true only for commands referencing `hooks/fvgsd/<hook>`. `isManagedHookBasename(path)` compares the last two path segments. Neither install nor uninstall removes any `gsd-*`/`vgsd-*` file or folder.

- [ ] **Step 1: Write the failing test**

Create `tests/fvgsd-install-ownership.test.cjs`:

```js
'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { snapshot } = require('./helpers/foreign-installs.cjs');
const { installRuntimeArtifacts, uninstallRuntimeArtifacts } = require('../bin/install.js');
const { isManagedHookCommand, isManagedHookBasename } = require('../get-shit-done/bin/lib/shell-command-projection.cjs');
const { loadSkillsManifest, resolveProfile } = require('../get-shit-done/bin/lib/install-profiles.cjs');

const PROFILE = resolveProfile({ modes: ['core'], manifest: loadSkillsManifest(path.join(__dirname, '..', 'commands', 'gsd')) });
const FOREIGN = [
  'commands/gsd/help.md',
  'commands/vgsd/help.md',
  'skills/gsd-help/SKILL.md',
  'skills/vgsd-help/SKILL.md',
  'skills/gsd/help/SKILL.md',
  'command/gsd-help.md',
  'command/vgsd-help.md',
];

test('only commands under hooks/fvgsd/ count as managed hooks', () => {
  const settings = { surface: 'settings-json' };
  assert.equal(isManagedHookCommand('node "/h/.claude/hooks/fvgsd/statusline.js"', settings), true);
  assert.equal(isManagedHookCommand('node "/h/.claude/hooks/statusline.js"', settings), false);
  assert.equal(isManagedHookCommand('node "/h/.claude/hooks/gsd-statusline.js"', settings), false);
  assert.equal(isManagedHookCommand('node "/h/.codex/hooks/gsd-update-check.js"', { surface: 'codex-hooks-json', includeLegacyAliases: true }), false);
  assert.equal(isManagedHookBasename('/h/.claude/hooks/fvgsd/context-monitor.js'), true);
  assert.equal(isManagedHookBasename('/h/.claude/hooks/context-monitor.js'), false);
});

for (const runtime of ['claude', 'hermes', 'gemini', 'opencode']) {
  test(`${runtime}: install and uninstall of artifacts never touch gsd or vgsd files`, (t) => {
    const configDir = createTempDir(`fvgsd-own-${runtime}-`);
    t.after(() => cleanup(configDir));
    for (const rel of FOREIGN) {
      fs.mkdirSync(path.dirname(path.join(configDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(configDir, rel), `${rel}\n`);
    }
    const before = snapshot(configDir, FOREIGN);
    installRuntimeArtifacts(runtime, configDir, 'global', PROFILE);
    assert.deepEqual(snapshot(configDir, FOREIGN), before);
    uninstallRuntimeArtifacts(runtime, configDir, 'global');
    assert.deepEqual(snapshot(configDir, FOREIGN), before);
  });
}
```

Run: `node --test tests/fvgsd-install-ownership.test.cjs`
Expected: FAIL. Either `snapshot` throws because a foreign file was deleted, or the `hooks/statusline.js` assertion fails.

- [ ] **Step 2: Scope managed-hook matching to `hooks/fvgsd/`**

In `get-shit-done/bin/lib/shell-command-projection.cjs`:
- set both `LEGACY_MANAGED_HOOK_ALIASES_BY_SURFACE` sets to `new Set()`, since fvgsd has no legacy hook names
- in `isManagedHookBasename`, replace the basename computation with:

```js
  const surface = opts.surface || 'settings-json';
  const segments = String(scriptPathOrBasename).split(/[\\/]/).filter(Boolean);
  return managedHookSurfaceSet(surface).has(segments.slice(-2).join('/'));
```

- in `isManagedHookCommand`, build the pattern from `hooks/<entry>` so a bare basename never matches:

```js
  for (const managedPath of managedBasenames) {
    const escaped = `hooks/${managedPath}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[\\\\/\\s"'\`])${escaped}(?=$|[\\s"'\`])`);
    if (pattern.test(normalizedCommand)) return true;
  }
```

Also, in `bin/install.js` uninstall settings cleanup, pass `configDir: targetDir` to `isManagedHookCommand`.

- [ ] **Step 3: Remove the code that deletes other installs' files**

In `bin/install.js`:
- Replace the body of `_runLegacyInstallMigrations` with a single comment line: `// fvgsd has no legacy layout; files owned by gsd or vgsd are never touched.` Then delete the now-unused `_pruneLegacyFlatSkills`, `_pruneLegacyHermesCategory` and `_pruneLegacyFlatCommands`.
- Make `_runLegacyUninstallCleanup` return `null` without touching the filesystem.
- In uninstall blocks "1c" (Claude local) and "1d" (Gemini), change `path.join(targetDir, 'commands', 'gsd')` to `path.join(targetDir, 'commands', IDENTITY.commandPrefix)`.
- Replace every `/^(?:fvgsd|gsd)-/` in the local-install stale-skills cleanup and the Codex rollback with `new RegExp(\`^${IDENTITY.commandPrefix}-\`)`.
- Sweep: `grep -n "get-shit-done" bin/install.js`, and change any remaining install-target path built in a template string (for example OpenCode/Kilo permission keys) to use `IDENTITY.installDir`. Leave source paths and comments.
- Statusline: keep the existing policy. An existing statusline is replaced only with `--force-statusline` or an interactive "Replace" choice, and uninstall removes it only when its command contains `fvgsd/statusline`.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/fvgsd-install-ownership.test.cjs && npm test 2>&1 | tail -40`
Expected: the ownership test passes (5 tests).

Some existing tests assert that installing removes legacy `gsd-*`/`vgsd-*` artifacts, or that legacy hook aliases are recognised. That behavior is intentionally gone. Change each such test to assert the artifact is **preserved**, and use `git grep -n "preserve" -- tests` to confirm there's no duplicate. Every other test must pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: stop installer from touching gsd and vgsd files"
```

---

### Task 8: Codex `config.toml` and `hooks.json` coexistence

**Files:**
- Modify: `bin/install.js`
- Test: `tests/fvgsd-codex-coexistence.test.cjs`

**Interfaces:**
- Consumes: `IDENTITY`; the existing helpers `getTomlTableSections`, `removeContentRanges`, `collapseTomlBlankLines`, `detectLineEnding`, `atomicWriteFileSync`, `getManagedCodexHooksOwnership`, `stripCodexHooksFeatureAssignments`, `isManagedHookCommand`.
- Produces (exported from `bin/install.js`):
  - `codexConfigLayout(content) → { markers: [{ owner: 'fvgsd'|'gsd', line }], agentSections: [{ name, line }] }` (0-based lines)
  - `mergeCodexConfig(configPath, block)`: writes fvgsd's block above any GSD/vgsd marker and replaces its previous block in place
  - `stripGsdFromCodexConfig(content, { foreignHooksRemain }) → string | null`: removes only fvgsd's marker, ownership comment and `[agents.fvgsd-*]` sections
  - `ensureCodexHooksFeature` no longer rewrites an existing feature key

- [ ] **Step 1: Write the failing test**

Create `tests/fvgsd-codex-coexistence.test.cjs`:

```js
'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const { mergeCodexConfig, stripGsdFromCodexConfig, codexConfigLayout, parseTomlToObject } = require('../bin/install.js');

const GSD_BLOCK = [
  '# GSD Agent Configuration — managed by get-shit-done installer',
  '',
  '[agents.gsd-planner]',
  'description = "GSD planner"',
  'config_file = "agents/gsd-planner.toml"',
  '',
].join('\n');
const GSD_AGENT = { description: 'GSD planner', config_file: 'agents/gsd-planner.toml' };
const OWN_BLOCK = `${IDENTITY.codexMarker}\n\n[agents.fvgsd-planner]\ndescription = "fvgsd planner"\nconfig_file = "agents/fvgsd-planner.toml"\n`;

test('fvgsd block is written above the GSD marker and replaced in place', (t) => {
  const dir = createTempDir('fvgsd-codex-');
  t.after(() => cleanup(dir));
  const configPath = path.join(dir, 'config.toml');
  fs.writeFileSync(configPath, `model = "gpt-5"\n\n${GSD_BLOCK}`);
  mergeCodexConfig(configPath, OWN_BLOCK);
  mergeCodexConfig(configPath, OWN_BLOCK);
  const content = fs.readFileSync(configPath, 'utf8');
  const layout = codexConfigLayout(content);
  assert.deepEqual(layout.markers.map((m) => m.owner), ['fvgsd', 'gsd']);
  assert.deepEqual(layout.agentSections.map((s) => s.name), ['fvgsd-planner', 'gsd-planner']);
  const parsed = parseTomlToObject(content);
  assert.equal(parsed.model, 'gpt-5');
  assert.deepEqual(parsed.agents['gsd-planner'], GSD_AGENT);
});

test('uninstall keeps codex_hooks and GSD sections while GSD is installed', () => {
  const content = `[features]\ncodex_hooks = true\n\n${IDENTITY.codexMarker}\n${IDENTITY.codexHooksOwnershipPrefix}section\n\n` +
    `[agents.fvgsd-planner]\ndescription = "x"\nconfig_file = "y"\n\n${GSD_BLOCK}`;
  const cleaned = stripGsdFromCodexConfig(content, { foreignHooksRemain: true });
  const parsed = parseTomlToObject(cleaned);
  assert.equal(parsed.features.codex_hooks, true);
  assert.equal(parsed.agents['fvgsd-planner'], undefined);
  assert.deepEqual(parsed.agents['gsd-planner'], GSD_AGENT);
  assert.deepEqual(codexConfigLayout(cleaned).markers.map((m) => m.owner), ['gsd']);
});

test('uninstall removes the codex_hooks flag fvgsd owns when nothing else needs it', () => {
  const content = `[features]\ncodex_hooks = true\n\n${IDENTITY.codexMarker}\n${IDENTITY.codexHooksOwnershipPrefix}section\n\n` +
    '[agents.fvgsd-planner]\ndescription = "x"\nconfig_file = "y"\n';
  assert.equal(stripGsdFromCodexConfig(content, { foreignHooksRemain: false }), null);
});
```

Run: `node --test tests/fvgsd-codex-coexistence.test.cjs`
Expected: FAIL with `codexConfigLayout is not a function`.

- [ ] **Step 2: Add the layout reader and own-block stripper**

In `bin/install.js`, add near `generateCodexConfigBlock`:

```js
function codexConfigLayout(content) {
  const markers = [];
  content.split(/\r?\n/).forEach((text, line) => {
    const trimmed = text.trim();
    if (trimmed === IDENTITY.codexMarker) markers.push({ owner: 'fvgsd', line });
    else if (/^# GSD Agent Configuration\b/.test(trimmed)) markers.push({ owner: 'gsd', line });
  });
  const agentSections = getTomlTableSections(content)
    .filter((section) => !section.array && section.path.startsWith('agents.'))
    .map((section) => ({
      name: section.path.slice('agents.'.length),
      line: content.slice(0, section.start).split(/\r?\n/).length - 1,
    }));
  return { markers, agentSections };
}

function stripOwnCodexBlock(content) {
  const eol = detectLineEnding(content);
  const ranges = getTomlTableSections(content)
    .filter((section) => !section.array && section.path.startsWith(`agents.${IDENTITY.agentPrefix}`))
    .map(({ start, end }) => ({ start, end }));
  const withoutSections = removeContentRanges(content, ranges);
  const kept = withoutSections.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed !== IDENTITY.codexMarker && !trimmed.startsWith(IDENTITY.codexHooksOwnershipPrefix);
  });
  return collapseTomlBlankLines(kept.join(eol));
}
```

- [ ] **Step 3: Rewrite `mergeCodexConfig` and `stripGsdFromCodexConfig`**

Replace the body of `mergeCodexConfig(configPath, gsdBlock)` with:

```js
  if (!fs.existsSync(configPath)) {
    atomicWriteFileSync(configPath, gsdBlock + '\n');
    return;
  }
  const existing = fs.readFileSync(configPath, 'utf8');
  const eol = detectLineEnding(existing);
  const block = gsdBlock.replace(/\r?\n/g, eol);
  const cleaned = stripOwnCodexBlock(stripLeakedGsdCodexSections(existing));
  const foreignMarker = codexConfigLayout(cleaned).markers.find((marker) => marker.owner === 'gsd');
  if (!foreignMarker) {
    const trimmed = cleaned.trimEnd();
    atomicWriteFileSync(configPath, trimmed ? `${trimmed}${eol}${eol}${block}${eol}` : `${block}${eol}`);
    return;
  }
  const lines = cleaned.split(/\r?\n/);
  const before = lines.slice(0, foreignMarker.line).join(eol).trimEnd();
  const after = lines.slice(foreignMarker.line).join(eol);
  atomicWriteFileSync(configPath, `${before ? `${before}${eol}${eol}` : ''}${block}${eol}${eol}${after}`);
```

Replace `stripGsdFromCodexConfig(content)` with:

```js
function stripGsdFromCodexConfig(content, { foreignHooksRemain = false } = {}) {
  const eol = detectLineEnding(content);
  const foreignPresent = foreignHooksRemain
    || codexConfigLayout(content).markers.some((marker) => marker.owner === 'gsd');
  const ownership = foreignPresent ? null : getManagedCodexHooksOwnership(content);
  let cleaned = stripOwnCodexBlock(stripCodexHooksFeatureAssignments(content, ownership));
  if (!foreignPresent) {
    cleaned = cleaned.replace(/^multi_agent\s*=\s*true\s*(?:\r?\n)?/m, '');
    cleaned = cleaned.replace(/^default_mode_request_user_input\s*=\s*true\s*(?:\r?\n)?/m, '');
  }
  cleaned = cleaned.replace(/^\[features\]\s*\n(?=\[|$)/m, '');
  cleaned = cleaned.replace(/^\[agents\]\s*\n(?=\[|$)/m, '');
  cleaned = cleaned.replace(/^(?:\r?\n)+/, '').trimEnd();
  return cleaned ? cleaned + eol : null;
}
```

Add `codexConfigLayout` to `module.exports`.

- [ ] **Step 4: Leave existing feature keys and other installs' hooks alone**

- In `ensureCodexHooksFeature`, where an existing `codex_hooks`/`hooks` key is found under `[features]`, return `{ content: configContent, ownership: null }` instead of calling `rewriteTomlKeyLines`. Do the same for the root dotted-key branch.
- In `uninstall()` for Codex, run `removeCodexHooksJsonSessionStart(targetDir)` **before** cleaning `config.toml`. Then compute:

```js
    const hooksJsonPath = path.join(targetDir, 'hooks.json');
    let foreignHooksRemain = false;
    if (fs.existsSync(hooksJsonPath)) {
      try {
        const parsedHooks = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
        const sessionStart = (parsedHooks.hooks && parsedHooks.hooks.SessionStart) || [];
        foreignHooksRemain = sessionStart.some((entry) => (entry.hooks || []).some((hook) =>
          typeof hook.command === 'string' && !isManagedHookCommand(hook.command, { surface: 'codex-hooks-json', configDir: targetDir })));
      } catch (_) { foreignHooksRemain = true; }
    }
```

  Then call `stripGsdFromCodexConfig(content, { foreignHooksRemain })`.

- [ ] **Step 5: Run the tests and update intentional behavior changes**

Run: `node --test tests/fvgsd-codex-coexistence.test.cjs && npm test 2>&1 | tail -40`
Expected: the new test passes (3 tests).

Two kinds of existing test can now fail, and only because of behavior this spec intentionally removed:
- tests asserting marker-to-end-of-file removal
- tests asserting the in-place `codex_hooks` → `hooks` key rewrite

Find them with `git grep -ln "stripGsdFromCodexConfig\|mergeCodexConfig\|ensureCodexHooksFeature" -- tests`. Change those expectations to "other sections and the existing key are preserved". Every other test must pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix: keep fvgsd's Codex config block from touching GSD's sections and hooks"
```

---

### Task 9: Migrations only consider fvgsd surfaces, and the coexistence test passes

**Files:**
- Modify: `get-shit-done/bin/lib/installer-migrations/000-first-time-baseline.cjs`, `get-shit-done/bin/lib/installer-migration-report.cjs`, `tests/fvgsd-coexistence.install.test.cjs` (remove `todo`)
- Test: `tests/fvgsd-migration-baseline.test.cjs`

**Interfaces:**
- Consumes: `IDENTITY`; the baseline migration module's `plan({ configDir, runtime, baselineScan, classifyArtifact })`.
- Produces: the baseline plan contains no action for any path outside fvgsd's surfaces. The report's skill-anchor rule matches only `skills/fvgsd-*`.

- [ ] **Step 1: Write the failing test**

Create `tests/fvgsd-migration-baseline.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const baseline = require('../get-shit-done/bin/lib/installer-migrations/000-first-time-baseline.cjs');

const FOREIGN = [
  'skills/gsd-help/SKILL.md',
  'skills/vgsd-help/SKILL.md',
  'agents/gsd-planner.md',
  'hooks/gsd-statusline.js',
  'hooks/lib/git-cmd.js',
  'get-shit-done/VERSION',
  'commands/gsd/help.md',
];

test('baseline scan proposes nothing for gsd or vgsd files but still scans fvgsd ones', (t) => {
  const configDir = createTempDir('fvgsd-baseline-');
  t.after(() => cleanup(configDir));
  for (const rel of [...FOREIGN, 'agents/fvgsd-retired.md']) {
    fs.mkdirSync(path.dirname(path.join(configDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(configDir, rel), `${rel}\n`);
  }
  const actions = baseline.plan({
    configDir,
    runtime: 'claude',
    baselineScan: true,
    classifyArtifact: () => ({ classification: 'unmanaged', currentHash: 'hash', originalHash: null }),
  });
  assert.deepEqual(actions.filter((action) => FOREIGN.includes(action.relPath)), []);
  assert.deepEqual(
    actions.filter((action) => action.relPath === 'agents/fvgsd-retired.md').map((action) => action.type),
    ['prompt-user'],
  );
});
```

Run: `node --test tests/fvgsd-migration-baseline.test.cjs`
Expected: FAIL. Foreign paths such as `get-shit-done/VERSION` or `commands/gsd/help.md` still produce actions.

- [ ] **Step 2: Scope the baseline scan**

In `000-first-time-baseline.cjs`, add `const IDENTITY = require('../identity.cjs');`, then:

- replace `RUNTIME_SURFACES` and `COMMON_SURFACES` with:

```js
const OWN_HOOKS = `hooks/${IDENTITY.hooksDir}`;
const OWN_COMMANDS = `commands/${IDENTITY.commandPrefix}`;
const RUNTIME_SURFACES = {
  claude: [IDENTITY.installDir, OWN_COMMANDS, 'skills', 'agents', OWN_HOOKS, 'settings.json'],
  codex: [IDENTITY.installDir, 'skills', 'agents', OWN_HOOKS, 'config.toml', 'hooks.json'],
  gemini: [IDENTITY.installDir, OWN_COMMANDS, OWN_HOOKS],
  opencode: [IDENTITY.installDir, 'command', 'skills', 'agents'],
  kilo: [IDENTITY.installDir, 'command', 'skills', 'agents'],
  copilot: [IDENTITY.installDir, 'skills', 'agents'],
  antigravity: [IDENTITY.installDir, 'skills', 'agents'],
  cursor: [IDENTITY.installDir, 'skills', 'agents'],
  windsurf: [IDENTITY.installDir, 'skills', 'agents', 'rules'],
  augment: [IDENTITY.installDir, 'skills', 'agents'],
  trae: [IDENTITY.installDir, 'skills', 'agents', 'rules'],
  qwen: [IDENTITY.installDir, 'skills', 'agents'],
  hermes: [IDENTITY.installDir, `skills/${IDENTITY.commandPrefix}`, 'agents'],
  cline: [IDENTITY.installDir, 'skills', 'agents'],
  codebuddy: [IDENTITY.installDir, 'skills', 'agents'],
};
const COMMON_SURFACES = [IDENTITY.installDir, 'skills', 'agents', OWN_HOOKS];
```

- `INTERNAL_TOP_LEVEL_NAMES = new Set([IDENTITY.manifestFile, IDENTITY.installStateFile, 'fvgsd-migration-backups', IDENTITY.migrationJournalDir])`
- `USER_OWNED_PATHS = new Set([\`${IDENTITY.installDir}/USER-PROFILE.md\`, \`${OWN_COMMANDS}/dev-preferences.md\`, \`skills/${IDENTITY.commandPrefix}-dev-preferences/SKILL.md\`])`
- add the ownership filter and apply it in `scanBaselineFiles`, returning `[...relPaths].filter(isOwnSurfacePath)`:

```js
function isOwnSurfacePath(relPath) {
  const [top, second, third] = relPath.split('/');
  if (top === 'skills') return Boolean(second) && (second.startsWith(`${IDENTITY.commandPrefix}-`) || (second === IDENTITY.commandPrefix && Boolean(third)));
  if (top === 'agents') return Boolean(second) && second.startsWith(IDENTITY.agentPrefix);
  if (top === 'command') return Boolean(second) && second.startsWith(`${IDENTITY.commandPrefix}-`);
  return true;
}
```

- `isStaleGsdLookingPath` matches only fvgsd names: basename `/^fvgsd[-_]/` (build it from `IDENTITY.commandPrefix`), or `skills|agents` second segment starting with `` `${IDENTITY.commandPrefix}-` ``
- `isUserOwnedBaselinePath`: drop the `gsd-`/`vgsd-` clauses; foreign paths never reach it now

In `installer-migration-report.cjs`, replace the skill-anchor regex with `` new RegExp(`^skills/${IDENTITY.commandPrefix}-[^/]+/SKILL\\.md$`) `` (require `./identity.cjs`).

- [ ] **Step 3: Run the baseline test and the migration suites**

Run: `node --test tests/fvgsd-migration-baseline.test.cjs && npm test 2>&1 | tail -40`
Expected: the baseline test passes. Existing migration tests that seeded `gsd-*`/`vgsd-*` artifacts and expected actions for them must now expect none; update only those expectations.

- [ ] **Step 4: Turn on the coexistence test**

In `tests/fvgsd-coexistence.install.test.cjs`, remove `{ todo: 'passes after Task 9' }, ` from the `test(...)` call.

Run: `node --test tests/fvgsd-coexistence.install.test.cjs`
Expected: PASS, 15 tests. Each failure message names the runtime and the surface. Fix the installer, not the test, applying the ownership rules from Tasks 7–9.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: scope installer migrations to fvgsd surfaces and enable coexistence test"
```

---

### Task 10: Disable the npm update check and update from the clone

**Files:**
- Modify:
  - hooks: `hooks/fvgsd/check-update-worker.js`, `hooks/fvgsd/check-update.js`, `hooks/fvgsd/update-banner.js`, `hooks/fvgsd/statusline.js`
  - `get-shit-done/bin/check-latest-version.cjs`, `bin/install.js`
  - `get-shit-done/workflows/update.md`, `commands/gsd/update.md`
  - `tests/bug-2992-check-latest-version.test.cjs`
- Test: `tests/fvgsd-update-check-disabled.test.cjs`, `tests/fvgsd-update-source.install.test.cjs`

**Interfaces:**
- Produces:
  - `checkLatestVersion()` returns `{ ok: false, reason: 'disabled', detail }` and never calls `spawn`, with `CHECK_REASON.DISABLED === 'disabled'`
  - the worker writes `{ update_available: false, latest: 'unknown', ... }`
  - the cache lives at `~/.cache/fvgsd/update-check.json`
  - the installer writes `<config>/fvgsd/.fvgsd-source` as `{ repo, remote, commit, runtimes: [runtime], scope }`

- [ ] **Step 1: Write the failing tests**

Create `tests/fvgsd-update-check-disabled.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { checkLatestVersion, CHECK_REASON } = require('../get-shit-done/bin/check-latest-version.cjs');

const WORKER = path.join(__dirname, '..', 'hooks', 'fvgsd', 'check-update-worker.js');

test('checkLatestVersion is disabled and never spawns npm', () => {
  let spawned = false;
  const result = checkLatestVersion({ spawn: () => { spawned = true; return { status: 0, stdout: '9.9.9\n' }; } });
  assert.equal(spawned, false);
  assert.equal(result.ok, false);
  assert.equal(result.reason, CHECK_REASON.DISABLED);
});

test('update worker never runs npm and reports no update', (t) => {
  const dir = createTempDir('fvgsd-worker-');
  t.after(() => cleanup(dir));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  const marker = path.join(dir, 'npm-called');
  const npm = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  fs.writeFileSync(npm, process.platform === 'win32' ? `@echo called> "${marker}"\r\n` : `#!/bin/sh\necho called > "${marker}"\n`);
  fs.chmodSync(npm, 0o755);
  const versionFile = path.join(dir, 'config', 'fvgsd', 'VERSION');
  fs.mkdirSync(path.dirname(versionFile), { recursive: true });
  fs.writeFileSync(versionFile, '1.51.0\n');
  const cacheFile = path.join(dir, 'update-check.json');
  const r = spawnSync(process.execPath, [WORKER], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FVGSD_CACHE_FILE: cacheFile,
      FVGSD_PROJECT_VERSION_FILE: path.join(dir, 'missing', 'VERSION'),
      FVGSD_GLOBAL_VERSION_FILE: versionFile,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(marker), false);
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.equal(cache.update_available, false);
  assert.equal(cache.latest, 'unknown');
});
```

Create `tests/fvgsd-update-source.install.test.cjs`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runMinimalInstall } = require('./helpers/install-shared.cjs');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');

test('install records where fvgsd came from', (t) => {
  const { configDir, root } = runMinimalInstall({ runtime: 'claude', scope: 'global' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.installDir, IDENTITY.sourceFile), 'utf8'));
  assert.equal(record.repo, path.resolve(__dirname, '..'));
  assert.deepEqual(record.runtimes, ['claude']);
  assert.equal(record.scope, 'global');
  assert.equal(typeof record.commit, 'string');
});
```

Run: `node --test tests/fvgsd-update-check-disabled.test.cjs tests/fvgsd-update-source.install.test.cjs`
Expected: FAIL. `CHECK_REASON.DISABLED` is undefined, and the source record file does not exist.

- [ ] **Step 2: Disable the check**

In `get-shit-done/bin/check-latest-version.cjs`:
- add `DISABLED: 'disabled'` to `CHECK_REASON`
- make the first statement of `checkLatestVersion` return `{ ok: false, reason: CHECK_REASON.DISABLED, detail: 'fvgsd does not query npm; run /fvgsd-update to pull your clone' }`, and delete the now-unreachable code

In `hooks/fvgsd/check-update-worker.js`:
- delete the `try { latest = execFileSync('npm', ...) } catch (e) {}` block and the `execFileSync` import
- set `update_available: false` in `result`

Cache paths:
- `hooks/fvgsd/check-update.js`: `const cacheDir = path.join(homeDir, '.cache', 'fvgsd');` and `const cacheFile = path.join(cacheDir, 'update-check.json');`
- `hooks/fvgsd/update-banner.js`: the same two values
- `hooks/fvgsd/statusline.js`: `sharedCacheFile = path.join(homeDir, '.cache', 'fvgsd', 'update-check.json')`, and delete the legacy runtime cache fallback so it never reads another install's cache
- `bin/install.js`: the stale-cache cleanup uses `path.join(os.homedir(), '.cache', IDENTITY.updateCacheDir, IDENTITY.updateCacheFile)`

- [ ] **Step 3: Write the source record at install time**

In `bin/install.js`, directly after the VERSION file is written, add the snippet below. If `execGit` isn't already imported, add it to the existing `shell-command-projection.cjs` require.

```js
  const repoRoot = path.resolve(__dirname, '..');
  const gitValue = (args) => {
    const r = execGit(args, { cwd: repoRoot });
    return r.exitCode === 0 ? r.stdout.trim() : null;
  };
  fs.writeFileSync(
    path.join(targetDir, IDENTITY.installDir, IDENTITY.sourceFile),
    `${JSON.stringify({
      repo: repoRoot,
      remote: gitValue(['remote', 'get-url', 'origin']),
      commit: gitValue(['rev-parse', 'HEAD']),
      runtimes: [runtime],
      scope: isGlobal ? 'global' : 'local',
    }, null, 2)}\n`,
  );
```

- [ ] **Step 4: Rewrite the update workflow**

Replace the whole of `get-shit-done/workflows/update.md` with:

````markdown
<purpose>
Update fvgsd from the local clone it was installed from. fvgsd is not published to npm, and this workflow must never run `npx` or `npm install -g`.
</purpose>

<process>

<step name="find_install">
Check `./.claude/fvgsd/.fvgsd-source` (local install) first, then `~/.claude/fvgsd/.fvgsd-source`, then the same path under the other runtime folders (`~/.codex`, `~/.gemini`, `~/.config/opencode`, …).
Read the first file that exists as JSON: `{ repo, remote, commit, runtimes, scope }`.
If none exists, or `repo` is not a directory, show the manual steps in `manual_steps` and stop.
</step>

<step name="pull">
```bash
OLD=$(git -C "$REPO" rev-parse HEAD)
git -C "$REPO" pull --ff-only
NEW=$(git -C "$REPO" rev-parse HEAD)
```
If `pull --ff-only` fails, show its output, tell the user the clone has local changes or diverged, and stop.
If `OLD` equals `NEW`, report "fvgsd is up to date" and stop.
</step>

<step name="reinstall">
```bash
(cd "$REPO" && npm install)
node "$REPO/bin/install.js" --<runtime> --<scope>
```
Run the install line once per runtime in `runtimes`, with `--global` or `--local` from `scope`.
</step>

<step name="report">
```bash
git -C "$REPO" log --oneline "$OLD..$NEW"
```
Show the commits and remind the user to restart their runtime session.
</step>

<step name="manual_steps">
```text
cd <your fvgsd clone>
git pull --ff-only
npm install
node bin/install.js --claude --global   # repeat for each runtime you use
```
</step>

</process>
````

In `commands/gsd/update.md`, change the `<objective>` bullets to describe this flow ("pull the local clone, reinstall, show the commits"), and remove "npm version checking" and "Changelog fetching".

In `tests/bug-2992-check-latest-version.test.cjs`, replace the `PACKAGE_NAME`, enum and success-path tests with a single test asserting `Object.keys(CHECK_REASON).sort()` equals `['DISABLED', 'FAIL_INVALID_OUTPUT', 'FAIL_NPM_FAILED', 'OK']`. Delete the error-path tests, since the disabled check can no longer reach them.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/fvgsd-update-check-disabled.test.cjs tests/fvgsd-update-source.install.test.cjs tests/bug-2992-check-latest-version.test.cjs && npm test 2>&1 | tail -40`
Expected: all pass. Tests that assert the worker's npm call or the old cache path need expectation updates to the values above; nothing else changes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: disable npm update check and update fvgsd from its clone"
```

---

### Task 11: Metadata, hook messages, docs and final verification

**Files:**
- Modify: `package.json`, `sdk/package.json`, `.github/workflows/release.yml`, `bin/install.js`, `README.md`
- Create: a changeset fragment
- Test: `tests/fvgsd-hook-commands.test.cjs`

**Interfaces:**
- Produces: `rewriteHookCommandReferences(content, runtime) → { content, references: [{ from, to }] }`, exported from `bin/install.js` and used by `templateHook` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `tests/fvgsd-hook-commands.test.cjs`:

```js
'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteHookCommandReferences } = require('../bin/install.js');

test('hook command references use the target runtime shape', () => {
  const sample = "Run /gsd:pause-work or /gsd-new-project, not gsd-sdk.";
  assert.deepEqual(rewriteHookCommandReferences(sample, 'claude').references, [
    { from: '/gsd:pause-work', to: '/fvgsd-pause-work' },
    { from: '/gsd-new-project', to: '/fvgsd-new-project' },
  ]);
  assert.deepEqual(rewriteHookCommandReferences(sample, 'codex').references.map((r) => r.to), ['$fvgsd-pause-work', '$fvgsd-new-project']);
});
```

Run: `node --test tests/fvgsd-hook-commands.test.cjs`
Expected: FAIL with `rewriteHookCommandReferences is not a function`.

- [ ] **Step 2: Implement and wire it**

In `bin/install.js`, add:

```js
function rewriteHookCommandReferences(content, runtime) {
  const references = [];
  const next = content.replace(/\/gsd[:-]([a-z][a-z0-9-]*)/g, (from, command) => {
    const to = formatGsdSlash(command, runtime);
    references.push({ from, to });
    return to;
  });
  return { content: next, references };
}
```

Export it. In `templateHook`, add `content = rewriteHookCommandReferences(content, runtime).content;` to both the `.js` and `.sh` branches, before `writeFileSync`. If `formatGsdSlash` isn't already imported in `install.js`, require it from `runtime-slash.cjs`.

- [ ] **Step 3: Package and release metadata**

- `package.json`: `"name": "fvgsd"`, add `"private": true`, and set:
  - `bin`: `{ "fvgsd": "bin/install.js", "fvgsd-sdk": "bin/fvgsd-sdk.js", "fvgsd-tools": "bin/fvgsd-sdk.js", "fvgsd-vibe": "bin/vibe.js" }`
  - `repository.url`: `git+https://github.com/antaone/get-shit-done-vibeclaw.git`
  - `homepage`: `https://github.com/antaone/get-shit-done-vibeclaw`
  - `bugs.url`: `https://github.com/antaone/get-shit-done-vibeclaw/issues`
- `sdk/package.json`: confirm `name` is `@fvgsd/sdk` and `bin` is `{ "fvgsd-sdk": "./dist/cli.js" }`.
- `.github/workflows/release.yml`: delete every step whose `run` contains `npm publish`, plus the "Verify publish" step that queries npm for the published version.

- [ ] **Step 4: README and changeset**

Add this section to `README.md` directly under the first paragraph:

```markdown
## fvgsd

This fork installs as **fvgsd**. Its commands are `/fvgsd-*`, and it installs into its own folders (`<config>/fvgsd/`, `hooks/fvgsd/`, `fvgsd-*` agents), so it runs side by side with upstream GSD (`/gsd-*`) and VibeClaw vgsd (`/vgsd-*`) without changing their files. Projects keep using the shared `.planning/` folder. fvgsd is not published to npm: install it from a clone with `node bin/install.js --<runtime> --global`, and update it with `/fvgsd-update`, which pulls that clone.
```

Run: `npm run changeset -- --type Changed --body "fvgsd now installs side by side with upstream GSD and vgsd: its own command prefix, install folders, hooks, manifest and update source, and an installer that never touches files it doesn't own."`
If the changeset lint requires a `pr` value, fill it in when the pull request is opened.

- [ ] **Step 5: Full verification**

```bash
node scripts/gen-inventory-manifest.cjs --write
npm test
(cd sdk && npm test)
npm run lint:tests
npm run lint:test-file-count
npm run check:execution-branch-guards
npm run check:identity-fresh
node scripts/gen-inventory-manifest.cjs --check
(cd sdk && npm run check:alias-drift && npm run check:configuration-fresh)
```

Expected: every command exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: fvgsd package metadata, hook command names and docs"
```

---

### Task 12: Manual acceptance on this machine (ask the maintainer first)

**Files:** none (verification only).

**This task changes the maintainer's real runtime folders. Get explicit approval before Step 2.**

- [ ] **Step 1: Record GSD 1.42.3's current state**

```bash
node -e '
const fs = require("fs"), path = require("path"), crypto = require("crypto"), os = require("os");
const dirs = [".claude", ".codex", ".gemini", ".config/opencode"].map((d) => path.join(os.homedir(), d));
for (const dir of dirs) {
  const manifestPath = path.join(dir, "gsd-file-manifest.json");
  if (!fs.existsSync(manifestPath)) { console.log(JSON.stringify({ dir, manifest: false })); continue; }
  const files = JSON.parse(fs.readFileSync(manifestPath, "utf8")).files;
  const changed = Object.entries(files).filter(([rel, hash]) => {
    const f = path.join(dir, rel);
    return !fs.existsSync(f) || crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") !== hash;
  }).map(([rel]) => rel);
  console.log(JSON.stringify({ dir, files: Object.keys(files).length, changed }));
}' > "$TMPDIR/gsd-before.jsonl"
cat "$TMPDIR/gsd-before.jsonl"
```

- [ ] **Step 2: Install fvgsd (after approval)**

```bash
node bin/install.js --claude --global
node bin/install.js --codex --global
node bin/install.js --gemini --global
node bin/install.js --opencode --global
```

- [ ] **Step 3: Confirm GSD is untouched and fvgsd is present**

Re-run the Step 1 command into `"$TMPDIR/gsd-after.jsonl"`, then run `diff "$TMPDIR/gsd-before.jsonl" "$TMPDIR/gsd-after.jsonl"`.
Expected: no differences.

Then run `ls ~/.claude/skills | grep -c '^gsd-'` (expected: the same count as before installing, 67 on 2026-09-12) and `ls ~/.claude/skills | grep -c '^fvgsd-'` (expected: greater than 0). Start a Claude Code session and confirm both `/gsd-help` and `/fvgsd-help` are available.

- [ ] **Step 4: Report**

Report the before/after output, the skill counts, and whether both commands loaded. If anything differs, uninstall fvgsd for that runtime (`node bin/install.js --<runtime> --global --uninstall`) and report the difference instead of fixing it on the live machine.
