'use strict';
/**
 * One-shot script + library: bidirectional Vibe GSD command namespace normalizer.
 *
 * - Default direction (transformContent): /gsd-<cmd> or /fvgsd-<cmd> → /fvgsd:<cmd>
 *   (keeps monorepo sources, docs, and workflows in the active Vibe colon form).
 * - Reverse direction (transformContentToHyphen): gsd:<cmd> or fvgsd:<cmd> → fvgsd-<cmd>
 *   (used during skill installation for runtimes that register skills under the
 *   canonical hyphen form established in #2808).
 *
 * Both directions only rewrite known commands from `commands/gsd/*.md` (longest-first
 * matching + word-boundary safety). Non-commands (fvgsd-sdk, fvgsd-tools, etc.) are
 * intentionally left untouched.
 *
 * The transforms are pure and exported for use by the installer and tests.
 */

const fs = require('node:fs');
const path = require('node:path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands', 'gsd');
const SEARCH_DIRS = [
  path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib'),
  path.join(__dirname, '..', 'get-shit-done', 'workflows'),
  path.join(__dirname, '..', 'get-shit-done', 'references'),
  path.join(__dirname, '..', 'get-shit-done', 'templates'),
  path.join(__dirname, '..', 'get-shit-done', 'contexts'),
  path.join(__dirname, '..', 'commands', 'gsd'),
  path.join(__dirname, '..', 'agents'),
  path.join(__dirname, '..', 'hooks'),
];

const TOP_LEVEL_FILES = [
  path.join(__dirname, '..', '.clinerules'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo']);
const EXTENSIONS = new Set(['.md', '.cjs', '.js', '.ts', '.tsx']);

// Test files contain intentional fixture strings (e.g. inputs the sanitizer
// is expected to strip). Rewriting them changes test semantics.
function isTestFile(name) {
  return /\.test\.(c?js|tsx?)$/.test(name);
}

function buildPattern(cmdNames) {
  // Empty input would compile a namespace pattern that still matches an empty
  // command token at a boundary and rewrites it to a stray `/fvgsd:`.
  // Short-circuit so the caller can no-op on a missing/empty registry rather
  // than perform an unintended broad rewrite.
  if (!Array.isArray(cmdNames) || cmdNames.length === 0) return null;
  const sorted = [...cmdNames].sort((a, b) => b.length - a.length); // longest first to avoid partial matches
  return new RegExp(`/(?:fvgsd|gsd)-(${sorted.join('|')})(?=[^a-zA-Z0-9_-]|$)`, 'g');
}

/**
 * Pure transform: rewrite hyphen command references to `/fvgsd:<cmd>` for the given command names.
 * Returns the rewritten string. Identifiers not in `cmdNames` (e.g. `/fvgsd-sdk`,
 * `/fvgsd-tools`) are left untouched.
 */
function transformContent(src, cmdNames) {
  const pattern = buildPattern(cmdNames);
  if (!pattern) return src;
  return src.replace(pattern, (_, cmd) => `/fvgsd:${cmd}`);
}

/**
 * Build regex for the reverse direction (colon form → hyphen form).
 * Matches both legacy "gsd:cmd" and public "fvgsd:cmd" forms (the leading / is preserved automatically
 * because it is not part of the match). Uses longest-first ordering plus
 * bidirectional word-boundary safety (negative lookbehind on the left, lookahead
 * on the right) so matches only occur at token boundaries.
 */
function buildColonPattern(cmdNames) {
  if (!Array.isArray(cmdNames) || cmdNames.length === 0) return null;
  const sorted = [...cmdNames].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![a-zA-Z0-9_-])(?:fvgsd|gsd):(${sorted.join('|')})(?=[^a-zA-Z0-9_-]|$)`, 'g');
}

/**
 * Pure transform (reverse): rewrite colon command references to the public hyphen form
 * for known GSD commands.
 *
 * Non-command identifiers (e.g. fvgsd-sdk, fvgsd-tools) are left untouched, matching
 * the safety contract of the forward transform.
 */
function transformContentToHyphen(src, cmdNames) {
  const pattern = buildColonPattern(cmdNames);
  if (!pattern) return src;
  return src.replace(pattern, (_, cmd) => `fvgsd-${cmd}`);
}

function readCmdNames() {
  return fs.readdirSync(COMMANDS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

function processFile(file, cmdNames) {
  const pattern = buildPattern(cmdNames);
  if (!pattern) return;
  let src;
  try { src = fs.readFileSync(file, 'utf-8'); } catch { return; }
  const replaced = transformContent(src, cmdNames);
  if (replaced !== src) {
    fs.writeFileSync(file, replaced, 'utf-8');
    const count = (src.match(pattern) || []).length;
    console.log(`  ${count} replacements: ${path.relative(path.join(__dirname, '..'), file)}`);
  }
}

function processDir(dir, cmdNames) {
  const pattern = buildPattern(cmdNames);
  if (!pattern) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      processDir(full, cmdNames);
    } else if (EXTENSIONS.has(path.extname(e.name)) && !isTestFile(e.name)) {
      processFile(full, cmdNames);
    }
  }
}

if (require.main === module) {
  const cmdNames = readCmdNames();
  for (const dir of SEARCH_DIRS) {
    processDir(dir, cmdNames);
  }
  for (const file of TOP_LEVEL_FILES) {
    processFile(file, cmdNames);
  }
  console.log('Done.');
}

module.exports = {
  transformContent,
  transformContentToHyphen,
  buildPattern,
  buildColonPattern,
  readCmdNames,
  SKIP_DIRS
};
