// src/lib/daydream/mail-insights.ts
//
// What the source backlog adds up to: what is spent with whom, what recurs,
// what changed, what is coming and who is waiting. Arithmetic over the facts
// Core's reader extracted, with no model in it. Pure; the queries are in
// `mail-insights.server.ts`.
//
// The amounts are the FIRST figure of each bill, receipt, renewal or
// subscription notice. That is a reading of the mail, not a reconciled ledger,
// and the page says so.

import { addDays, fromOf, sourceHref, type BacklogItem, type TotalRow } from './mail-room';

/** The categories whose first amount is money he paid or owes. */
export const SPEND_CATEGORIES = ['bill', 'receipt', 'renewal', 'subscription'] as const;

/** Months a sender must bill in before it counts as recurring. */
export const RECURRING_MONTHS = 3;
/** How far a month must sit above the months before it to be called a rise. */
export const ROSE_RATIO = 1.1;
export const UPCOMING_DAYS = 90;

export interface SenderSpend {
  sender: string;
  currency: string;
  /** Minor units over the whole window. */
  total: number;
  items: number;
  /** Distinct months with an amount. */
  months: number;
  lastMonth: string;
  /** The median month. */
  typical: number;
  latest: number;
  /** The mean of the months before the latest; null with fewer than two. */
  before: number | null;
  rose: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** One line per sender and currency, biggest first. Rows without money are left out. */
export function spendBySender(rows: TotalRow[]): SenderSpend[] {
  const groups = new Map<string, TotalRow[]>();
  for (const r of rows) {
    if (!r.currency || r.minor <= 0) continue;
    const k = `${r.key}\u0000${r.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()]
    .map((rs) => {
      const byMonth = [...rs].sort((a, b) => a.month.localeCompare(b.month));
      const latest = byMonth[byMonth.length - 1];
      const earlier = byMonth.slice(0, -1).map((r) => r.minor);
      const before = earlier.length >= 2 ? Math.round(earlier.reduce((n, x) => n + x, 0) / earlier.length) : null;
      return {
        sender: latest.key,
        currency: latest.currency!,
        total: byMonth.reduce((n, r) => n + r.minor, 0),
        items: byMonth.reduce((n, r) => n + r.items, 0),
        months: byMonth.length,
        lastMonth: latest.month,
        typical: median(byMonth.map((r) => r.minor)),
        latest: latest.minor,
        before,
        rose: before !== null && latest.minor > before * ROSE_RATIO,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** Senders that bill most months: what he is signed up to, with what a year of it costs. */
export function recurring(spend: SenderSpend[]): SenderSpend[] {
  return spend.filter((s) => s.months >= RECURRING_MONTHS);
}

export interface MonthSpend {
  month: string;
  currency: string;
  minor: number;
  items: number;
}

/** Month totals per currency, oldest first. */
export function spendByMonth(rows: TotalRow[]): MonthSpend[] {
  const out = new Map<string, MonthSpend>();
  for (const r of rows) {
    if (!r.currency || r.minor <= 0) continue;
    const k = `${r.month}\u0000${r.currency}`;
    const m = out.get(k) ?? { month: r.month, currency: r.currency, minor: 0, items: 0 };
    m.minor += r.minor;
    m.items += r.items;
    out.set(k, m);
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}

interface Ref {
  id: string;
  from: string;
  category: string;
  summary: string;
  href: string | null;
}

const ref = (i: BacklogItem): Ref => ({ id: i.id, from: fromOf(i), category: i.category ?? 'other', summary: i.facts?.summary ?? '', href: sourceHref(i) });

export interface Upcoming extends Ref {
  day: string;
  label: string;
  kind: string;
  amount: { minor: number; currency: string } | null;
}

/** Date kinds with something at stake. An 'event' counts only off marketing: a sale ending is not his diary. */
const STAKES = new Set(['due', 'renewal', 'expiry', 'delivery']);

/** Every dated thing inside the window, soonest first, one line per item and day. */
export function upcoming(items: BacklogItem[], today: string, days = UPCOMING_DAYS): Upcoming[] {
  const until = addDays(today, days);
  const out: Upcoming[] = [];
  for (const i of items) {
    const seen = new Set<string>();
    for (const d of i.facts?.dates ?? []) {
      if (d.date < today || d.date > until || seen.has(d.date)) continue;
      if (!STAKES.has(d.kind) && i.kind === 'bulk') continue;
      seen.add(d.date);
      const a = i.facts?.amounts[0] ?? null;
      out.push({ ...ref(i), id: `${i.id}:${d.date}`, day: d.date, label: d.label || d.kind, kind: d.kind, amount: a ? { minor: a.minor, currency: a.currency } : null });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export interface Waiting extends Ref {
  on: 'me' | 'them';
  what: string;
  day: string;
}

/** Who is waiting on whom, oldest first: the longest wait is the one that matters. */
export function waiting(items: BacklogItem[]): { onMe: Waiting[]; onThem: Waiting[] } {
  const all: Waiting[] = [];
  for (const i of items) {
    if (i.kind === 'bulk') continue;
    (i.facts?.asks ?? []).forEach((a, n) => all.push({ ...ref(i), id: `${i.id}:${n}`, on: a.waitingOn, what: a.what, day: i.observedAt.slice(0, 10) }));
  }
  all.sort((a, b) => a.day.localeCompare(b.day));
  return { onMe: all.filter((w) => w.on === 'me'), onThem: all.filter((w) => w.on === 'them') };
}

export interface Change extends Ref {
  day: string;
  what: string;
  was: string;
  now: string;
}

/** Prices and terms that moved, newest first. */
export function changes(items: BacklogItem[]): Change[] {
  return items
    .filter((i) => i.facts?.change)
    .map((i) => ({ ...ref(i), day: i.observedAt.slice(0, 10), what: i.facts!.change!.what, was: i.facts!.change!.from, now: i.facts!.change!.to }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export interface Noise {
  sender: string;
  items: number;
  marketing: number;
}

export interface MailInsights {
  /** YYYY-MM of the first and last month covered. */
  window: { from: string; to: string };
  byMonth: MonthSpend[];
  bySender: SenderSpend[];
  recurring: SenderSpend[];
  rose: SenderSpend[];
  changes: Change[];
  upcoming: Upcoming[];
  onMe: Waiting[];
  onThem: Waiting[];
  noise: Noise[];
}
