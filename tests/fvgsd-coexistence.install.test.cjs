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
const { spawnSync } = require('node:child_process');

const { INSTALL_SCRIPT, RUNTIME_META, installerEnv, runMinimalInstall } = require('./helpers/install-shared.cjs');
const { FOREIGN_MARKERS, seedForeignInstalls, listFiles, snapshot } = require('./helpers/foreign-installs.cjs');
const MATCHERS = require('./fixtures/foreign-installer-matchers.json');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const installer = require('../bin/install.js');

// Shared files fvgsd also writes into. STRUCTURED ones are compared by parsed
// content; SHARED_TEXT ones by the bytes of the foreign region after install and
// by the whole file's bytes after uninstall.
const STRUCTURED = new Set(['settings.json', 'hooks.json', 'opencode.json', 'kilo.json', 'gsd-file-manifest.json', 'config.toml']);
const SHARED_TEXT = new Set(['config.toml', 'copilot-instructions.md']);

function runInstaller(runtime, root, configDir, extra = []) {
  const r = spawnSync(process.execPath, [INSTALL_SCRIPT, `--${runtime}`, '--global', '--config-dir', configDir, ...extra], {
    cwd: root,
    encoding: 'utf8',
    env: installerEnv({ HOME: root, USERPROFILE: root }),
  });
  assert.equal(r.status, 0, `${runtime} ${extra.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
}

function readText(configDir, rel) {
  return fs.readFileSync(path.join(configDir, rel), 'utf8');
}

function parsed(configDir, rel) {
  const text = readText(configDir, rel);
  return rel === 'config.toml' ? installer.parseTomlToObject(text) : JSON.parse(text);
}

// The text from `open` through `close`, or through the end of the file when no
// close marker is given; null when a marker is missing.
function region(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  if (!close) return text.slice(start);
  const end = text.indexOf(close, start);
  return end === -1 ? null : text.slice(start, end + close.length);
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
    test(`${runtime}: install and uninstall leave gsd and vgsd untouched`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `${IDENTITY.tempPrefix}coexist-${runtime}-`));
      try {
        const configDir = path.join(root, 'config');
        const seeded = seedForeignInstalls(configDir, runtime);
        const plain = seeded.filter((rel) => !STRUCTURED.has(rel) && !SHARED_TEXT.has(rel));
        const before = {
          files: listFiles(configDir),
          hashes: snapshot(configDir, plain),
          parsed: Object.fromEntries(seeded.filter((rel) => STRUCTURED.has(rel)).map((rel) => [rel, parsed(configDir, rel)])),
          text: Object.fromEntries(seeded.filter((rel) => SHARED_TEXT.has(rel)).map((rel) => [rel, readText(configDir, rel)])),
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
          const configText = readText(configDir, 'config.toml');
          const config = installer.parseTomlToObject(configText);
          const seededConfig = before.parsed['config.toml'];
          assert.equal(
            region(configText, FOREIGN_MARKERS.codexConfig),
            region(before.text['config.toml'], FOREIGN_MARKERS.codexConfig),
            'codex: install changed config.toml from the GSD marker to the end of the file',
          );
          for (const key of ['model', 'features', 'profiles']) {
            assert.deepEqual(config[key], seededConfig[key], `codex: install changed config.toml ${key}`);
          }
          assert.deepEqual(config.agents['gsd-planner'], seededConfig.agents['gsd-planner']);
          owned.push(...Object.keys(config.agents).filter((name) => name !== 'gsd-planner').map((name) => `agents.${name}`));
          const layout = installer.codexConfigLayout(configText);
          const gsdMarker = layout.markers.find((marker) => marker.owner === 'gsd');
          const ownSections = layout.agentSections.filter((section) => section.name.startsWith(IDENTITY.agentPrefix));
          assert.equal(ownSections.length > 0, true);
          for (const section of ownSections) assert.equal(section.line < gsdMarker.line, true, `${section.name} is below the GSD marker`);
          const hooksJsonCommands = hookCommands(parsed(configDir, 'hooks.json'));
          for (const command of hookCommands(before.parsed['hooks.json'])) {
            assert.equal(hooksJsonCommands.includes(command), true, `hooks.json lost ${command}`);
          }
        }

        if (runtime === 'copilot') {
          const instructions = readText(configDir, 'copilot-instructions.md');
          assert.equal(instructions.includes(IDENTITY.copilotInstructionsMarker), true, 'copilot: install wrote no fvgsd block to copilot-instructions.md');
          assert.equal(
            region(instructions, FOREIGN_MARKERS.copilotOpen, FOREIGN_MARKERS.copilotClose),
            region(before.text['copilot-instructions.md'], FOREIGN_MARKERS.copilotOpen, FOREIGN_MARKERS.copilotClose),
            "copilot: install changed upstream's block in copilot-instructions.md",
          );
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
          assert.deepEqual(parsed(configDir, rel), value, `${runtime}: ${rel} differs after uninstall`);
        }
        for (const [rel, text] of Object.entries(before.text)) {
          assert.equal(readText(configDir, rel), text, `${runtime}: ${rel} is not byte-identical after uninstall`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

// allow-test-rule: source-text-is-the-product
// Agent/workflow/reference .md files are the installed AI instructions — their
// text content IS what an executing agent reads and follows. Parsing out the
// file references a shipped prompt points at, and checking each one resolves
// on disk, tests the deployed contract (does the hint land on fvgsd's own
// installed copy), not an implementation-internal string literal.
describe('shipped prompt references anchor into the installed fvgsd folder', () => {
  test('install-relative get-shit-done/... references resolve under the installed fvgsd tree', () => {
    const { configDir, root } = runMinimalInstall({ runtime: 'claude', scope: 'global' });
    try {
      // `runMinimalInstall` (scope: 'global') passes the same temp dir as both
      // HOME and --config-dir, so bin/install.js's computePathPrefix() collapses
      // to the literal string "$HOME/" — i.e. `$HOME/<segment>` in installed
      // content resolves to `path.join(configDir, <segment>)` on this disk.
      const ANCHORED_REF = new RegExp(`\\$HOME/${IDENTITY.installDir}/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*`, 'g');

      // Installed location (relative to configDir) for every shipped file this
      // fix touches, and the minimum count of anchored fvgsd references each
      // must carry once the fix lands (pre-existing anchors + the ones the fix
      // adds). This is the non-vacuous guard: today's bare `get-shit-done/...`
      // mentions aren't anchored yet, so several counts below are not yet met.
      const CHECKS = [
        { installed: ['agents', `${IDENTITY.agentPrefix}planner.md`], minRefs: 22 },
        { installed: ['skills', `${IDENTITY.commandPrefix}-surface`, 'SKILL.md'], minRefs: 4 },
        { installed: [IDENTITY.installDir, 'workflows', 'autonomous.md'], minRefs: 2 },
        { installed: [IDENTITY.installDir, 'workflows', 'plan-phase.md'], minRefs: 13 },
        { installed: [IDENTITY.installDir, 'workflows', 'settings-integrations.md'], minRefs: 1 },
        { installed: [IDENTITY.installDir, 'workflows', 'execute-phase.md'], minRefs: 16 },
        { installed: [IDENTITY.installDir, 'workflows', 'ingest-docs.md'], minRefs: 3 },
        { installed: [IDENTITY.installDir, 'workflows', 'code-review.md'], minRefs: 1 },
        { installed: [IDENTITY.installDir, 'workflows', 'help', 'modes', 'full.md'], minRefs: 1 },
        { installed: [IDENTITY.installDir, 'references', 'planner-graphify-auto-update.md'], minRefs: 2 },
        { installed: [IDENTITY.installDir, 'references', 'mvp-concepts.md'], minRefs: 1 },
      ];

      // Collected across every file and asserted once, so a failing run names
      // every file that falls short and every reference that doesn't resolve.
      const shortfalls = [];
      const unresolved = [];
      for (const { installed, minRefs } of CHECKS) {
        const label = installed.join('/');
        const abs = path.join(configDir, ...installed);
        if (!fs.existsSync(abs)) {
          shortfalls.push({ file: label, minRefs, found: 'installed copy missing' });
          continue;
        }

        const content = fs.readFileSync(abs, 'utf8');
        // Strip a single trailing '.' — sentence-ending punctuation right after
        // a file extension (e.g. "...tdd.md.") is not part of the path.
        const refs = (content.match(ANCHORED_REF) || []).map((ref) => ref.replace(/\.$/, ''));
        if (refs.length < minRefs) shortfalls.push({ file: label, minRefs, found: refs.length, refs });

        for (const ref of refs) {
          const relParts = ref.slice('$HOME/'.length).split('/');
          if (!fs.existsSync(path.join(configDir, ...relParts))) unresolved.push({ file: label, ref });
        }
      }
      assert.deepEqual(shortfalls, [], 'installed files with fewer anchored fvgsd references than expected');
      assert.deepEqual(unresolved, [], 'anchored fvgsd references that do not resolve to a real file');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
