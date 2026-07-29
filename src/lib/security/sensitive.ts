/**
 * Detection of secrets and personal data in free text.
 *
 * Written after a real leak: the release log published a summary quoting a
 * personal phone number, because the number was the test case for the bug the
 * commit fixed. Nothing in the release-log filter came close — the number was
 * not a secret, an env var, a hostname or a path, just ordinary prose.
 *
 * That is the shape of the risk this module exists for. Machine-written text
 * about a codebase quotes the data that provoked the change, and any surface
 * that republishes such text needs to assume so.
 *
 * Two jobs, deliberately separated:
 *   - `findSensitive` / `hasSensitive` — a GATE. Used to refuse to store or
 *     publish something at all.
 *   - `redactSensitive` — a SCRUB. Used to clean text already stored.
 *
 * Bias: false positives are cheap here (one release-log entry goes unshown),
 * false negatives are not (a phone number goes on the public internet). When
 * a pattern is arguable, it is included.
 */

export type SensitiveKind =
  | 'api-key'
  | 'token'
  | 'private-key'
  | 'phone'
  | 'email'
  | 'postcode'
  | 'coordinates'
  | 'ip'
  | 'long-digits';

export interface SensitiveMatch {
  kind: SensitiveKind;
  value: string;
  index: number;
}

/**
 * Matches that look sensitive but identify nobody, and whose redaction costs
 * more than it buys.
 *
 * `noreply@anthropic.com` is the Co-Authored-By trailer on every Claude Code
 * commit — it appears in 394 of 418 releases, and scrubbing it would rewrite
 * almost the whole table to protect a public robot address.
 *
 * The date rule exists because model identifiers carry them
 * (`claude-haiku-4-5-20251001`), and redacting the date corrupts the name.
 * Restricted to a plausible YYYYMMDD so it cannot shelter a real identifier.
 */
const NOT_PERSONAL: { kind: SensitiveKind; re: RegExp }[] = [
  { kind: 'email', re: /^(?:noreply|no-reply|bot)@(?:anthropic\.com|github\.com|users\.noreply\.github\.com)$/i },
  { kind: 'long-digits', re: /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/ },
];

function isExempt(kind: SensitiveKind, value: string): boolean {
  return NOT_PERSONAL.some((e) => e.kind === kind && e.re.test(value));
}

/**
 * Ordered so the most specific pattern wins a given span: a Slack token should
 * be reported as a token, not as a long digit run.
 *
 * Vendor prefixes are matched exactly rather than by entropy. A generic
 * "long random-looking string" rule sounds thorough and is not: it fires on
 * every git sha and minified asset name, which trains everyone to ignore it.
 */
const PATTERNS: { kind: SensitiveKind; re: RegExp }[] = [
  // ── credentials ──────────────────────────────────────────────────────────
  { kind: 'private-key', re: /-----BEGIN[ A-Z]*PRIVATE KEY-----/g },
  { kind: 'api-key', re: /\bsk-or-v1-[A-Za-z0-9]{16,}/g }, // OpenRouter
  { kind: 'api-key', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g }, // OpenAI / Anthropic
  { kind: 'api-key', re: /\bAIza[0-9A-Za-z_-]{30,}/g }, // Google
  { kind: 'api-key', re: /\bAKIA[0-9A-Z]{16}\b/g }, // AWS access key id
  { kind: 'api-key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g }, // SendGrid
  { kind: 'token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g }, // GitHub
  { kind: 'token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g }, // Slack
  { kind: 'token', re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g }, // JWT
  // A bearer value, but not a bare env-var NAME — "Bearer SCRAPER_SERVICE_TOKEN"
  // is documentation, not a credential.
  { kind: 'token', re: /\bBearer\s+(?![A-Z][A-Z0-9_]*\b)[A-Za-z0-9._-]{20,}/g },

  // ── personal data ────────────────────────────────────────────────────────
  // International, then UK national. Both require enough digits that ordinary
  // numbers in prose ("raised from 300 to 3000") cannot match.
  { kind: 'phone', re: /\+\d[\d\s()-]{7,}\d/g },
  { kind: 'phone', re: /\b0?7\d{3}[\s-]?\d{6}\b/g },
  { kind: 'email', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  { kind: 'postcode', re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g },
  // Four decimal places is ~11m — precise enough to locate a home.
  { kind: 'coordinates', re: /\b-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/g },
  { kind: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Catches account ids, JIDs and unpunctuated phone numbers. Deliberately
  // last, so anything above claims its span first.
  { kind: 'long-digits', re: /\b\d{7,}\b/g },
];

/**
 * Every sensitive span in `text`, most specific first and never overlapping.
 *
 * Note the patterns carry /g and RegExp objects are stateful, so each is used
 * via matchAll on a fresh lastIndex — do not swap this for .test() on the
 * shared instances.
 */
export function findSensitive(text: string): SensitiveMatch[] {
  if (!text) return [];
  const out: SensitiveMatch[] = [];
  const taken: [number, number][] = [];

  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      // A more specific pattern already claimed this span.
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      // Claim the span either way, so an exempt email is not then re-reported
      // as some looser pattern further down the list.
      taken.push([start, end]);
      if (isExempt(kind, m[0])) continue;
      out.push({ kind, value: m[0], index: start });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** True when `text` contains anything this module considers sensitive. */
export function hasSensitive(text: string): boolean {
  return findSensitive(text).length > 0;
}

/**
 * Replace every sensitive span with a typed placeholder.
 *
 * Used to clean text already in the database. Publishing surfaces should GATE
 * on hasSensitive instead: a half-redacted sentence reads worse than a missing
 * entry, and redaction can be undone by context ("the number ending 8511").
 */
export function redactSensitive(text: string): string {
  const matches = findSensitive(text);
  if (!matches.length) return text;
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.index) + `[redacted:${m.kind}]`;
    cursor = m.index + m.value.length;
  }
  return out + text.slice(cursor);
}

/** Walk any JSON value, redacting every string it contains. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSensitive(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
