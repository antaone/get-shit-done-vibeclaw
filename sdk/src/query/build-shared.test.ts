import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { parseFlags, resolveBuildPhase, writeJsonAtomic } from './build-shared.js';

describe('parseFlags', () => {
  const spec = { values: ['phase', 'set'], booleans: ['gaps'] } as const;

  it('parses values, the equals form, booleans and positionals', () => {
    expect(parseFlags(['3', '--set', 'full', '--phase=03', '--gaps'], spec)).toEqual({
      flags: { set: 'full', phase: '03', gaps: true },
      positionals: ['3'],
    });
  });

  it('keeps unicode, long values and shell metacharacters as plain values', () => {
    const value = `ünïcode; rm -rf / && $(whoami) \`id\` "q" ${'x'.repeat(5000)}`;
    expect(parseFlags(['--phase', value], spec).flags.phase).toBe(value);
  });

  it.each([
    [['--phase']],
    [['--phase', '--set', 'full']],
    [['--phase', '']],
    [['--phase', '   ']],
    [['--phase=']],
    [['--phase==1']],
    [['--phase', '1', '--phase', '2']],
    [['--nope', 'x']],
    [['--gaps=true']],
    [['--']],
  ])('rejects %j', (args) => {
    let caught: unknown;
    try {
      parseFlags(args, spec);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GSDError);
    expect((caught as GSDError).classification).toBe('validation');
  });
});

describe('resolveBuildPhase', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-shared-'));
    await mkdir(join(dir, '.planning', 'phases', '03-user-auth'), { recursive: true });
    await mkdir(join(dir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves number, padded, name and directories', async () => {
    expect(await resolveBuildPhase(dir, '3')).toEqual({
      number: '3',
      padded: '03',
      name: 'user-auth',
      dir: '.planning/phases/03-user-auth',
      dirAbs: join(dir, '.planning/phases/03-user-auth'),
    });
  });

  it('keeps decimal phases', async () => {
    const phase = await resolveBuildPhase(dir, '2.1');
    expect([phase?.number, phase?.padded]).toEqual(['2.1', '02.1']);
  });

  it('returns null for missing, empty or hostile phases', async () => {
    for (const arg of ['9', '', '   ', '../../etc', 'a\0b']) {
      expect(await resolveBuildPhase(dir, arg)).toBeNull();
    }
  });
});

describe('writeJsonAtomic', () => {
  it('creates parents, replaces content and leaves no temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-json-'));
    const target = join(dir, 'a', 'b', 'data.json');
    writeJsonAtomic(target, { ok: true });
    writeJsonAtomic(target, { ok: false });
    expect(JSON.parse(await readFile(target, 'utf-8'))).toEqual({ ok: false });
    expect(await readdir(join(dir, 'a', 'b'))).toEqual(['data.json']);
    await rm(dir, { recursive: true, force: true });
  });
});
