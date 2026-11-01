/**
 * The key figures in a "Worth knowing" line, picked out for bold: counts with
 * their unit, percentages, multipliers, signed differences and clock times.
 * The lines are built nightly as plain sentences (`findingsOf`), so the page
 * finds the figures rather than the report carrying markup: a report from
 * before this change reads the same way.
 */
export interface Segment { text: string; key: boolean }

const UNIT = String.raw`(?:%|×|\s?(?:km|hours?|minutes?|min|h|steps|days?|journeys|visits|places|people|weeks?))`;
const FIGURE = new RegExp(String.raw`\d{1,2}:\d{2}|[+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?${UNIT}?`, 'g');

export function emphasise(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(FIGURE)) {
    // A digit inside a word ("A47", "M11") is a name, not a figure.
    const before = text[m.index - 1], after = text[m.index + m[0].length];
    if ((before && /[A-Za-z]/.test(before)) || (after && /[A-Za-z0-9]/.test(after))) continue;
    if (m.index > at) out.push({ text: text.slice(at, m.index), key: false });
    out.push({ text: m[0], key: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), key: false });
  return out;
}
