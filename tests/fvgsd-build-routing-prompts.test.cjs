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

  test('progress.md routes an unfinalized brief summary to Route A ahead of Route E.3 and Phase complete', () => {
    const section = headingSection(read('progress.md'), '**Step 2: Route based on counts**');
    const rows = tableRows(section).map(([condition, meaning, action]) => ({ condition, meaning, action }));
    const unfinalized = rows.findIndex((row) => row.condition.includes('kind: build-summary'));
    const gaps = rows.findIndex((row) => row.action.includes('Route E.3'));
    const complete = rows.findIndex((row) => row.meaning === 'Phase complete');
    assert.ok(unfinalized !== -1, 'no row names an unfinalized (kind: build-summary) brief summary');
    assert.ok(rows[unfinalized].action.includes('Route A'), 'the unfinalized-summary row must route to Route A');
    assert.ok(gaps !== -1, 'no Route E.3 row');
    assert.ok(complete !== -1, 'no Phase complete row');
    assert.ok(unfinalized < gaps, 'the unfinalized-summary row must precede the Route E.3 row');
    assert.ok(unfinalized < complete, 'the unfinalized-summary row must precede the Phase complete row');
  });

  test('next.md routes an unfinalized brief summary to /fvgsd:build ahead of Route 4b and Route 5', () => {
    const body = stepBody(read('next.md'), 'determine_next_action');
    const route4a = body.indexOf('**Route 4a:');
    const route4b = body.indexOf('**Route 4b:');
    const route5 = body.indexOf('**Route 5:');
    assert.ok(route4a !== -1, 'no route for an unfinalized (kind: build-summary) brief summary');
    assert.ok(route4b !== -1, 'no Route 4b');
    assert.ok(route5 !== -1, 'no Route 5');
    assert.ok(route4a < route4b, 'the unfinalized-summary route must precede Route 4b');
    assert.ok(route4a < route5, 'the unfinalized-summary route must precede Route 5');
    const route4aBlock = body.slice(route4a, route4b);
    assert.ok(route4aBlock.includes('kind: build-summary'), 'the route must name kind: build-summary');
    assert.ok(route4aBlock.includes('/fvgsd:build'), 'the route must point to /fvgsd:build');
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
