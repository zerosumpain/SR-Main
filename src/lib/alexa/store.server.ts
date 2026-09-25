// Reading the utterance log back — one set of numbers for the page and the tools.
//
// Days and hours are Europe/London: the server runs UTC, and "what does the
// house ask Alexa at bedtime" is a question about the house's clock.

import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/db';
import { alexaSignals, alexaUtterances, type AlexaUtterance } from '$lib/db/schema';
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

// ── Everything else the Echos report (`alexa_signals`) ─────────────────────

export interface SignalPoint {
  at: string;
  value: number;
}

export interface HouseSummary {
  window: { from: string; to: string; days: number };
  allTime: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Latest reading per room-sensor entity. */
  now: { device: string; room: string | null; kind: 'temperature' | 'illuminance' | 'motion'; value: number | null; text: string | null; at: string }[];
  /** Hourly mean per device, Europe/London hours; a missing hour is absent, not zero. */
  temperature: { device: string; room: string | null; min: number; max: number; points: SignalPoint[] }[];
  motion: { device: string; room: string | null; lastOnAt: string | null; onCount: number; byHour: number[] }[];
  /** What each device is holding right now — only future times count. */
  pending: { device: string; room: string | null; kind: 'alarm' | 'timer' | 'reminder'; dueAt: string; setAt: string }[];
  /** Every alarm/timer/reminder that came into view in the window, newest first. */
  scheduled: { device: string; room: string | null; kind: 'alarm' | 'timer' | 'reminder'; dueAt: string; setAt: string }[];
  listening: {
    plays: number;
    recent: { device: string; room: string | null; title: string; artist: string | null; album: string | null; at: string }[];
    topArtists: Count[];
    byDevice: Count[];
  };
}

export function emptyHouseSummary(days = 30): HouseSummary {
  const to = new Date();
  return {
    window: { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString(), days },
    allTime: 0,
    firstAt: null,
    lastAt: null,
    now: [],
    temperature: [],
    motion: [],
    pending: [],
    scheduled: [],
    listening: { plays: 0, recent: [], topArtists: [], byDevice: [] },
  };
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
type NoticeKind = 'alarm' | 'timer' | 'reminder';
const NOTICE_KINDS: NoticeKind[] = ['alarm', 'timer', 'reminder'];

export async function houseSummary(opts: { days?: number } = {}): Promise<HouseSummary> {
  const days = opts.days ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const g = alexaSignals;
  const inWindow = gte(g.occurredAt, from);
  const local = sql`(${g.occurredAt} at time zone ${TZ})`;
  const artist = sql<string | null>`${g.detail}->>'artist'`;

  const [head, now, temps, motionRows, motionHours, latestNotice, scheduled, recent, artists, mediaDevices, plays] = await Promise.all([
    db
      .select({ allTime: sql<number>`count(*)::int`, firstAt: sql<Date | null>`min(${g.occurredAt})`, lastAt: sql<Date | null>`max(${g.occurredAt})` })
      .from(g),
    db
      .selectDistinctOn([g.entityId], { device: g.device, room: g.room, kind: g.kind, value: g.value, text: g.text, at: g.occurredAt })
      .from(g)
      .where(inArray(g.kind, ['temperature', 'illuminance', 'motion']))
      .orderBy(g.entityId, desc(g.occurredAt)),
    db
      .select({
        device: g.device,
        room: sql<string | null>`max(${g.room})`,
        hour: sql<Date>`date_trunc('hour', ${local}) at time zone ${TZ}`,
        value: sql<number>`round(avg(${g.value})::numeric, 1)::float8`,
      })
      .from(g)
      .where(and(eq(g.kind, 'temperature'), inWindow))
      .groupBy(g.device, sql`3`)
      .orderBy(g.device, sql`3`),
    db
      .select({
        device: g.device,
        room: sql<string | null>`max(${g.room})`,
        lastOnAt: sql<Date | null>`max(${g.occurredAt}) filter (where ${g.text} = 'on')`,
        onCount: sql<number>`count(*) filter (where ${g.text} = 'on' and ${g.occurredAt} >= ${from})::int`,
      })
      .from(g)
      .where(eq(g.kind, 'motion'))
      .groupBy(g.device),
    db
      .select({ device: g.device, hour: sql<number>`extract(hour from ${local})::int`, n: sql<number>`count(*)::int` })
      .from(g)
      .where(and(eq(g.kind, 'motion'), eq(g.text, 'on'), inWindow))
      .groupBy(g.device, sql`2`),
    db
      .selectDistinctOn([g.entityId], { device: g.device, room: g.room, kind: g.kind, text: g.text, at: g.occurredAt })
      .from(g)
      .where(inArray(g.kind, NOTICE_KINDS))
      .orderBy(g.entityId, desc(g.occurredAt)),
    db
      .select({ device: g.device, room: g.room, kind: g.kind, text: g.text, at: g.occurredAt })
      .from(g)
      .where(and(inArray(g.kind, NOTICE_KINDS), inWindow, sql`${g.text} is not null`))
      .orderBy(desc(g.occurredAt))
      .limit(200),
    db
      .select({ device: g.device, room: g.room, title: g.text, detail: g.detail, at: g.occurredAt })
      .from(g)
      .where(and(eq(g.kind, 'media'), inWindow))
      .orderBy(desc(g.occurredAt))
      .limit(200),
    db
      .select({ key: artist, n: sql<number>`count(*)::int` })
      .from(g)
      .where(and(eq(g.kind, 'media'), inWindow, sql`${artist} is not null`))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`, sql`1`)
      .limit(15),
    db
      .select({ key: g.device, n: sql<number>`count(*)::int` })
      .from(g)
      .where(and(eq(g.kind, 'media'), inWindow))
      .groupBy(g.device)
      .orderBy(sql`2 desc`),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(g)
      .where(and(eq(g.kind, 'media'), inWindow)),
  ]);

  const tempByDevice = new Map<string, HouseSummary['temperature'][number]>();
  for (const r of temps) {
    const t = tempByDevice.get(r.device) ?? { device: r.device, room: r.room, min: Infinity, max: -Infinity, points: [] };
    const v = Number(r.value);
    t.points.push({ at: new Date(r.hour).toISOString(), value: v });
    t.min = Math.min(t.min, v);
    t.max = Math.max(t.max, v);
    tempByDevice.set(r.device, t);
  }
  const hoursByDevice = new Map<string, number[]>();
  for (const r of motionHours) {
    const h = hoursByDevice.get(r.device) ?? Array.from({ length: 24 }, () => 0);
    h[Number(r.hour)] = Number(r.n);
    hoursByDevice.set(r.device, h);
  }
  const nowMs = to.getTime();
  const notice = (r: { device: string; room: string | null; kind: string; text: string | null; at: Date }) => ({
    device: r.device,
    room: r.room,
    kind: r.kind as NoticeKind,
    dueAt: r.text as string,
    setAt: new Date(r.at).toISOString(),
  });

  const h = head[0];
  return {
    window: { from: from.toISOString(), to: to.toISOString(), days },
    allTime: Number(h?.allTime ?? 0),
    firstAt: iso(h?.firstAt),
    lastAt: iso(h?.lastAt),
    now: now
      .map((r) => ({ ...r, kind: r.kind as 'temperature' | 'illuminance' | 'motion', at: new Date(r.at).toISOString() }))
      .sort((a, b) => a.device.localeCompare(b.device) || a.kind.localeCompare(b.kind)),
    temperature: [...tempByDevice.values()],
    motion: motionRows.map((r) => ({
      device: r.device,
      room: r.room,
      lastOnAt: iso(r.lastOnAt),
      onCount: Number(r.onCount),
      byHour: hoursByDevice.get(r.device) ?? Array.from({ length: 24 }, () => 0),
    })),
    pending: latestNotice
      .filter((r) => r.text && Date.parse(r.text) > nowMs)
      .map(notice)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    scheduled: scheduled.map(notice),
    listening: {
      plays: Number(plays[0]?.n ?? 0),
      recent: recent.map((r) => ({
        device: r.device,
        room: r.room,
        title: r.title ?? '',
        artist: typeof r.detail?.artist === 'string' ? r.detail.artist : null,
        album: typeof r.detail?.album === 'string' ? r.detail.album : null,
        at: new Date(r.at).toISOString(),
      })),
      topArtists: counts(artists, ''),
      byDevice: counts(mediaDevices, ''),
    },
  };
}

const HOUSE_CAVEATS = [
  'Room sensors, motion and alarms are what Home Assistant POLLS from Amazon every five minutes: a motion blip or a two-minute timer between polls is never seen.',
  'Only some Echos have sensors (an Echo 4th gen / Show has temperature and light; a Dot may have motion). A device missing from `now` has none.',
  'Alarms/timers/reminders: a row is a NEW due time on a device. `scheduled.setAt` is when it came into view (within five minutes of being set); a repeating alarm reappears each time it rolls forward. Cancelling is not recorded (Home Assistant cannot tell it from the Echo dropping offline), so `pending` can include one cancelled early.',
  "Listening comes from Amazon's push feed, the same one voice events use; an empty list can mean the feed is down rather than nothing played.",
  'Hours are Europe/London.',
];

/**
 * `alexa_home_signals`' answer. Lives here rather than beside the tool so the
 * workflows tree carries only the registration.
 */
export async function houseToolAnswer(days: number) {
  const s = await houseSummary({ days });
  return {
    ...s,
    // A month of hourly points per device would swamp the context; the range
    // plus the last day is what a question about warmth needs.
    temperature: s.temperature.map((t) => ({ ...t, points: t.points.slice(-24) })),
    coverage:
      s.allTime === 0
        ? 'Nothing recorded yet. Home Assistant keeps thirty days, so the first sync back-fills what it still holds.'
        : `Log runs ${s.firstAt} → ${s.lastAt} (${s.allTime} changes in total).`,
    caveats: HOUSE_CAVEATS,
  };
}
