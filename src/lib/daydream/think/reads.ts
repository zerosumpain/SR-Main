// src/lib/daydream/think/reads.ts
//
// The private reads that have no site tool of their own.
//
// Each is a first-party row the owner's own machinery wrote, never text a
// stranger wrote at length, and each is scoped to the owner in the query rather
// than trusted to be:
//
//   mail_facts    intel_timeline_events + email METADATA from intel_notes —
//                 subject, sender domain, kind, when. Never `raw_content`,
//                 never a live Gmail call. Scoped with `spaceIn(…,
//                 OWNER_INTEL_SCOPE)`: members' mail is live (#944), and a
//                 member's correspondence is neither his news nor his diary.
//   diary         the calendar through daydream's own reader, so an event the
//                 owner excluded ("PE days are kit reminders, not time") never
//                 reaches a prompt — the same reason ponder reads it that way.
//   spend         verified `daydream_spend` rows for the owner. The quarantine
//                 (`verified = false`) is the extractor's whole point.
//   chat_threads  his recent jkai threads: title, size, when, and his OWN
//                 opening line. Assistant turns are never carded — they can
//                 quote a fetched page, and a fetched page is someone else's.
//
// Mail deliberately does not go near `$lib/workflows/gmail`: nothing here picks
// a Gmail account, so there is no path by which the "most recently updated
// account" default could resolve to a member's mailbox. `tools.test.ts` pins
// that.

import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, daydreamSpend, intelNotes, intelTimelineEvents, orchestratorChats } from '$lib/db/schema';
import { ownerThread } from '$lib/jkai/owner-threads';
import { OWNER_INTEL_SCOPE, spaceIn } from '$lib/jkai/intel/scope';
import { DEFAULT_SUBJECT } from '../types';
import { localDay } from '../features/build';

function clampInt(raw: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
}

function query(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, 80) : '';
}

/** Escape LIKE wildcards so a model's `%` is a character, not a scan. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ── mail_facts ──────────────────────────────────────────────────────────────

export async function mailFactsTool(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const back = clampInt(args.daysBack, 1, 60, 14);
  const ahead = clampInt(args.daysAhead, 0, 90, 30);
  const q = query(args.query);
  const today = localDay(now);
  const from = localDay(new Date(now.getTime() - back * 86_400_000));
  const to = localDay(new Date(now.getTime() + ahead * 86_400_000));
  const owner = spaceIn(intelTimelineEvents.spaceId, OWNER_INTEL_SCOPE);

  const events = await db
    .select({ date: intelTimelineEvents.date, type: intelTimelineEvents.type, title: intelTimelineEvents.title })
    .from(intelTimelineEvents)
    .where(
      and(
        owner,
        gte(intelTimelineEvents.date, from),
        lte(intelTimelineEvents.date, to),
        q ? ilike(intelTimelineEvents.title, likeTerm(q)) : undefined,
      ),
    )
    .orderBy(intelTimelineEvents.date)
    .limit(40);

  const observed = sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`;
  const mail = await db
    .select({ title: intelNotes.title, metadata: intelNotes.metadata, at: observed })
    .from(intelNotes)
    .where(
      and(
        eq(intelNotes.source, 'email'),
        spaceIn(intelNotes.spaceId, OWNER_INTEL_SCOPE),
        gte(observed, new Date(now.getTime() - back * 86_400_000)),
        q ? ilike(intelNotes.title, likeTerm(q)) : undefined,
      ),
    )
    .orderBy(desc(observed))
    .limit(40);

  const lines: string[] = [];
  lines.push(`Dated facts the mail ingest extracted, ${from} to ${to} (today ${today}):`);
  if (!events.length) lines.push('  none');
  for (const e of events) lines.push(`  ${e.date} ${e.date < today ? '(past)' : ''} [${e.type}] ${e.title}`.replace(/\s+/g, ' ').trim());
  lines.push(`Mail received in the last ${back} days — metadata only, newest first:`);
  if (!mail.length) lines.push('  none');
  for (const m of mail) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const domain = typeof meta.senderDomain === 'string' ? meta.senderDomain : 'unknown sender';
    const kind = typeof meta.emailKind === 'string' ? ` (${meta.emailKind})` : '';
    const when = m.at instanceof Date ? m.at.toISOString().slice(0, 10) : String(m.at ?? '').slice(0, 10);
    lines.push(`  ${when} from ${domain}${kind}: ${(m.title ?? '(no subject)').slice(0, 120)}`);
  }
  return lines.join('\n');
}

// ── diary ───────────────────────────────────────────────────────────────────

export async function diaryTool(args: Record<string, unknown>): Promise<string> {
  const from = typeof args.from === 'string' && args.from.trim() ? args.from.trim() : 'today';
  const to = typeof args.to === 'string' && args.to.trim() ? args.to.trim() : '+14d';
  const q = query(args.query).toLowerCase();
  const [{ readCalendar }, { loadExclusionSet }] = await Promise.all([
    import('../calendar/read'),
    import('../calendar/store'),
  ]);
  const read = await readCalendar({ dateRangeStart: from, dateRangeEnd: to }, await loadExclusionSet());
  if (!read.available) return `The calendar could not be read (${read.error ?? 'unavailable'}). Treat the diary as unknown, never as empty.`;
  const events = read.events.filter((e) => !q || `${e.title} ${e.location ?? ''}`.toLowerCase().includes(q)).slice(0, 60);
  const lines = [`Diary ${from} to ${to}${q ? `, matching "${q}"` : ''}: ${events.length} event(s).`];
  for (const e of events) {
    lines.push(`  ${e.start.slice(0, 16).replace('T', ' ')}${e.end ? `–${e.end.slice(11, 16)}` : ''} ${e.title}${e.location ? ` @ ${e.location}` : ''}${e.calendar ? ` [${e.calendar}]` : ''}`);
  }
  return lines.join('\n');
}

// ── spend ───────────────────────────────────────────────────────────────────

export async function spendTool(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const days = clampInt(args.days, 7, 180, 60);
  const q = query(args.merchant);
  const floor = localDay(new Date(now.getTime() - days * 86_400_000));
  const rows = await db
    .select({
      day: daydreamSpend.day,
      merchant: daydreamSpend.merchant,
      amountMinor: daydreamSpend.amountMinor,
      currency: daydreamSpend.currency,
    })
    .from(daydreamSpend)
    .where(
      and(
        eq(daydreamSpend.subject, DEFAULT_SUBJECT),
        eq(daydreamSpend.verified, true),
        gte(daydreamSpend.day, floor),
        q ? ilike(daydreamSpend.merchant, likeTerm(q)) : undefined,
      ),
    )
    .orderBy(desc(daydreamSpend.day))
    .limit(150);
  if (!rows.length) return `No verified spend in the last ${days} days${q ? ` matching "${q}"` : ''}. Absence of evidence, not of spending.`;

  const money = (minor: number, cur: string) => `${cur === 'GBP' ? '£' : `${cur} `}${(minor / 100).toFixed(2)}`;
  const byMerchant = new Map<string, { n: number; total: number; cur: string }>();
  for (const r of rows) {
    const m = byMerchant.get(r.merchant) ?? { n: 0, total: 0, cur: r.currency };
    m.n++;
    m.total += r.amountMinor;
    byMerchant.set(r.merchant, m);
  }
  const lines = [`Verified spend, last ${days} days: ${rows.length} row(s).`, 'By merchant (count, total):'];
  for (const [name, m] of [...byMerchant.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
    lines.push(`  ${name}: ${m.n}× ${money(m.total, m.cur)}`);
  }
  lines.push('Rows, newest first:');
  for (const r of rows.slice(0, 50)) lines.push(`  ${r.day} ${r.merchant} ${money(r.amountMinor, r.currency)}`);
  return lines.join('\n');
}

// ── chat_threads ────────────────────────────────────────────────────────────

export async function chatThreadsTool(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const days = clampInt(args.days, 1, 60, 14);
  const since = new Date(now.getTime() - days * 86_400_000);
  const threads = await db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    // The owner's threads only — a member's thread is never daydream material.
    .where(and(gte(conversations.updatedAt, since), ownerThread))
    .orderBy(desc(conversations.updatedAt))
    .limit(25);
  if (!threads.length) return `No jkai threads active in the last ${days} days.`;

  // His turns, not the heartbeat's: a pulse posts a synthetic `user` message
  // into the thread it is continuing, and that is the engine talking to itself.
  const ownTurn = and(eq(orchestratorChats.role, 'user'), sql`${orchestratorChats.metadata}->'heartbeat' is null`);
  const lines = [`jkai threads active in the last ${days} days, newest first (his own words only):`];
  for (const t of threads) {
    // Counts and first/last of HIS turns. One small query per thread, 25 at most.
    const [stats] = await db
      .select({
        n: sql<number>`count(*)::int`,
        first: sql<Date | null>`min(${orchestratorChats.createdAt})`,
        last: sql<Date | null>`max(${orchestratorChats.createdAt})`,
      })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.conversationId, t.id), ownTurn));
    const [opening] = await db
      .select({ content: orchestratorChats.content })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.conversationId, t.id), ownTurn))
      .orderBy(orchestratorChats.createdAt)
      .limit(1);
    const when = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '?');
    const open = (opening?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    lines.push(
      `  "${(t.title ?? 'untitled').slice(0, 80)}" — ${stats?.n ?? 0} message(s) from him, ${when(stats?.first)} to ${when(stats?.last)} UTC${open ? `; he opened with: ${open}` : ''}`,
    );
  }
  return lines.join('\n');
}
