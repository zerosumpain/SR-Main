// Number formatting for the page's own text (harness chrome, lens readouts,
// inspector cards). It goes through the engine's formatter, never Intl, so a
// number reads the same in Node, Chrome and the iPhone's WebKit (A25).

import { formatPounds } from './engine';

/** "12,345" (and "−12,345"). */
export function groupDigits(n: number): string {
  const s = formatPounds(n);
  return s.startsWith('−') ? '−' + s.slice(2) : s.slice(1);
}

/** "£12,345" / "−£12,345". */
export const pounds = formatPounds;

/** "+£1,200" / "−£300" / "£0". */
export function signedPounds(n: number): string {
  const r = Math.round(n);
  return r > 0 ? '+' + formatPounds(r) : formatPounds(r);
}

/** "+12" / "−3" / "0". */
export function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${groupDigits(r)}` : groupDigits(r);
}

/** A p10–p90 range in words: "+40 to +120", or one number when the ends agree. */
export function range(lo: number, hi: number, f: (n: number) => string = signed): string {
  const a = f(lo);
  const b = f(hi);
  return a === b ? a : `${a} to ${b}`;
}

/** Real ms as "~2 h", "~25 min", "a moment". */
export function roughly(ms: number): string {
  if (ms < 60_000) return 'a moment';
  const min = Math.round(ms / 60_000);
  if (min < 90) return `~${min} min`;
  const h = Math.round(ms / 3_600_000);
  return h < 36 ? `~${h} h` : `~${Math.round(h / 24)} days`;
}
