// src/lib/daydream/think/ledger.ts
//
// What the think loop has already tested. PURE — the store is
// `ledger.server.ts`, one `app_settings` row.
//
// `correlate()` is cheap — no model, one query — so the waste was never the
// test; it was the NOTE. The same null ("extra sleep is not predicting next-day
// recovery") was written four times in two days, because nothing remembered
// that it had been asked. So every test is recorded, a pair is fresh only when
// there is something new to learn from it, and a correlate note resting on a
// pair that is not fresh is refused by code (`audit.ts`). Once a month the
// ledger itself becomes the material for one note that says what does and does
// not move his days — the nulls included, once.

import { correlateSubject } from './subjects';

export const LEDGER_SETTING = 'daydream.think.correlations';
export const LEDGER_SUMMARY_SETTING = 'daydream.think.correlations.summary_at';

/** A pair is retested after this long regardless… */
export const RETEST_DAYS = 30;
/** …or once it has this much more data. */
export const RETEST_GROWTH = 1.3;
/** …or over a window this different. */
export const RETEST_WINDOW_DELTA_DAYS = 30;
/** The ledger keeps the newest this many pairs. */
export const LEDGER_MAX = 80;

/** The summary note: at most this often, and only over this many pairs. */
export const SUMMARY_EVERY_DAYS = 30;
export const SUMMARY_MIN_PAIRS = 6;

export interface LedgerTest {
  label: string;
  r: number;
  n: number;
  p: number;
}

export interface LedgerEntry {
  /** As asked: `a` leads in the lagged test. */
  a: string;
  b: string;
  days: number;
  /** The most paired days among its tests — what growth is measured on. */
  n: number;
  tests: LedgerTest[];
  /** ISO time it was tested. */
  at: string;
}

export type Ledger = Record<string, LedgerEntry>;

export function ledgerKey(a: string, b: string): string {
  return correlateSubject(a, b);
}

/** Read a stored value defensively: a malformed row is an empty ledger. */
export function parseLedger(raw: unknown): Ledger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Ledger = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<LedgerEntry> | null;
    if (!e || typeof e.a !== 'string' || typeof e.b !== 'string' || typeof e.at !== 'string') continue;
    if (typeof e.n !== 'number' || typeof e.days !== 'number' || !Array.isArray(e.tests)) continue;
    out[k] = { a: e.a, b: e.b, days: e.days, n: e.n, tests: e.tests as LedgerTest[], at: e.at };
  }
  return out;
}

export type Freshness = { fresh: true; prior: LedgerEntry | null } | { fresh: false; prior: LedgerEntry; until: string; needN: number };

/** Is there something new to learn from this pair? */
export function freshness(ledger: Ledger, a: string, b: string, days: number, n: number, now: Date): Freshness {
  const prior = ledger[ledgerKey(a, b)] ?? null;
  if (!prior) return { fresh: true, prior: null };
  const at = Date.parse(prior.at);
  const due = at + RETEST_DAYS * 86_400_000;
  const needN = Math.ceil(prior.n * RETEST_GROWTH);
  if (!Number.isFinite(at) || now.getTime() >= due) return { fresh: true, prior };
  if (n >= needN) return { fresh: true, prior };
  if (Math.abs(days - prior.days) >= RETEST_WINDOW_DELTA_DAYS) return { fresh: true, prior };
  return { fresh: false, prior, until: new Date(due).toISOString().slice(0, 10), needN };
}

/** The ledger with this test recorded, trimmed to the newest LEDGER_MAX. */
export function recordTest(ledger: Ledger, entry: LedgerEntry): Ledger {
  const next: Ledger = { ...ledger, [ledgerKey(entry.a, entry.b)]: entry };
  const keys = Object.keys(next).sort((x, y) => next[y].at.localeCompare(next[x].at));
  return Object.fromEntries(keys.slice(0, LEDGER_MAX).map((k) => [k, next[k]]));
}

function fmt(n: number, dp = 2): string {
  return Number.isFinite(n) ? n.toFixed(dp) : 'n/a';
}

/** One entry in words, for a card or the prompt. */
export function entryLine(e: LedgerEntry): string {
  const tests = e.tests.map((t) => `${t.label} r ${fmt(t.r)} over ${t.n} days, p ${fmt(t.p, 3)}`).join('; ');
  return `${e.a} against ${e.b} (tested ${e.at.slice(0, 10)}, ${e.days}-day window): ${tests}`;
}

/** What a card says when a pair is not fresh. The words are the instruction:
 *  a note on it would repeat itself, and the audit will refuse one. */
export function staleLine(f: Extract<Freshness, { fresh: false }>): string {
  return (
    `ALREADY TESTED — ${entryLine(f.prior)}. Not enough new data to retest: needs ${f.needN} paired days, or after ${f.until}. ` +
    'A correlate note on this pair now would repeat the earlier one and will be refused; test a different pair or write nothing.'
  );
}

/** The newest entries, for the ALREADY TESTED prompt block. */
export function recentEntries(ledger: Ledger, limit = 15): LedgerEntry[] {
  return Object.values(ledger)
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, limit);
}

/** Is a monthly summary due? */
export function summaryDue(ledger: Ledger, lastSummaryAt: string | null, now: Date): boolean {
  if (Object.keys(ledger).length < SUMMARY_MIN_PAIRS) return false;
  if (!lastSummaryAt) return true;
  const t = Date.parse(lastSummaryAt);
  return !Number.isFinite(t) || now.getTime() - t >= SUMMARY_EVERY_DAYS * 86_400_000;
}

/** The summary note's subject: one per month. */
export function summarySubject(now: Date): string {
  return `correlate:summary:${now.toISOString().slice(0, 7)}`;
}

/** The brief a summary cycle leads with, in place of the rotation's. */
export const SUMMARY_BRIEF =
  'THIS CYCLE IS THE MONTHLY SUMMARY OF WHAT HAS BEEN TESTED. Card C1 is every relationship tested so far. ' +
  'Write ONE correlate note that tells him, in plain words, what does and does not move his days — the links that held up and the ones that did not (a null is worth saying here, once). ' +
  'Lead with what it means for how he trains, sleeps or plans. Cite C1, and any card you fetch to check a figure.';

/** The ledger as a card's text. */
export function ledgerCardText(ledger: Ledger): string {
  const rows = recentEntries(ledger, LEDGER_MAX);
  return [`Every relationship the think loop has tested (${rows.length}), newest first. Spearman; an association, not a cause:`, ...rows.map((e) => `  ${entryLine(e)}`)].join('\n');
}
