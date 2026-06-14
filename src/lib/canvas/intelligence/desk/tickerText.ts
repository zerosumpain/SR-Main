// src/lib/canvas/intelligence/desk/tickerText.ts
export interface TickerLog {
  message: string;
  timestamp: number;
}

// Leading emoji/pictograph(s) optionally followed by a VS16, then whitespace.
// emitLog() prepends `${icon}  ${message}` with two spaces.
const LEADING_ICON =
  /^[\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}ℹ⚠✅]+\s*/u;

/** Latest log line, with the emitLog icon prefix stripped and whitespace collapsed. */
export function tickerLine(logs: readonly TickerLog[]): string {
  if (!logs || logs.length === 0) return 'idle · standing by';
  const last = logs[logs.length - 1]?.message ?? '';
  return last.replace(LEADING_ICON, '').replace(/\s+/g, ' ').trim() || 'idle · standing by';
}
