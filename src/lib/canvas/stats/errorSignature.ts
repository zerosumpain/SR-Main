/**
 * Normalise an error string into a stable grouping key.
 *
 * Strips ANSI colour escapes, leading ISO timestamps, leading log-level
 * prefixes (ERROR, WARN, [error], etc.), collapses runs of whitespace,
 * and truncates to 80 characters. Used by the Error Explorer node to
 * group `node_executions.error` rows that are "the same failure" even
 * when their timestamps or callsite stacks differ slightly.
 */

const ANSI = /\x1b\[[0-9;]*m/g;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\s+/;
const LEVEL = /^\s*(\[)(error|warn|info|debug|trace|ERROR|WARN|INFO|DEBUG|TRACE)(\])\s*:?\s+|^\s*(ERROR|WARN|INFO|DEBUG|TRACE)\s*:?\s+/;
const WS = /\s+/g;

export function extractSignature(input: unknown): string {
  if (typeof input !== 'string') return '';
  let s = input.replace(ANSI, '');
  s = s.replace(ISO_TS, '');
  s = s.replace(LEVEL, '');
  s = s.replace(WS, ' ').trim();
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}
