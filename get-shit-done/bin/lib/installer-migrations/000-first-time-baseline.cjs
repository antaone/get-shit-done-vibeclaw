'use strict';

const fs = require('fs');
const path = require('path');
const IDENTITY = require('../identity.cjs');

const BASELINE_MIGRATION_ID = '2026-05-11-first-time-baseline-scan';

// Runtime install surfaces must stay aligned with:
// - docs/installer-migrations.md#runtime-configuration-contract-registry
// - docs/ARCHITECTURE.md#runtime-install-contract-matrix
//
// The registry rows are based on each runtime's upstream loader docs where
// available. Source-limited rows are intentionally conservative: scan generated
// files GSD materializes, but do not infer ownership of undocumented host config.
//
// The config dir can also hold other installs next to this one, so only this
// install's own surfaces are scanned: its install folder, its commands and hooks
// folders, and inside the shared skills/, agents/ and command/ folders only
// entries carrying its own prefix (isOwnSurfacePath).
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
const INTERNAL_TOP_LEVEL_NAMES = new Set([
  IDENTITY.manifestFile,
  IDENTITY.installStateFile,
  'fvgsd-migration-backups',
  IDENTITY.migrationJournalDir,
]);
const USER_OWNED_PATHS = new Set([
  `${IDENTITY.installDir}/USER-PROFILE.md`,
  `${OWN_COMMANDS}/dev-preferences.md`,
  `skills/${IDENTITY.commandPrefix}-dev-preferences/SKILL.md`,
]);
const OWN_NAME_PATTERN = new RegExp(`^${IDENTITY.commandPrefix}[-_]`);
let knownGeneratedAgentNames = null;

function normalizeRelPath(relPath) {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function baselineInstallSurfaces(runtime) {
  if (runtime && RUNTIME_SURFACES[runtime]) return RUNTIME_SURFACES[runtime];
  return COMMON_SURFACES;
}

function walkFiles(root, relDir, files) {
  const dir = path.join(root, relDir);
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = path.posix.join(relDir, entry.name);
    if (relDir === '' && INTERNAL_TOP_LEVEL_NAMES.has(entry.name)) continue;
    const fullPath = path.join(root, relPath);
    if (entry.isDirectory()) {
      walkFiles(root, relPath, files);
    } else if (entry.isFile()) {
      files.add(normalizeRelPath(relPath));
    }
  }
}

// skills/, agents/ and command/ are shared with other installs and the user;
// only entries carrying this install's prefix belong to it. Every other scanned
// surface is this install's own folder or a config file it writes into.
function isOwnSurfacePath(relPath) {
  const [top, second, third] = relPath.split('/');
  if (top === 'skills') return Boolean(second) && (second.startsWith(`${IDENTITY.commandPrefix}-`) || (second === IDENTITY.commandPrefix && Boolean(third)));
  if (top === 'agents') return Boolean(second) && second.startsWith(IDENTITY.agentPrefix);
  if (top === 'command') return Boolean(second) && second.startsWith(`${IDENTITY.commandPrefix}-`);
  return true;
}

function scanBaselineFiles(configDir, runtime) {
  const relPaths = new Set();
  for (const surface of baselineInstallSurfaces(runtime)) {
    const normalized = normalizeRelPath(surface);
    const fullPath = path.join(configDir, normalized);
    if (!fs.existsSync(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(configDir, normalized, relPaths);
    } else if (stat.isFile() && !INTERNAL_TOP_LEVEL_NAMES.has(normalized)) {
      relPaths.add(normalized);
    }
  }
  return [...relPaths].filter(isOwnSurfacePath);
}

function isUserOwnedBaselinePath(relPath) {
  return USER_OWNED_PATHS.has(relPath);
}

function listKnownGeneratedAgentNames() {
  if (knownGeneratedAgentNames) return knownGeneratedAgentNames;

  knownGeneratedAgentNames = new Set();
  const agentsDir = path.resolve(__dirname, '..', '..', '..', '..', 'agents');
  try {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith('fvgsd-') && entry.name.endsWith('.md')) {
        knownGeneratedAgentNames.add(entry.name.replace(/\.md$/, ''));
      }
    }
  } catch {
    // If the source agent directory is unavailable, fail closed and treat
    // GSD-looking agent files as user-choice artifacts.
  }

  return knownGeneratedAgentNames;
}

function isKnownGeneratedAgentPath(relPath, runtime) {
  const parts = relPath.split('/');
  if (parts.length !== 2 || parts[0] !== 'agents') return false;
  const fileName = parts[1];
  const extension = path.posix.extname(fileName);
  if (extension !== '.md' && !(runtime === 'codex' && extension === '.toml')) return false;

  const agentName = fileName.slice(0, -extension.length);
  return listKnownGeneratedAgentNames().has(agentName);
}

// Looks like a file this install generated: named with its prefix, inside a
// prefixed skills/ or agents/ entry, or anywhere under its hooks folder (hook
// files there carry no name prefix).
function isStaleGsdLookingPath(relPath) {
  if (relPath.startsWith(`${OWN_HOOKS}/`)) return true;
  if (OWN_NAME_PATTERN.test(path.posix.basename(relPath))) return true;
  const [top, second] = relPath.split('/');
  return (top === 'skills' || top === 'agents') && Boolean(second) && second.startsWith(`${IDENTITY.commandPrefix}-`);
}

function baselineActionRank(action) {
  if (action.type === 'record-baseline') return 0;
  if (action.type === 'baseline-preserve-user') return 1;
  return 2;
}

module.exports = {
  id: BASELINE_MIGRATION_ID,
  title: 'Record first-time installer migration baseline',
  description: 'Classify existing install surfaces before destructive installer migrations run.',
  introducedIn: '1.50.0',
  scopes: ['global', 'local'],
  destructive: false,
  plan: ({ configDir, runtime, baselineScan, classifyArtifact }) => {
    if (!baselineScan) return [];

    const actions = [];
    for (const relPath of scanBaselineFiles(configDir, runtime)) {
      // docs/installer-migrations.md#baseline-preserve-user keeps user-owned
      // artifacts out of destructive migration flow; classify later only when
      // ownership is not already known.
      if (isUserOwnedBaselinePath(relPath)) {
        actions.push({
          type: 'baseline-preserve-user',
          relPath,
          reason: 'known user-owned artifact preserved by first-time migration baseline',
          classification: 'user-owned',
          originalHash: null,
          currentHash: null,
        });
        continue;
      }

      const artifact = classifyArtifact(relPath);
      if (artifact.classification === 'managed-pristine' || artifact.classification === 'managed-modified') {
        actions.push({
          type: 'record-baseline',
          relPath,
          reason: 'existing manifest-managed file included in first-time migration baseline',
        });
        continue;
      }

      const currentHash = artifact.currentHash;
      if (isKnownGeneratedAgentPath(relPath, runtime)) {
        actions.push({
          type: 'record-baseline',
          relPath,
          reason: 'known installer-generated agent included in first-time migration baseline',
          classification: artifact.classification,
          originalHash: artifact.originalHash,
          currentHash,
        });
        continue;
      }

      if (isStaleGsdLookingPath(relPath)) {
        actions.push({
          type: 'prompt-user',
          relPath,
          reason: 'GSD-looking file is not proven manifest-managed and needs explicit user choice',
          classification: 'stale-gsd-looking',
          originalHash: artifact.originalHash,
          currentHash,
          prompt: 'Choose whether to remove this stale-looking GSD artifact or keep it as user-owned.',
          choices: ['keep', 'remove'],
        });
        continue;
      }

      actions.push({
        type: 'baseline-preserve-user',
        relPath,
        reason: 'unknown install-surface file preserved by first-time migration baseline',
        classification: artifact.classification,
        originalHash: artifact.originalHash,
        currentHash,
      });
    }

    return actions.sort((left, right) =>
      baselineActionRank(left) - baselineActionRank(right) || left.relPath.localeCompare(right.relPath)
    );
  },
};
