// src/lib/daydream/mail-room.server.ts
//
// The source backlog's queries, for the think loop's `backlog` tool, the drain
// and the Mail room page. Every read is scoped to the owner in the query
// (`spaceIn(…, OWNER_INTEL_SCOPE)`): a member's mailbox may be linked, and a
// member's correspondence is not his.
//
// Main READS `facts` and WRITES only the three consideration columns. Intake
// and extraction are SR-Jkai-Core's (`intel/source-backlog.ts`).

import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, sourceBacklog } from '$lib/db/schema';
import { OWNER_INTEL_SCOPE, spaceIn } from '$lib/intel-client/scope';
import { getSetting } from '$lib/server/models/settings';
import {
  BACKLOG_SOURCES,
  DRAIN_BATCH,
  SOURCE_LABEL,
  addDays,
  dueText,
  isCategory,
  readBackfill,
  readFacts,
  readLastRun,
  readToday,
  searchText,
  sourceHref,
  timeCritical,
  totalsText,
  worthALook,
  type BacklogItem,
  type BacklogSource,
  type MailRoomDeck,
  type TotalRow,
} from './mail-room';

const owner = () => spaceIn(sourceBacklog.spaceId, OWNER_INTEL_SCOPE);
const read = () => and(owner(), eq(sourceBacklog.state, 'extracted'), isNotNull(sourceBacklog.facts));

const COLUMNS = {
  id: sourceBacklog.id,
  source: sourceBacklog.source,
  refId: sourceBacklog.refId,
  accountEmail: sourceBacklog.accountEmail,
  observedAt: sourceBacklog.observedAt,
  kind: sourceBacklog.kind,
  title: sourceBacklog.title,
  senderDomain: sourceBacklog.senderDomain,
  category: sourceBacklog.category,
  needsAction: sourceBacklog.needsAction,
  actionBy: sourceBacklog.actionBy,
  model: sourceBacklog.model,
  consideration: sourceBacklog.consideration,
  facts: sourceBacklog.facts,
};

type Row = { [K in keyof typeof COLUMNS]: (typeof COLUMNS)[K]['_']['data'] | null };

function toItem(r: Row): BacklogItem {
  const source = (BACKLOG_SOURCES as readonly string[]).includes(r.source ?? '') ? (r.source as BacklogSource) : 'gmail';
  return {
    id: r.id!,
    source,
    refId: r.refId ?? '',
    accountEmail: r.accountEmail ?? '',
    observedAt: (r.observedAt ?? new Date(0)).toISOString(),
    kind: r.kind,
    title: r.title,
    senderDomain: r.senderDomain,
    category: r.category,
    needsAction: r.needsAction === true,
    actionBy: r.actionBy,
    model: r.model,
    consideration: r.consideration,
    facts: readFacts(r.facts),
  };
}

function clampInt(raw: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
}

/** Escape LIKE wildcards so a model's `%` is a character, not a scan. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** How far behind today a missed deadline is still listed. */
const OVERDUE_WINDOW_DAYS = 14;

/** What needs something from him: dated inside the window, or undated and recent. */
export async function dueItems(opts: { daysAhead: number; limit: number }, now = new Date()): Promise<BacklogItem[]> {
  const today = utcDay(now);
  const rows = await db
    .select(COLUMNS)
    .from(sourceBacklog)
    .where(
      and(
        read(),
        eq(sourceBacklog.needsAction, true),
        or(
          and(gte(sourceBacklog.actionBy, addDays(today, -OVERDUE_WINDOW_DAYS)), lte(sourceBacklog.actionBy, addDays(today, opts.daysAhead))),
          and(isNull(sourceBacklog.actionBy), gte(sourceBacklog.observedAt, new Date(now.getTime() - 30 * 86_400_000))),
        ),
      ),
    )
    .orderBy(sql`${sourceBacklog.actionBy} ASC NULLS LAST`, desc(sourceBacklog.observedAt))
    .limit(opts.limit);
  return rows.map(toItem);
}

export interface BacklogSearch {
  query?: string;
  category?: string;
  sender?: string;
  daysBack: number;
  limit: number;
}

function searchWhere(opts: BacklogSearch, now: Date) {
  const q = opts.query ? likeTerm(opts.query) : null;
  return and(
    read(),
    gte(sourceBacklog.observedAt, new Date(now.getTime() - opts.daysBack * 86_400_000)),
    opts.category ? eq(sourceBacklog.category, opts.category) : undefined,
    opts.sender ? ilike(sourceBacklog.senderDomain, likeTerm(opts.sender)) : undefined,
    q
      ? or(
          sql`${sourceBacklog.facts}->>'summary' ILIKE ${q}`,
          sql`(${sourceBacklog.facts}->'parties')::text ILIKE ${q}`,
          sql`(${sourceBacklog.facts}->'documents')::text ILIKE ${q}`,
          ilike(sourceBacklog.senderDomain, q),
        )
      : undefined,
  );
}

export async function searchItems(opts: BacklogSearch, now = new Date()): Promise<{ items: BacklogItem[]; total: number }> {
  const where = searchWhere(opts, now);
  const [rows, [count]] = await Promise.all([
    db.select(COLUMNS).from(sourceBacklog).where(where).orderBy(desc(sourceBacklog.observedAt)).limit(opts.limit),
    db.select({ n: sql<number>`count(*)::int` }).from(sourceBacklog).where(where),
  ]);
  return { items: rows.map(toItem), total: count?.n ?? rows.length };
}

/** Items and first amounts per sender or category, per month. */
export async function totals(opts: { by: 'sender' | 'category'; months: number; category?: string; sender?: string }, now = new Date()): Promise<TotalRow[]> {
  const key = opts.by === 'sender' ? sql<string>`coalesce(${sourceBacklog.senderDomain}, '(no sender)')` : sql<string>`coalesce(${sourceBacklog.category}, 'other')`;
  const month = sql<string>`to_char(${sourceBacklog.observedAt} AT TIME ZONE 'UTC', 'YYYY-MM')`;
  // Core writes `minor` as an integer; anything else counts as nothing rather than failing the cast.
  const first = sql`${sourceBacklog.facts}->'amounts'->0`;
  const minor = sql<number>`coalesce(sum(CASE WHEN ${first}->>'minor' ~ '^-?[0-9]{1,12}$' THEN (${first}->>'minor')::bigint ELSE 0 END), 0)::float8`;
  const currency = sql<string | null>`${first}->>'currency'`;
  const rows = await db
    .select({ key, month, items: sql<number>`count(*)::int`, minor, currency })
    .from(sourceBacklog)
    .where(
      and(
        read(),
        gte(sourceBacklog.observedAt, new Date(now.getTime() - opts.months * 31 * 86_400_000)),
        opts.category ? eq(sourceBacklog.category, opts.category) : undefined,
        opts.sender ? ilike(sourceBacklog.senderDomain, likeTerm(opts.sender)) : undefined,
      ),
    )
    .groupBy(key, month, currency)
    .orderBy(desc(sql`count(*)`))
    .limit(2000);
  return rows.map((r) => ({ key: String(r.key).slice(0, 80), month: r.month, items: r.items, minor: Number(r.minor) || 0, currency: /^[A-Z]{3}$/.test(r.currency ?? '') ? r.currency : null }));
}

/** The think loop's `backlog` tool. */
export async function backlogTool(args: Record<string, unknown>, now = new Date()): Promise<string> {
  const mode = args.mode === 'search' || args.mode === 'totals' ? args.mode : 'due';
  const category = isCategory(args.category) ? args.category : undefined;
  const sender = typeof args.sender === 'string' && args.sender.trim() ? args.sender.trim().slice(0, 80) : undefined;
  if (mode === 'due') {
    return dueText(await dueItems({ daysAhead: clampInt(args.daysAhead, 1, 120, 30), limit: 30 }, now), utcDay(now));
  }
  if (mode === 'search') {
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 80) : '';
    if (!query && !category && !sender) return 'search needs a query, a category or a sender.';
    const { items, total } = await searchItems({ query: query || undefined, category, sender, daysBack: clampInt(args.daysBack, 1, 400, 90), limit: 20 }, now);
    return searchText(items, total);
  }
  const by = args.by === 'category' ? 'category' : 'sender';
  return totalsText(await totals({ by, months: clampInt(args.months, 1, 13, 6), category, sender }, now), by);
}

// ── The drain ───────────────────────────────────────────────────────────────

export type Consideration = 'note' | 'nothing' | 'aggregate';

export async function markConsidered(ids: string[], consideration: Consideration, now = new Date(), thoughtId: string | null = null): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    await db
      .update(sourceBacklog)
      .set({ consideredAt: now, consideration, ...(thoughtId ? { thoughtId } : {}) })
      .where(and(owner(), inArray(sourceBacklog.id, ids.slice(i, i + 200))));
  }
}

/** Unconsidered rows scanned per cycle while looking for a batch. */
const DRAIN_SCAN = 1500;

export interface DrainBatch {
  items: Array<BacklogItem & { critical: boolean }>;
  /** Rows filed as reachable in aggregate only, without a look. */
  filed: number;
}

/**
 * The next rows worth a look, most pressing first. Rows that are not
 * (`worthALook`) are marked 'aggregate' on the way past, so twelve months of
 * newsletters cost queries and never a model call.
 */
export async function drainBatch(now = new Date(), limit = DRAIN_BATCH): Promise<DrainBatch> {
  const items: DrainBatch['items'] = [];
  let filed = 0;
  for (let scanned = 0; scanned < DRAIN_SCAN && items.length < limit; ) {
    const rows = await db
      .select(COLUMNS)
      .from(sourceBacklog)
      .where(and(read(), isNull(sourceBacklog.consideredAt)))
      .orderBy(desc(sourceBacklog.needsAction), desc(sourceBacklog.priority), desc(sourceBacklog.observedAt))
      // Rows already taken this cycle are still unconsidered: read past them.
      .offset(items.length)
      .limit(300);
    if (!rows.length) break;
    scanned += rows.length;
    const pass: string[] = [];
    for (const item of rows.map(toItem)) {
      if (items.length < limit && worthALook(item, now)) items.push({ ...item, critical: timeCritical(item, now) });
      else if (!worthALook(item, now)) pass.push(item.id);
    }
    if (pass.length) await markConsidered(pass, 'aggregate', now);
    filed += pass.length;
    // Nothing filed and the batch is full or the page was short: no more to learn.
    if (!pass.length) break;
  }
  return { items, filed };
}

// ── The room ────────────────────────────────────────────────────────────────

export interface RoomItem {
  id: string;
  source: BacklogSource;
  sourceLabel: string;
  day: string;
  from: string;
  category: string;
  summary: string;
  todo: string | null;
  by: string | null;
  overdue: boolean;
  amount: { minor: number; currency: string } | null;
  href: string | null;
  consideration: string | null;
}

export interface RoomNote {
  id: string;
  title: string;
  body: string;
  day: string;
  status: string;
  items: number;
}

export interface MailRoomData {
  deck: MailRoomDeck;
  due: RoomItem[];
  notes: RoomNote[];
  recent: RoomItem[];
}

function roomItem(i: BacklogItem, today: string): RoomItem {
  const by = i.actionBy ?? i.facts?.action?.by ?? null;
  const a = i.facts?.amounts[0] ?? null;
  return {
    id: i.id,
    source: i.source,
    sourceLabel: SOURCE_LABEL[i.source],
    day: i.observedAt.slice(0, 10),
    from: i.facts?.parties[0]?.name || i.senderDomain || SOURCE_LABEL[i.source],
    category: i.category ?? 'other',
    summary: i.facts?.summary ?? '',
    todo: i.facts?.action?.what ?? i.facts?.asks.find((x) => x.waitingOn === 'me')?.what ?? null,
    by,
    overdue: !!by && by < today,
    amount: a ? { minor: a.minor, currency: a.currency } : null,
    href: sourceHref(i),
    consideration: i.consideration,
  };
}

export async function mailRoomData(now = new Date()): Promise<MailRoomData> {
  const today = utcDay(now);
  const [counts, due, recentRows, noteRows, backfill, lastRun, todayCount] = await Promise.all([
    db
      .select({
        source: sourceBacklog.source,
        total: sql<number>`count(*)::int`,
        waiting: sql<number>`count(*) FILTER (WHERE ${sourceBacklog.state} = 'queued')::int`,
        read: sql<number>`count(*) FILTER (WHERE ${sourceBacklog.state} = 'extracted')::int`,
        failed: sql<number>`count(*) FILTER (WHERE ${sourceBacklog.state} = 'failed')::int`,
        needs: sql<number>`count(*) FILTER (WHERE ${sourceBacklog.state} = 'extracted' AND ${sourceBacklog.needsAction})::int`,
      })
      .from(sourceBacklog)
      .where(owner())
      .groupBy(sourceBacklog.source),
    dueItems({ daysAhead: 60, limit: 40 }, now),
    db
      .select(COLUMNS)
      .from(sourceBacklog)
      .where(and(read(), sql`${sourceBacklog.kind} IS DISTINCT FROM 'bulk'`, sql`${sourceBacklog.model} IS DISTINCT FROM 'code'`))
      .orderBy(desc(sourceBacklog.observedAt))
      .limit(40),
    db
      .select({
        id: daydreamThoughts.id,
        title: daydreamThoughts.title,
        narrative: daydreamThoughts.narrative,
        status: daydreamThoughts.status,
        createdAt: daydreamThoughts.createdAt,
        items: sql<number>`count(${sourceBacklog.id})::int`,
      })
      .from(sourceBacklog)
      .innerJoin(daydreamThoughts, eq(daydreamThoughts.id, sourceBacklog.thoughtId))
      .where(and(owner(), gte(daydreamThoughts.createdAt, new Date(now.getTime() - 30 * 86_400_000)), sql`${daydreamThoughts.status} <> 'dismissed'`,
          // Held back for a reason of the loop's own (the room, the cap, no step) — not one the audit refused.
          sql`(${daydreamThoughts.status} <> 'suppressed' OR ${daydreamThoughts.suppressedReason} LIKE 'room:%' OR ${daydreamThoughts.suppressedReason} LIKE 'feed_only%' OR ${daydreamThoughts.suppressedReason} LIKE 'notify:%')`))
      .groupBy(daydreamThoughts.id)
      .orderBy(desc(daydreamThoughts.createdAt))
      .limit(30),
    getSetting('backlog.backfill').catch(() => null),
    getSetting('backlog.last_run').catch(() => null),
    getSetting('backlog.today').catch(() => null),
  ]);

  const bySource = new Map(counts.map((c) => [c.source, c]));
  const sum = (k: 'waiting' | 'read' | 'failed' | 'needs') => counts.reduce((n, c) => n + c[k], 0);
  return {
    deck: {
      read: sum('read'),
      waiting: sum('waiting'),
      failed: sum('failed'),
      needsDoing: sum('needs'),
      sources: BACKLOG_SOURCES.map((s) => ({ source: s, label: SOURCE_LABEL[s], total: bySource.get(s)?.total ?? 0, waiting: bySource.get(s)?.waiting ?? 0 })),
      backfill: readBackfill(backfill),
      today: readToday(todayCount, today),
      lastRun: readLastRun(lastRun),
    },
    due: due.map((i) => roomItem(i, today)),
    notes: noteRows.map((n) => ({ id: n.id, title: n.title, body: n.narrative ?? '', day: n.createdAt.toISOString().slice(0, 10), status: n.status, items: n.items })),
    recent: recentRows.map(toItem).map((i) => roomItem(i, today)),
  };
}
