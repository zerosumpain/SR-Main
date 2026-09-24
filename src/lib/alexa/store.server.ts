// Reading the utterance log back — one set of numbers for the page and the tools.
//
// Days and hours are Europe/London: the server runs UTC, and "what does the
// house ask Alexa at bedtime" is a question about the house's clock.

import { and, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/db';
import { alexaUtterances, type AlexaUtterance } from '$lib/db/schema';
import { isVoiceTopic } from './types';

const TZ = 'Europe/London';

/**
 * Alexa not managing. Read off the reply's opening, which is where Alexa puts
 * it — "Sorry, I don't know that", "Hmm, I'm not sure". An EMPTY reply is not a
 * miss: "play upbeat music" and "what's the BBC news" come back with no text
 * because Alexa just did it. A heuristic, and the tools say so.
 */
export const MISS_REPLY_PATTERN = "^(sorry|hmm|i (don'?t|do not) know|i'?m not sure|i didn'?t (catch|understand)|i can'?t (help|find)|i couldn'?t)";

const missSql = sql`(${alexaUtterances.reply} ~* ${MISS_REPLY_PATTERN})`;

export interface Count {
  key: string;
  n: number;
}

export interface VoiceSummary {
  window: { from: string; to: string; days: number };
  total: number;
  previousTotal: number;
  allTime: number;
  firstAt: string | null;
  lastAt: string | null;
  missed: number;
  untagged: number;
  byDay: Count[];
  byHour: number[];
  byDevice: (Count & { room: string | null })[];
  byPerson: Count[];
  byTopic: Count[];
  topIntents: Count[];
  topCommands: Count[];
}

function counts(rows: { key: string | null; n: number }[], fallback: string): Count[] {
  return rows.map((r) => ({ key: r.key ?? fallback, n: Number(r.n) }));
}

export function emptyVoiceSummary(days = 30): VoiceSummary {
  const to = new Date();
  return {
    window: { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString(), days },
    total: 0,
    previousTotal: 0,
    allTime: 0,
    firstAt: null,
    lastAt: null,
    missed: 0,
    untagged: 0,
    byDay: [],
    byHour: Array.from({ length: 24 }, () => 0),
    byDevice: [],
    byPerson: [],
    byTopic: [],
    topIntents: [],
    topCommands: [],
  };
}

export async function voiceSummary(opts: { days?: number; device?: string | null; person?: string | null } = {}): Promise<VoiceSummary> {
  const days = opts.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  const scope: SQL[] = [];
  if (opts.device) scope.push(eq(alexaUtterances.device, opts.device));
  if (opts.person) scope.push(personFilter(opts.person));
  const inWindow = and(gte(alexaUtterances.occurredAt, from), ...scope);
  const u = alexaUtterances;
  const local = sql`(${u.occurredAt} at time zone ${TZ})`;

  const [head, prev, byDay, byHour, byDevice, byPerson, byTopic, intents, commands] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*) filter (where ${u.occurredAt} >= ${from})::int`,
        allTime: sql<number>`count(*)::int`,
        firstAt: sql<Date | null>`min(${u.occurredAt})`,
        lastAt: sql<Date | null>`max(${u.occurredAt})`,
        missed: sql<number>`count(*) filter (where ${u.occurredAt} >= ${from} and ${missSql})::int`,
        untagged: sql<number>`count(*) filter (where ${u.topic} is null)::int`,
      })
      .from(u)
      .where(scope.length ? and(...scope) : undefined),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(u)
      .where(and(gte(u.occurredAt, prevFrom), lt(u.occurredAt, from), ...scope)),
    db
      .select({ key: sql<string>`to_char(${local}, 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(u)
      .where(inWindow)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ hour: sql<number>`extract(hour from ${local})::int`, n: sql<number>`count(*)::int` })
      .from(u)
      .where(inWindow)
      .groupBy(sql`1`),
    db
      .select({ key: u.device, room: sql<string | null>`max(${u.room})`, n: sql<number>`count(*)::int` })
      .from(u)
      .where(inWindow)
      .groupBy(u.device)
      .orderBy(sql`3 desc`),
    db
      .select({ key: u.personName, n: sql<number>`count(*)::int` })
      .from(u)
      .where(inWindow)
      .groupBy(u.personName)
      .orderBy(sql`2 desc`),
    db
      .select({ key: u.topic, n: sql<number>`count(*)::int` })
      .from(u)
      .where(inWindow)
      .groupBy(u.topic)
      .orderBy(sql`2 desc`),
    db
      .select({ key: u.intent, n: sql<number>`count(*)::int` })
      .from(u)
      .where(and(inWindow, sql`${u.intent} is not null`))
      .groupBy(u.intent)
      .orderBy(sql`2 desc`)
      .limit(12),
    db
      .select({ key: sql<string>`lower(${u.command})`, n: sql<number>`count(*)::int` })
      .from(u)
      .where(inWindow)
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`, sql`1`)
      .limit(15),
  ]);

  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of byHour) hours[Number(r.hour)] = Number(r.n);
  const h = head[0];
  return {
    window: { from: from.toISOString(), to: to.toISOString(), days },
    total: Number(h?.total ?? 0),
    previousTotal: Number(prev[0]?.n ?? 0),
    allTime: Number(h?.allTime ?? 0),
    firstAt: h?.firstAt ? new Date(h.firstAt).toISOString() : null,
    lastAt: h?.lastAt ? new Date(h.lastAt).toISOString() : null,
    missed: Number(h?.missed ?? 0),
    untagged: Number(h?.untagged ?? 0),
    byDay: counts(byDay, ''),
    byHour: hours,
    byDevice: byDevice.map((r) => ({ key: r.key, room: r.room, n: Number(r.n) })),
    byPerson: counts(byPerson, 'Unrecognised'),
    byTopic: counts(byTopic, 'untagged'),
    topIntents: counts(intents, ''),
    topCommands: counts(commands, ''),
  };
}

/** "unrecognised" (any case) means voice ID did not know the speaker. */
function personFilter(person: string): SQL {
  return /^unrecogni[sz]ed$|^unknown$/i.test(person.trim())
    ? isNull(alexaUtterances.personName)
    : ilike(alexaUtterances.personName, person.trim());
}

export interface VoiceSearch {
  query?: string | null;
  device?: string | null;
  person?: string | null;
  topic?: string | null;
  missedOnly?: boolean;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
}

export const SEARCH_MAX = 500;

export async function searchUtterances(s: VoiceSearch = {}): Promise<AlexaUtterance[]> {
  const u = alexaUtterances;
  const where: SQL[] = [];
  if (s.query?.trim()) {
    const like = `%${s.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(u.command, like), ilike(u.reply, like), ilike(u.intent, like)) as SQL);
  }
  if (s.device?.trim()) where.push(ilike(u.device, `%${s.device.trim()}%`));
  if (s.person?.trim()) where.push(personFilter(s.person));
  if (s.topic && isVoiceTopic(s.topic)) where.push(eq(u.topic, s.topic));
  if (s.missedOnly) where.push(missSql);
  if (s.from) where.push(gte(u.occurredAt, s.from));
  if (s.to) where.push(lt(u.occurredAt, s.to));
  const limit = Math.max(1, Math.min(SEARCH_MAX, Math.floor(s.limit ?? 50)));
  return db
    .select()
    .from(u)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(u.occurredAt))
    .limit(limit);
}

/** Rows the topic tagger has not reached yet, oldest first. */
export async function untaggedUtterances(limit: number): Promise<Pick<AlexaUtterance, 'id' | 'command' | 'reply' | 'intent'>[]> {
  const u = alexaUtterances;
  return db
    .select({ id: u.id, command: u.command, reply: u.reply, intent: u.intent })
    .from(u)
    .where(isNull(u.topic))
    .orderBy(u.occurredAt)
    .limit(limit);
}
