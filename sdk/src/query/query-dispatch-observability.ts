export function fallbackBridgeNotices(command: string): string[] {
  return [
    `[fvgsd-sdk] '${command}' not in native registry; falling back to fvgsd-tools.cjs.`,
    '[fvgsd-sdk] Transparent bridge — prefer adding a native handler when parity matters.',
  ];
}
