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
