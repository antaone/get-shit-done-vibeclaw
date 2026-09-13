import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

import {
  BUNDLED_CORE_CJS_PATH,
  BUNDLED_GSD_AGENTS_DIR,
  BUNDLED_GSD_TEMPLATES_DIR,
  BUNDLED_GSD_TOOLS_PATH,
  loadLegacyCoreConfig,
  probeLegacySdkAsset,
  resolveBundledAgentsDir,
  resolveBundledTemplatesDir,
  resolveGsdToolsPath,
  resolveLegacyInstallDir,
  resolveLegacyUserProfilePath,
  resolveLegacyTemplatesDir,
  resolveLegacyWorkflowsDir,
} from './sdk-package-compatibility.js';
import { GSDError } from './errors.js';
import { IDENTITY } from './identity.js';

describe('SDK Package Seam Module', () => {
  const projectDir = '/work/project';
  const homeDir = '/users/tester';

  it('resolves legacy install-relative directories through one seam', () => {
    expect(resolveLegacyInstallDir(homeDir)).toBe(join(homeDir, '.claude', IDENTITY.installDir));
    expect(resolveLegacyTemplatesDir(homeDir)).toBe(join(homeDir, '.claude', IDENTITY.installDir, 'templates'));
    expect(resolveLegacyWorkflowsDir(homeDir)).toBe(join(homeDir, '.claude', IDENTITY.installDir, 'workflows'));
    expect(resolveLegacyUserProfilePath(homeDir)).toBe(join(homeDir, '.claude', IDENTITY.installDir, 'USER-PROFILE.md'));
    expect(resolveBundledTemplatesDir()).toBe(BUNDLED_GSD_TEMPLATES_DIR);
    expect(resolveBundledAgentsDir()).toBe(BUNDLED_GSD_AGENTS_DIR);
  });

  it('probes legacy fvgsd-tools locations in bundled -> project -> home order', () => {
    const resolution = probeLegacySdkAsset('fvgsd-tools', projectDir, {
      homeDir,
      existsSync: path => path === join(projectDir, '.claude', IDENTITY.installDir, 'bin', 'fvgsd-tools.cjs'),
    });

    expect(resolution.probes).toEqual([
      BUNDLED_GSD_TOOLS_PATH,
      join(projectDir, '.claude', IDENTITY.installDir, 'bin', 'fvgsd-tools.cjs'),
      join(homeDir, '.claude', IDENTITY.installDir, 'bin', 'fvgsd-tools.cjs'),
    ]);
    expect(resolution.path).toBe(join(projectDir, '.claude', IDENTITY.installDir, 'bin', 'fvgsd-tools.cjs'));
    expect(resolution.fallbackPath).toBe(join(homeDir, '.claude', IDENTITY.installDir, 'bin', 'fvgsd-tools.cjs'));
  });

  it('returns concrete fallback fvgsd-tools path when no legacy probe exists', () => {
    const path = resolveGsdToolsPath(projectDir, {
      homeDir,
      existsSync: () => false,
    });

    expect(path).toBe(join(homeDir, '.claude', IDENTITY.installDir, 'bin', 'fvgsd-tools.cjs'));
  });

  it('loads legacy core.cjs through one compatibility adapter', () => {
    const loadConfig = vi.fn((cwd: string) => ({ cwd, source: 'legacy-core' }));
    const requireFn = vi.fn(() => ({ loadConfig }));
    const createRequire = vi.fn(() => requireFn as unknown as NodeJS.Require);

    const result = loadLegacyCoreConfig(projectDir, {
      homeDir,
      existsSync: path => path === BUNDLED_CORE_CJS_PATH,
      createRequire,
    });

    expect(createRequire).toHaveBeenCalledOnce();
    expect(requireFn).toHaveBeenCalledWith(BUNDLED_CORE_CJS_PATH);
    expect(loadConfig).toHaveBeenCalledWith(projectDir);
    expect(result).toEqual({ cwd: projectDir, source: 'legacy-core' });
  });

  it('reports checked core.cjs probes when legacy asset missing', () => {
    expect(() => loadLegacyCoreConfig(projectDir, {
      homeDir,
      existsSync: () => false,
    })).toThrow(GSDError);

    try {
      loadLegacyCoreConfig(projectDir, {
        homeDir,
        existsSync: () => false,
      });
      expect.fail('expected GSDError');
    } catch (error) {
      expect(error).toBeInstanceOf(GSDError);
      const message = (error as Error).message;
      expect(message).toContain('state load: get-shit-done/bin/lib/core.cjs not found.');
      expect(message).toContain('Checked:');
      expect(message).toContain(BUNDLED_CORE_CJS_PATH);
      expect(message).toContain(join(projectDir, '.claude', IDENTITY.installDir, 'bin', 'lib', 'core.cjs'));
      expect(message).toContain(join(homeDir, '.claude', IDENTITY.installDir, 'bin', 'lib', 'core.cjs'));
    }
  });
});
