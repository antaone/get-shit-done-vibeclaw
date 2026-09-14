/**
 * build.scan-stubs — debt markers (TBD/FIXME/XXX) in files changed since a
 * base commit. Deleted files, markdown and `.planning/` are skipped.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { findDebtMarkers, isDebtScannable } from '../debt-markers.js';
import { changedFilesSince, parseFlags, runGit } from './build-shared.js';
import type { QueryHandler } from './utils.js';

export const buildScanStubs: QueryHandler = async (args, projectDir) => {
  const { flags, positionals } = parseFlags(args, { values: ['base'] });
  if (positionals.length > 0) {
    throw new GSDError(`unexpected argument: ${positionals[0]}`, ErrorClassification.Validation);
  }
  if (typeof flags.base !== 'string') {
    throw new GSDError('--base <commit> is required', ErrorClassification.Validation);
  }
  const verified = runGit(projectDir, ['rev-parse', '--verify', '--quiet', `${flags.base}^{commit}`]);
  if (!verified.ok) {
    throw new GSDError(`--base does not name a commit: ${flags.base}`, ErrorClassification.Validation);
  }

  const root = resolve(projectDir);
  const findings: Array<{ file: string; line: number; marker: string }> = [];
  for (const change of changedFilesSince(projectDir, verified.stdout)) {
    if (change.status === 'D' || !isDebtScannable(change.path)) continue;
    const absolute = resolve(root, change.path);
    const rel = relative(root, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    for (const finding of findDebtMarkers(change.path, readFileSync(absolute, 'utf-8'))) {
      findings.push({ file: finding.file, line: finding.line, marker: finding.marker });
    }
  }
  return { data: findings };
};
