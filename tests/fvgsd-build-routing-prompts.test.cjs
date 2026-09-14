// allow-test-rule: source-text-is-the-product
// Workflow .md files are loaded verbatim by the runtime; their routing tables,
// handler headings and Skill() calls are the deployed routing contract.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOWS = path.join(__dirname, '..', 'get-shit-done', 'workflows');

function read(relPath) {
  return fs.readFileSync(path.join(WORKFLOWS, relPath), 'utf8');
}

function stepBody(content, name) {
  const match = content.match(new RegExp(`<step name="${name}"[^>]*>([\\s\\S]*?)</step>`));
  assert.ok(match, `step ${name} not found`);
  return match[1];
}

function tableRows(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
    .slice(1)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

function headingSection(content, heading) {
  const lines = content.split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start !== -1, `${heading} not found`);
  const end = lines.findIndex((line, index) => index > start && /^#{1,3} /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

describe('workflow prompts route discussed phases to /fvgsd-build', () => {
  test('do.md routes "build phase N" to /fvgsd:build before plan-phase', () => {
    const rows = tableRows(stepBody(read('do.md'), 'route'))
      .map(([intent, route]) => ({ intent, route: route.replace(/`/g, '') }));
    const build = rows.findIndex((row) => row.route === '/fvgsd:build');
    const plan = rows.findIndex((row) => row.route === '/fvgsd:plan-phase');
    assert.ok(build !== -1, 'no /fvgsd:build row');
    assert.ok(build < plan, 'the /fvgsd:build row must precede the plan-phase row');
    const execute = rows.find((row) => row.route === '/fvgsd:execute-phase');
    assert.ok(!/build phase/i.test(execute.intent), 'the execute-phase row still claims "build phase N"');
  });

  test('manager.md has a Build Phase N handler that runs the build skill', () => {
    const section = headingSection(read('manager.md'), '### Build Phase N');
    assert.ok(section.includes('Skill(skill=\\"fvgsd-build\\"'));
  });

  test('chain mode and autonomous mode launch the build skill', () => {
    assert.ok(read(path.join('discuss-phase', 'modes', 'chain.md')).includes('Skill(skill="fvgsd-build"'));
    assert.ok(read('autonomous.md').includes('Skill(skill="fvgsd-build"'));
  });

  test('execute-phase stops before running a build brief', () => {
    const body = stepBody(read('execute-phase.md'), 'initialize');
    assert.ok(body.includes('was started with /fvgsd-build — run /fvgsd-build ${PHASE_ARG} to resume.'));
  });
});
