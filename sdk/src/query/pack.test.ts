import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { packShow } from './pack.js';

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function project(config: Record<string, unknown> | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fvgsd-pack-'));
  dirs.push(dir);
  await mkdir(join(dir, '.planning'), { recursive: true });
  if (config) await writeFile(join(dir, '.planning', 'config.json'), JSON.stringify(config));
  return dir;
}

async function show(dir: string): Promise<Record<string, unknown>> {
  return (await packShow([], dir)).data as Record<string, unknown>;
}

describe('pack.show', () => {
  it('reports every field missing when there is no pack', async () => {
    const data = await show(await project({ workflow: {} }));
    expect(data).toMatchObject({
      pack: null,
      missing: ['name', 'deploy', 'migrations', 'candidates', 'message_prefix', 'handoff_path'],
      problems: [],
      research: true,
      verify_report: 'full',
    });
    expect((data.checks as { extra: string[] }).extra).toEqual([]);
  });

  it('returns the pack, the missing fields and value problems', async () => {
    const dir = await project({
      workflow: { research: 'on-gap', build_verify_report: 'lite', lint_command: 'off', extra_check_commands: ['npm run db'] },
      pack: {
        name: 'demo-app',
        deploy: { dev: { kind: 'github' } },
        handoff_path: 'notes/handoff.md',
        region: 'eu',
      },
    });
    const data = await show(dir);
    expect(data.missing).toEqual(['migrations', 'candidates', 'message_prefix']);
    expect(data.problems).toEqual([
      'pack.deploy: dev: kind github needs workflows, a list of workflow names or {"workflow": name, "inputs": {...}} entries with string inputs.',
      'pack.region: unknown field',
    ]);
    expect(data).toMatchObject({ research: 'on-gap', verify_report: 'lite' });
    expect(data.checks).toMatchObject({ lint: null, extra: ['npm run db'], sources: { lint: 'off' } });
  });

  it('counts false deploy and migrations as present, not missing', async () => {
    const data = await show(await project({ pack: { name: 'demo-app', deploy: false, migrations: false } }));
    expect([data.missing, data.problems]).toEqual([['candidates', 'message_prefix', 'handoff_path'], []]);
  });

  it('flags a pack that is not an object and rejects arguments', async () => {
    const dir = await project({ pack: 'demo-app' });
    expect((await show(dir)).problems).toEqual(['pack must be a JSON object']);
    await expect(packShow(['extra'], dir)).rejects.toThrow(GSDError);
  });
});
