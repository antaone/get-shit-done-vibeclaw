import { describe, it, expect } from 'vitest';
import { findDebtMarkers, hasFormalDebtReference, isDebtScannable } from './debt-markers.js';

describe('findDebtMarkers', () => {
  it('reports unresolved markers with file, line, upper-case marker and trimmed text', () => {
    expect(findDebtMarkers('src/a.ts', 'const a = 1;\n  // FIXME: hash passwords  \n')).toEqual([
      { file: 'src/a.ts', line: 2, marker: 'FIXME', text: '// FIXME: hash passwords' },
    ]);
  });

  it('matches lowercase markers and markers followed by punctuation', () => {
    expect(findDebtMarkers('a.ts', '// fixme: lowercase\n// TBD.').map((f) => [f.line, f.marker])).toEqual([
      [1, 'FIXME'],
      [2, 'TBD'],
    ]);
  });

  it('ignores dotted and embedded words', () => {
    expect(findDebtMarkers('a.ts', 'const note = "xxx.yyy";\nconst prefix = "TBDX";')).toEqual([]);
  });

  it('allows markers that cite tracked work after the marker', () => {
    const content = ['// FIXME #123 tracked', '// TBD see DEF-AUTH-7', '// XXX: pr 42 follow-up', '// FIXME later, then issue #9'].join('\n');
    expect(findDebtMarkers('a.ts', content)).toEqual([]);
  });

  it('does not let earlier issue text excuse a later marker', () => {
    expect(findDebtMarkers('a.ts', '// issue #9 earlier then FIXME later').map((f) => f.marker)).toEqual(['FIXME']);
  });

  it('reports one finding per line and handles CRLF', () => {
    expect(findDebtMarkers('a.ts', '// FIXME and TBD on one line')).toHaveLength(1);
    expect(findDebtMarkers('a.ts', 'ok\r\n// XXX: crlf\r\n').map((f) => f.line)).toEqual([2]);
  });
});

describe('hasFormalDebtReference', () => {
  it('recognizes DEF ids, issue and PR numbers, and #N after whitespace', () => {
    expect(hasFormalDebtReference('DEF-12')).toBe(true);
    expect(hasFormalDebtReference('see issue 42')).toBe(true);
    expect(hasFormalDebtReference('pull request #7')).toBe(true);
    expect(hasFormalDebtReference('tracked in #88')).toBe(true);
    expect(hasFormalDebtReference('"#12"')).toBe(false);
    expect(hasFormalDebtReference('no reference')).toBe(false);
  });
});

describe('isDebtScannable', () => {
  it('skips markdown files', () => {
    expect(isDebtScannable('README.md')).toBe(false);
    expect(isDebtScannable('docs/guide.MARKDOWN')).toBe(false);
    expect(isDebtScannable('src/app.ts')).toBe(true);
  });
});
