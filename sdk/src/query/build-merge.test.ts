import { describe, it, expect } from 'vitest';
import type { GitResult } from './build-shared.js';
import { verifyMergeAborted } from './build-merge.js';

// build-merge.integration.test.ts's "reports merge_abort_failed and stops
// the wave when git merge --abort itself fails" test covers this branch
// end-to-end with real git (a pre-merge-commit hook leaves a stray
// .git/index.lock that then blocks the abort itself). The tests here
// exercise verifyMergeAborted directly as a pure function so every branch —
// a failed abort reporting via stderr, via stdout only, via neither, and a
// successful abort that still somehow leaves MERGE_HEAD behind — is covered
// without needing a separate real-git fixture for each one.
function gitResult(ok: boolean, extra: Partial<Pick<GitResult, 'stdout' | 'stderr'>> = {}): GitResult {
  return { ok, code: ok ? 0 : 1, stdout: extra.stdout ?? '', stderr: extra.stderr ?? '' };
}

describe('verifyMergeAborted', () => {
  it('is ok when the abort exits 0 and MERGE_HEAD is gone afterward', () => {
    const result = verifyMergeAborted(gitResult(true), gitResult(false));
    expect(result).toEqual({ ok: true, detail: '' });
  });

  it('is not ok when the abort command itself fails, e.g. a held .git/index.lock', () => {
    const abortResult = gitResult(false, { stderr: "fatal: Unable to create '.git/index.lock': File exists." });
    const result = verifyMergeAborted(abortResult, gitResult(true));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('index.lock');
  });

  it('falls back to stdout for the detail when the failed abort has no stderr', () => {
    const abortResult = gitResult(false, { stdout: 'could not abort' });
    const result = verifyMergeAborted(abortResult, gitResult(true));
    expect(result).toEqual({ ok: false, detail: 'could not abort' });
  });

  it('names the failure generically when the failed abort has neither stdout nor stderr', () => {
    const result = verifyMergeAborted(gitResult(false), gitResult(true));
    expect(result).toEqual({ ok: false, detail: 'git merge --abort failed' });
  });

  it('is not ok when the abort exits 0 but MERGE_HEAD is still present', () => {
    const result = verifyMergeAborted(gitResult(true), gitResult(true));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('MERGE_HEAD');
  });
});
