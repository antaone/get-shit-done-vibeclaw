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
    copilotInstructionsMarker: '<!-- FVGSD Configuration — managed by fvgsd installer -->',
    copilotInstructionsCloseMarker: '<!-- /FVGSD Configuration -->',
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

test('runtime formatter and artifact layout derive from the identity', () => {
  const { formatGsdSlash } = require('../get-shit-done/bin/lib/runtime-slash.cjs');
  const { resolveRuntimeArtifactLayout } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
  assert.equal(formatGsdSlash('help 1', 'claude'), `/${IDENTITY.commandPrefix}-help 1`);
  assert.equal(formatGsdSlash('help', 'gemini'), `/${IDENTITY.commandPrefix}:help`);
  assert.equal(formatGsdSlash('/vgsd:help', 'codex'), `$${IDENTITY.commandPrefix}-help`);
  assert.equal(formatGsdSlash('vgsd-help', 'claude'), `/${IDENTITY.commandPrefix}-help`);
  assert.equal(formatGsdSlash('$VGSD-help', 'gemini'), `/${IDENTITY.commandPrefix}:help`);
  const layout = resolveRuntimeArtifactLayout('claude', '/tmp/fvgsd-layout', 'local');
  assert.deepEqual(layout.kinds.map((kind) => [kind.kind, kind.prefix, kind.destSubpath]), [
    ['commands', `${IDENTITY.commandPrefix}-`, `commands/${IDENTITY.commandPrefix}`],
    ['agents', IDENTITY.agentPrefix, 'agents'],
  ]);
});
