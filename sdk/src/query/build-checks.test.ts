import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildRunChecks, checksDetect, detectChecks, readLatestChecks, type RunChecksData } from './build-checks.js';

const NODE = JSON.stringify(process.execPath);
const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-checks-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function files(dir: string, entries: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(entries)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
}

async function repoWithConfig(workflow: Record<string, unknown>): Promise<string> {
  const dir = await tempDir();
  await files(dir, { '.planning/config.json': JSON.stringify({ workflow }) });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

async function run(dir: string, args: string[]): Promise<RunChecksData> {
  return (await buildRunChecks(args, dir)).data as RunChecksData;
}

describe('detectChecks', () => {
  it('reads npm scripts', async () => {
    const dir = await tempDir();
    await files(dir, { 'package.json': JSON.stringify({ scripts: { build: 'tsc', typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'vitest' } }) });
    expect(detectChecks(dir, {})).toEqual({
      build: 'npm run build', typecheck: 'npm run typecheck', lint: 'npm run lint', test: 'npm test',
      sources: { build: 'detected', typecheck: 'detected', lint: 'detected', test: 'detected' },
    });
  });

  it('uses type-check, and npm test without a build script', async () => {
    const dir = await tempDir();
    await files(dir, { 'package.json': JSON.stringify({ scripts: { 'type-check': 'tsc' } }), 'tsconfig.json': '{}' });
    const checks = detectChecks(dir, {});
    expect([checks.build, checks.typecheck, checks.lint, checks.test]).toEqual([null, 'npm run type-check', null, 'npm test']);
  });

  it('falls back to tsc when only tsconfig.json exists', async () => {
    const dir = await tempDir();
    await files(dir, { 'tsconfig.json': '{}' });
    expect(detectChecks(dir, {}).typecheck).toBe('npx tsc --noEmit');
  });

  it('uses Makefile targets and ignores commented ones', async () => {
    const dir = await tempDir();
    await files(dir, { Makefile: 'build:\n\tcc\ntest:\n\t./t\nlint:\n\tl\ntypecheck:\n\tc\n' });
    expect(detectChecks(dir, {})).toMatchObject({ build: 'make build', typecheck: 'make typecheck', lint: 'make lint', test: 'make test' });
    const commented = await tempDir();
    await files(commented, { Makefile: '# build:\n# test:\n' });
    expect(detectChecks(commented, {})).toMatchObject({ build: null, test: null });
  });

  it('uses just for build and test, and only existing lint or typecheck recipes', async () => {
    const dir = await tempDir();
    await files(dir, { justfile: 'lint:\n  echo lint\n' });
    expect(detectChecks(dir, {})).toMatchObject({ build: 'just build', test: 'just test', lint: 'just lint', typecheck: null });
  });

  it('detects Go and Cargo projects', async () => {
    const go = await tempDir();
    await files(go, { 'go.mod': 'module example.com/x\n' });
    expect(detectChecks(go, {})).toMatchObject({ build: 'go build ./...', test: 'go test ./...', lint: 'go vet ./...', typecheck: null });
    const cargo = await tempDir();
    await files(cargo, { 'Cargo.toml': '[package]\nname = "x"\n' });
    expect(detectChecks(cargo, {})).toMatchObject({ build: 'cargo build', test: 'cargo test', lint: 'cargo clippy', typecheck: null });
  });

  it('detects Python and only proposes ruff and mypy when configured', async () => {
    const dir = await tempDir();
    await files(dir, {
      'pyproject.toml': '[tool.ruff]\nline-length = 100\n[tool.mypy]\nstrict = true\n',
      'src/app.py': 'x = 1\n',
      'tests/test_app.py': 'y = 2\n',
      '.venv/lib.py': '',
      'node_modules/pkg/x.py': '',
      '.planning/notes.py': '',
    });
    expect(detectChecks(dir, {})).toMatchObject({
      build: "python -m py_compile 'src/app.py' 'tests/test_app.py'",
      test: 'python -m pytest -x -q --tb=short || uv run python -m pytest -x -q --tb=short',
      lint: 'ruff check .',
      typecheck: 'mypy .',
    });
    const plain = await tempDir();
    await files(plain, { 'requirements.txt': 'requests\n' });
    expect(detectChecks(plain, {})).toMatchObject({ lint: null, typecheck: null, test: 'python -m pytest -x -q --tb=short || uv run python -m pytest -x -q --tb=short' });
  });

  it('detects Xcode with and without a scheme', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'App.xcodeproj'), { recursive: true });
    const destination = "-destination 'platform=iOS Simulator,name=iPhone 16'";
    expect(detectChecks(dir, {}, { listXcodeSchemes: () => ["My'App"] })).toMatchObject({
      build: `xcodebuild build -scheme 'My'\\''App' ${destination}`,
      test: `xcodebuild test -scheme 'My'\\''App' ${destination}`,
    });
    expect(detectChecks(dir, {}, { listXcodeSchemes: () => [] })).toMatchObject({
      build: `xcodebuild build ${destination}`,
      test: `xcodebuild test ${destination}`,
    });
  });

  it('lets configured commands win and ignores blank ones', async () => {
    const dir = await tempDir();
    await files(dir, { 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) });
    const checks = detectChecks(dir, { build_command: 'make all', test_command: '   ', lint_command: 'lint-it', typecheck_command: 42 });
    expect(checks).toMatchObject({ build: 'make all', test: 'npm test', lint: 'lint-it', typecheck: null });
    expect(checks.sources).toEqual({ build: 'config', typecheck: 'none', lint: 'config', test: 'detected' });
  });

  it('returns nulls for an empty directory and tolerates malformed package.json', async () => {
    const empty = await tempDir();
    expect(detectChecks(empty, {})).toEqual({
      build: null, typecheck: null, lint: null, test: null,
      sources: { build: 'none', typecheck: 'none', lint: 'none', test: 'none' },
    });
    const broken = await tempDir();
    await files(broken, { 'package.json': '{not json' });
    expect(detectChecks(broken, {})).toMatchObject({ build: null, test: 'npm test' });
  });

  it('serves checks.detect from project config and rejects arguments', async () => {
    const dir = await repoWithConfig({ build_command: 'make all' });
    expect(((await checksDetect([], dir)).data as { build: string }).build).toBe('make all');
    await expect(checksDetect(['extra'], dir)).rejects.toThrow(GSDError);
  });
});

describe('build.run-checks', () => {
  it('runs a set and reports pass, fail and skipped commands', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "process.exit(0)"`,
      test_command: `${NODE} -e "process.exit(3)"`,
      build_check_timeout_seconds: 60,
    });
    const result = await run(dir, ['--phase', '3', '--set', 'full']);
    expect([result.set, result.label, result.passed]).toEqual(['full', 'full', false]);
    expect(result.results.map((r) => [r.name, r.skipped, r.exit, r.timed_out, r.preexisting])).toEqual([
      ['build', false, 0, false, false],
      ['typecheck', true, null, false, false],
      ['lint', true, null, false, false],
      ['test', false, 3, false, false],
    ]);
    expect(result.results[0].commit).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(git(dir, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('times out long commands', async () => {
    const dir = await repoWithConfig({ build_command: `${NODE} -e "setTimeout(()=>{},10000)"`, build_check_timeout_seconds: 1 });
    const started = Date.now();
    const [result] = (await run(dir, ['--phase', '3', '--set', 'wave', '--only', 'build'])).results;
    expect([result.timed_out, result.exit]).toEqual([true, null]);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 30_000);

  it('marks failures that also failed in the baseline as preexisting', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "process.exit(0)"`,
      test_command: `${NODE} -e "process.exit(1)"`,
      build_check_timeout_seconds: 60,
    });
    const baseline = await run(dir, ['--phase', '3', '--set', 'full', '--label', 'baseline']);
    expect(baseline.results.find((r) => r.name === 'test')?.preexisting).toBe(false);
    await files(dir, { '.planning/config.json': JSON.stringify({ workflow: {
      build_command: `${NODE} -e "process.exit(2)"`,
      test_command: `${NODE} -e "process.exit(1)"`,
      build_check_timeout_seconds: 60,
    } }) });
    const full = await run(dir, ['--phase', '3', '--set', 'full']);
    expect(full.results.find((r) => r.name === 'test')?.preexisting).toBe(true);
    expect(full.results.find((r) => r.name === 'build')?.preexisting).toBe(false);
  }, 30_000);

  it('tracks the commit of each command in latest.json', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "process.exit(0)"`,
      test_command: `${NODE} -e "process.exit(0)"`,
      build_check_timeout_seconds: 60,
    });
    const first = git(dir, 'rev-parse', 'HEAD');
    await run(dir, ['--phase', '3', '--set', 'full']);
    await files(dir, { 'src.txt': 'change\n' });
    git(dir, 'add', 'src.txt');
    git(dir, 'commit', '-q', '-m', 'change');
    const second = git(dir, 'rev-parse', 'HEAD');
    await run(dir, ['--phase', '3', '--set', 'wave', '--only', 'build']);
    const latest = readLatestChecks(dir, '03');
    expect([latest.build.commit, latest.build.passed]).toEqual([second, true]);
    expect([latest.test.commit, latest.test.passed]).toEqual([first, true]);
    expect([latest.lint.skipped, latest.lint.passed]).toEqual([true, false]);
  }, 30_000);

  it('keeps the last 200 output lines', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "for(let i=0;i<500;i++)console.log('line '+i)"`,
      build_check_timeout_seconds: 60,
    });
    const [result] = (await run(dir, ['--phase', '3', '--set', 'wave', '--only', 'build'])).results;
    const lines = result.output_tail.split('\n');
    expect([lines.length, lines[0], lines[199]]).toEqual([200, 'line 300', 'line 499']);
  }, 30_000);

  it('reports a missing git repository', async () => {
    const dir = await tempDir();
    expect((await buildRunChecks(['--phase', '3', '--set', 'quick'], dir)).data).toEqual({ error: 'git_repository_required' });
  });

  it.each([
    [[]],
    [['--set', 'full']],
    [['--phase', '3']],
    [['--phase', '3', '--set', 'bogus']],
    [['--phase', '3', '--set', 'full', '--only', 'deploy']],
    [['--phase', '3', '--set', 'quick', '--only', 'test']],
    [['--phase', '3', '--set', 'full', '--label', 'Bad/Label']],
    [['--phase', '3', '--set', 'full', '--set', 'wave']],
    [['--phase', '../x', '--set', 'full']],
    [['--phase', '3', '--set', 'full', 'extra']],
  ])('rejects invalid arguments %j', async (args) => {
    const dir = await repoWithConfig({});
    await expect(buildRunChecks(args, dir)).rejects.toThrow(GSDError);
  });
});
