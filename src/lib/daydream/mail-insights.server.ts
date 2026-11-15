// src/lib/daydream/mail-insights.server.ts
//
// The Mail room's insights view. Reads `facts` only, scoped to the owner in
// every query through `read()` (pinned by `think/tools.test.ts`), and makes no
// model call: the sums are SQL and the rest is `mail-insights.ts`.

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { sourceBacklog } from '$lib/db/schema';
import { addDays, type TotalRow } from './mail-room';
import { COLUMNS, read, toItem } from './mail-room.server';
import {
  SPEND_CATEGORIES,
  UPCOMING_DAYS,
  changes,
  recurring,
  spendByMonth,
  spendBySender,
  upcoming,
  waiting,
  type MailInsights,
} from './mail-insights';

const SPEND_MONTHS = 12;
const WAITING_DAYS = 60;
const NOISE_DAYS = 90;
/** Mail a sender must send in the window, with nothing to do in any of it, to be listed as noise. */
const NOISE_MIN = 6;

const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000);
const notBulk = sql`${sourceBacklog.kind} IS DISTINCT FROM 'bulk'`;

export async function mailInsights(now = new Date()): Promise<MailInsights> {
  const today = now.toISOString().slice(0, 10);
  // From the first of the month twelve months back, so every month shown is whole or current.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - SPEND_MONTHS, 1));
  const month = sql<string>`to_char(${sourceBacklog.observedAt} AT TIME ZONE 'UTC', 'YYYY-MM')`;
  const sender = sql<string>`coalesce(${sourceBacklog.senderDomain}, '(no sender)')`;
  // Core writes `minor` as an integer; anything else counts as nothing rather than failing the cast.
  const first = sql`${sourceBacklog.facts}->'amounts'->0`;
  const minor = sql<number>`coalesce(sum(CASE WHEN ${first}->>'minor' ~ '^-?[0-9]{1,12}$' THEN (${first}->>'minor')::bigint ELSE 0 END), 0)::float8`;
  const currency = sql<string | null>`${first}->>'currency'`;
  const until = addDays(today, UPCOMING_DAYS);

  const [spendRows, changeRows, dateRows, askRows, noiseRows] = await Promise.all([
    db
      .select({ key: sender, month, items: sql<number>`count(*)::int`, minor, currency })
      .from(sourceBacklog)
      .where(and(read(), notBulk, gte(sourceBacklog.observedAt, from), inArray(sourceBacklog.category, [...SPEND_CATEGORIES])))
      .groupBy(sender, month, currency)
      .limit(5000),
    db
      .select(COLUMNS)
      .from(sourceBacklog)
      .where(and(read(), gte(sourceBacklog.observedAt, from), sql`jsonb_typeof(${sourceBacklog.facts}->'change') = 'object'`))
      .orderBy(desc(sourceBacklog.observedAt))
      .limit(40),
    db
      .select(COLUMNS)
      .from(sourceBacklog)
      .where(
        and(
          read(),
          sql`jsonb_typeof(${sourceBacklog.facts}->'dates') = 'array'`,
          sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${sourceBacklog.facts}->'dates') d WHERE d->>'date' >= ${today} AND d->>'date' <= ${until})`,
        ),
      )
      .orderBy(desc(sourceBacklog.observedAt))
      .limit(400),
    db
      .select(COLUMNS)
      .from(sourceBacklog)
      .where(and(read(), notBulk, gte(sourceBacklog.observedAt, daysAgo(now, WAITING_DAYS)), sql`jsonb_array_length(CASE WHEN jsonb_typeof(${sourceBacklog.facts}->'asks') = 'array' THEN ${sourceBacklog.facts}->'asks' ELSE '[]'::jsonb END) > 0`))
      .orderBy(desc(sourceBacklog.observedAt))
      .limit(200),
    db
      .select({
        sender: sourceBacklog.senderDomain,
        items: sql<number>`count(*)::int`,
        marketing: sql<number>`count(*) FILTER (WHERE ${sourceBacklog.kind} = 'bulk')::int`,
      })
      .from(sourceBacklog)
      .where(and(read(), eq(sourceBacklog.source, 'gmail'), gte(sourceBacklog.observedAt, daysAgo(now, NOISE_DAYS))))
      .groupBy(sourceBacklog.senderDomain)
      .having(sql`count(*) >= ${NOISE_MIN} AND count(*) FILTER (WHERE ${sourceBacklog.needsAction}) = 0 AND ${sourceBacklog.senderDomain} IS NOT NULL`)
      .orderBy(desc(sql`count(*)`))
      .limit(25),
  ]);

  const rows: TotalRow[] = spendRows.map((r) => ({
    key: String(r.key).slice(0, 80),
    month: r.month,
    items: r.items,
    minor: Number(r.minor) || 0,
    currency: /^[A-Z]{3}$/.test(r.currency ?? '') ? r.currency : null,
  }));
  const bySender = spendBySender(rows);
  const wait = waiting(askRows.map(toItem));
  return {
    window: { from: from.toISOString().slice(0, 7), to: today.slice(0, 7) },
    byMonth: spendByMonth(rows),
    bySender: bySender.slice(0, 25),
    recurring: recurring(bySender).slice(0, 40),
    rose: bySender.filter((s) => s.rose).slice(0, 15),
    changes: changes(changeRows.map(toItem)),
    upcoming: upcoming(dateRows.map(toItem), today).slice(0, 60),
    onMe: wait.onMe.slice(0, 30),
    onThem: wait.onThem.slice(0, 30),
    noise: noiseRows.map((n) => ({ sender: String(n.sender), items: n.items, marketing: n.marketing })),
  };
}
