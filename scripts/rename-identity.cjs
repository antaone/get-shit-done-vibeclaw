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
 *
 * Every rule also skips text between a line containing `rename-identity:off`
 * and a line containing `rename-identity:on` (R48). This lets prose that
 * intentionally names the legacy `/gsd-*` and `/vgsd-*` prefixes — e.g. the
 * README section explaining fvgsd's coexistence with upstream GSD and
 * VibeClaw vgsd — stay stable across a re-run instead of being rewritten
 * into fvgsd. The marker lines themselves are part of the protected region,
 * so they are never rewritten either.
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

// fvgsd's agent name is the upstream `gsd-<role>` name with this prefix. The
// text rule, the file rename and the renamed-layout name scan all go through it.
const FORK_AGENT_PREFIX = 'fv';

function fvgsdAgentName(upstreamName) {
  return `${FORK_AGENT_PREFIX}${upstreamName}`;
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
    rules.push(tokenRule('agent-names', role, fvgsdAgentName(role)));
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
  rules.push({ id: 'vibe-paths', pattern: /(?<![A-Za-z0-9_.-])\.vibe(?![A-Za-z0-9_-])/g, replace: () => '.fvgsd-vibe' });
  rules.push({ id: 'profile-markers', pattern: /(?<![A-Za-z])GSD:profile-(start|end)/g, replace: (match, edge) => `FVGSD:profile-${edge}` });
  rules.push({ id: 'env-vars', pattern: /(?<![A-Za-z0-9_])GSD_([A-Z0-9_]+)/g, replace: (match, rest) => `FVGSD_${rest}` });
  rules.push({ id: 'code-literals', codeOnly: true, pattern: /(['"`])gsd-(?!build\/)/g, replace: (match, quote) => `${quote}fvgsd-` });
  rules.push({ id: 'code-literals', codeOnly: true, pattern: /\^gsd-/g, replace: () => '^fvgsd-' });
  rules.push({ id: 'code-literals', codeOnly: true, pattern: /agents(\\?\.)gsd-/g, replace: (match, dot) => `agents${dot}fvgsd-` });
  rules.push({ id: 'code-literals', codeOnly: true, pattern: /\\bgsd-/g, replace: () => '\\bfvgsd-' });
  rules.push({ id: 'prefix-globs', pattern: /(hooks\/(?:dist\/)?)gsd-\*/g, replace: (match, prefix) => `${prefix}fvgsd/*` });
  rules.push({ id: 'prefix-globs', pattern: /(?<![A-Za-z0-9_-])gsd-\*/g, replace: () => 'fvgsd-*' });
  return rules;
}

const RENAME_IDENTITY_OFF = 'rename-identity:off';
const RENAME_IDENTITY_ON = 'rename-identity:on';

// Splits text into alternating segments so rules can be applied to the
// "active" segments only. A segment is "protected" once a line containing
// RENAME_IDENTITY_OFF is seen, up to and including the next line containing
// RENAME_IDENTITY_ON — including the same line, when both markers appear on
// one line (#M5). The split is on line boundaries only (keeping each line's
// own terminator, LF or CRLF, attached to that line) so byte-for-byte
// reassembly is exact.
//
// Fails closed (throws) on an unterminated region — a `:off` with no
// matching `:on` before end of file — rather than silently protecting
// everything after it. A dry run is used as a rename-safety gate (R48), so
// silently reporting empty totals for an unterminated region would hide the
// exact problem the gate exists to catch (#M5).
function splitProtectedRegions(text) {
  const lines = text.split(/(?<=\n)/);
  const segments = [];
  let current = [];
  let protectedRegion = false;
  for (const line of lines) {
    if (!protectedRegion && line.includes(RENAME_IDENTITY_OFF)) {
      if (current.length) segments.push({ protected: false, text: current.join('') });
      current = [];
      const offIndex = line.indexOf(RENAME_IDENTITY_OFF);
      const onIndex = line.indexOf(RENAME_IDENTITY_ON, offIndex);
      if (onIndex !== -1) {
        // Both markers on one line: a self-contained protected segment.
        // Stay unprotected for whatever follows on the next line.
        segments.push({ protected: true, text: line });
        continue;
      }
      current.push(line);
      protectedRegion = true;
      continue;
    }
    if (protectedRegion && line.includes(RENAME_IDENTITY_ON)) {
      current.push(line);
      segments.push({ protected: true, text: current.join('') });
      current = [];
      protectedRegion = false;
      continue;
    }
    current.push(line);
  }
  if (protectedRegion) {
    throw new Error(
      `rename-identity: unterminated "${RENAME_IDENTITY_OFF}" region — ` +
      `no matching "${RENAME_IDENTITY_ON}" line before end of file`,
    );
  }
  if (current.length) segments.push({ protected: false, text: current.join('') });
  return segments;
}

function rewriteText(text, rules, { isCode }) {
  const replacements = [];
  const next = splitProtectedRegions(text).map((segment) => {
    if (segment.protected) return segment.text;
    let segmentText = segment.text;
    for (const rule of rules) {
      if (rule.codeOnly && !isCode) continue;
      segmentText = segmentText.replace(rule.pattern, (...args) => {
        const replacement = rule.replace(...args);
        replacements.push({ ruleId: rule.id, match: args[0], replacement });
        return replacement;
      });
    }
    return segmentText;
  }).join('');
  return { text: next, replacements };
}

function renamedPath(relPath) {
  const parts = relPath.split('/');
  if (parts.length === 2 && parts[0] === 'agents' && /^gsd-.+\.md$/.test(parts[1])) return `agents/${fvgsdAgentName(parts[1])}`;
  if (parts.length === 2 && parts[0] === 'hooks' && /^gsd-.+\.(?:js|sh)$/.test(parts[1])) {
    return `hooks/fvgsd/${parts[1].slice('gsd-'.length)}`;
  }
  if (parts.length === 3 && parts[0] === 'hooks' && parts[1] === 'lib') return `hooks/fvgsd/lib/${parts[2].replace(/^gsd-/, '')}`;
  if (relPath === 'get-shit-done/bin/gsd-tools.cjs') return 'get-shit-done/bin/fvgsd-tools.cjs';
  if (relPath === 'bin/gsd-sdk.js') return 'bin/fvgsd-sdk.js';
  if (relPath === 'sdk/src/gsd-tools.ts') return 'sdk/src/fvgsd-tools.ts';
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

// Upstream agent, hook and helper names, read from the source tree in either
// layout. After the first run the tree only has the renamed layout, and an
// upstream merge still brings in upstream text, so both are needed for a re-run:
//   agents/gsd-<role>.md   or agents/fvgsd-<role>.md      -> gsd-<role>
//   hooks/gsd-<hook>.js    or hooks/fvgsd/<hook>.js       -> gsd-<hook>
//   hooks/lib/gsd-<h>.sh   or hooks/fvgsd/lib/<h>.sh      -> gsd-<h>
// A renamed helper that never had the prefix (git-cmd.js) yields a gsd- name
// that no text uses, so its rule never fires.
function upstreamNames(root) {
  const upstreamFile = /^gsd-.+\.(?:js|sh)$/;
  const hookFile = /\.(?:js|sh)$/;
  const unique = (names) => [...new Set(names)];
  return {
    agentRoles: unique([
      ...namesFrom(root, 'agents', /^gsd-.+\.md$/),
      ...namesFrom(root, 'agents', /^fvgsd-.+\.md$/).map((name) => name.slice(FORK_AGENT_PREFIX.length)),
    ]),
    hookNames: unique([
      ...namesFrom(root, 'hooks', upstreamFile),
      ...namesFrom(root, path.join('hooks', 'fvgsd'), hookFile).map((name) => `gsd-${name}`),
    ]),
    helperNames: unique([
      ...namesFrom(root, path.join('hooks', 'lib'), upstreamFile),
      ...namesFrom(root, path.join('hooks', 'fvgsd', 'lib'), hookFile).map((name) => `gsd-${name}`),
    ]),
  };
}

function run({ root, dryRun }) {
  const exclude = MAP.exclude.map(globToRegExp);
  const rules = buildRules(upstreamNames(root));
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
