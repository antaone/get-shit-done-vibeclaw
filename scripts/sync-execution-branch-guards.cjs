#!/usr/bin/env node
'use strict';

/**
 * Keep the execution-branch preflight embedded in every public vgsd command.
 *
 * Commands are the only portable interception point shared by Claude Code,
 * Gemini CLI, Codex, and the other installer targets. The installer already
 * rewrites ~/.claude paths for each runtime, so the canonical guard lives in
 * commands/gsd and travels with every converted command/skill.
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const commandDir = path.join(repoRoot, 'commands', 'gsd');
const checkOnly = process.argv.includes('--check');
const marker = '<execution_branch_guard>';
const problems = [];
let changed = 0;

function guard(command, newline) {
  const action = command === 'help' || command === 'vibe' ? 'inspect' : 'ensure';
  return [
    '<execution_branch_guard>',
    'Before reading execution context, invoking another skill, or changing project state, run:',
    `\`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch ${action} "${command}" --runtime __VGSD_RUNTIME__\``,
    '',
    'Parse the JSON response:',
    '- Continue only when `allowed` is `true`.',
    '- If `allowed` is `false`, stop and show its `message` and `hint`.',
    '- If the hint names `vgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.',
    '- If `action` is `created` or `adopted`, tell the user which `branch` is active once.',
    '- For `reused` or `inspected`, continue silently.',
    '</execution_branch_guard>',
    '',
    '',
  ].join(newline);
}

for (const name of fs.readdirSync(commandDir).filter((entry) => entry.endsWith('.md')).sort()) {
  const filePath = path.join(commandDir, name);
  const command = name.slice(0, -3);
  const original = fs.readFileSync(filePath, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let content = original;

  if (!content.startsWith(`---${newline}`)) {
    problems.push(`${name}: missing YAML frontmatter`);
    continue;
  }

  const frontmatterEnd = content.indexOf(`${newline}---${newline}`, 4);
  if (frontmatterEnd === -1) {
    problems.push(`${name}: unterminated YAML frontmatter`);
    continue;
  }

  const frontmatter = content.slice(0, frontmatterEnd + newline.length + 3);
  if (!/(?:^|\r?\n)\s+- Bash\s*(?:\r?\n|$)/.test(frontmatter)) {
    const withBash = frontmatter.replace(
      /(^allowed-tools:\r?\n(?:\s{2}- [^\r\n]+\r?\n)*)/m,
      (block) => `${block}  - Bash${newline}`,
    );
    if (withBash === frontmatter) {
      problems.push(`${name}: cannot add Bash to allowed-tools`);
      continue;
    }
    content = withBash + content.slice(frontmatter.length);
  }

  const expectedGuard = guard(command, newline);
  if (!content.includes(marker)) {
    const end = content.indexOf(`${newline}---${newline}`, 4) + newline.length + 3 + newline.length;
    content = content.slice(0, end) + expectedGuard + content.slice(end);
  } else {
    content = content.replace(
      /<execution_branch_guard>[\s\S]*?<\/execution_branch_guard>\r?\n*/,
      expectedGuard,
    );
  }

  if (content !== original) {
    changed += 1;
    if (!checkOnly) fs.writeFileSync(filePath, content, 'utf8');
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exitCode = 1;
} else if (checkOnly && changed > 0) {
  process.stderr.write(`${changed} vgsd command guard(s) are out of date. Run node scripts/sync-execution-branch-guards.cjs.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(checkOnly
    ? 'All vgsd execution-branch guards are synchronized.\n'
    : `Synchronized ${changed} vgsd execution-branch guard(s).\n`);
}
