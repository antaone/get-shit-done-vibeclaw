/**
 * Debt-marker scan shared by the phase runner's architectural-debt gate and
 * the build.scan-stubs query.
 *
 * A TBD/FIXME/XXX marker is allowed only when the text after it on the same
 * line references tracked follow-up work (issue/PR number or DEF-* id).
 */

export interface DebtMarkerFinding {
  file: string;
  line: number;
  marker: string;
  text: string;
}

const MARKER_PATTERN = /(?:^|[^\w.])(TBD|FIXME|XXX)(?=\b(?:\.(?:\s|$)|[^\w.]|$))/i;

export function isDebtScannable(file: string): boolean {
  return !/\.(md|markdown)$/i.test(file);
}

export function hasFormalDebtReference(text: string): boolean {
  return /\bDEF-[A-Z0-9-]+\b/i.test(text)
    || /\b(?:issue|issues|pr|pull request)\s+#?\d+\b/i.test(text)
    || /(?:^|\s)#\d+\b/.test(text);
}

export function findDebtMarkers(file: string, content: string): DebtMarkerFinding[] {
  const findings: DebtMarkerFinding[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const match = MARKER_PATTERN.exec(line);
    if (!match) return;
    if (hasFormalDebtReference(line.slice(match.index))) return;
    findings.push({ file, line: index + 1, marker: match[1].toUpperCase(), text: line.trim() });
  });
  return findings;
}
