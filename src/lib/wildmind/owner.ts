// owner.ts — the shapes of Wildmind's OWNER lane, as the owner's iPhone sees them.
//
// PROSE HERE IS OWNER-ONLY. Unlike the public snapshot ($lib/landing/wildmind),
// these shapes carry what the model writes: speech, thoughts, diaries, whispers,
// moods, goals, invention descriptions and the referee's notes. They may reach
// exactly one place, the owner's paired phone through `withDevice` routes under
// /api/native/wildmind/*. Nothing in $lib/landing may import this module (a test
// holds that), so none of it can reach the public landing page, its memo or the
// existing /api/native/wildmind map route, whose "no prose" promise stays true.
//
// Privacy note for the owner: a whisper's text and JKai's answer also go to the
// model provider (Anthropic) as part of the prompt, sit in Wildmind's own
// rotated llm-calls log, and land in its talk store, which is backed up offsite
// with the rest of Wildmind's data. That is fine for the owner's own words; it
// is why nothing here is ever shown to anyone else.
//
// Every response is re-validated here, never trusted: zod objects drop keys
// they do not name (so `visual`, `currentSystem`, `guardrails`, `origin` and
// anything Wildmind adds later never cross), every string is stripped of
// control characters and capped, and every list is capped and checked item by
// item, so one malformed entry is dropped rather than failing the page. Field
// names are Wildmind's own (the W5 contract), because the app decodes them.

import { z } from 'zod';

/** The longest prose kept: a speech, thought, diary or description. */
export const TEXT_MAX = 1200;
/** The longest whisper John may send (Wildmind's own limit). */
export const WHISPER_MAX = 240;

export const TALK_KINDS = ['speech', 'thought', 'whisper', 'diary'] as const;
export type TalkKind = (typeof TALK_KINDS)[number];
export const PEOPLE = ['main', 'companion'] as const;
export type Person = (typeof PEOPLE)[number];

// C0 controls and DEL, keeping tab and newline (diaries have paragraphs).
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Strip control characters and cap at `max` UTF-16 units without splitting a pair. */
export function clip(s: string, max: number): string {
  const t = s.replace(CONTROL, '');
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

const text = (max: number) => z.string().transform((s) => clip(s, max));
/** A string that may be absent, null or malformed: all three read as null. */
const optText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s == null ? null : clip(s, max)))
    .catch(null);
/** A clock label ("Day 24, 17:00"); a bare number is kept as its digits. */
const optLabel = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((s) => (s == null ? null : clip(String(s), 40)))
  .catch(null);
const num = z.number().finite();
const optNum = num.nullish().transform((n) => n ?? null).catch(null);
const logId = z.number().int().nonnegative();
const optLogId = logId.nullish().transform((n) => n ?? null).catch(null);
const optInt = z.number().int().nullish().transform((n) => n ?? null).catch(null);
const flag = z.boolean().catch(false);

/**
 * A list kept item by item: at most `max` items are looked at, and an item
 * that does not parse is dropped instead of failing the whole response. Not
 * an array at all reads as empty.
 */
function list<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((xs) =>
      xs.slice(0, max).flatMap((x) => {
        const r = item.safeParse(x);
        return r.success ? [r.data as z.output<T>] : [];
      }),
    );
}

const Valley = z.object({
  seed: z.number().int(),
  generation: optInt,
  day: optInt,
  clock: optLabel,
});

// ---------------------------------------------------------------- talk

const TalkEntry = z.object({
  id: logId,
  minute: num,
  when: optLabel,
  who: optText(40),
  name: optText(60),
  kind: z.enum(TALK_KINDS),
  to: optText(40),
  toName: optText(60),
  text: text(TEXT_MAX),
  detail: optText(600),
});

export const TalkSchema = z.object({
  v: z.literal(1),
  valley: Valley,
  entries: list(TalkEntry, 200),
  oldestId: optLogId,
  latestId: optLogId,
  more: flag,
});
export type OwnerTalk = z.output<typeof TalkSchema>;

// ---------------------------------------------------------------- chronicle

const Now = z.object({
  lastThought: optText(TEXT_MAX),
  mood: optText(200),
  goal: optText(600),
  ambitions: list(z.object({ text: text(400), status: optText(40) }), 12),
  values: list(
    z.object({
      text: text(400),
      strength: optNum,
      since: optLabel,
      kept: optInt,
      broken: optInt,
      rules: list(z.object({ effect: text(40), verb: text(60), target: text(120) }), 8),
    }),
    12,
  ),
  attitudes: list(z.object({ subject: text(120), feeling: optNum, reason: optText(400), since: optLabel }), 20),
  people: list(
    z.object({ name: text(60), set: flag, trust: optNum, affection: optNum, note: optText(400), partner: flag }),
    12,
  ),
});

export const ChronicleSchema = z.object({
  v: z.literal(1),
  valley: Valley,
  who: z.object({
    id: text(40),
    name: text(60),
    alive: flag,
    causeOfDeath: optText(200),
    persona: optText(TEXT_MAX),
  }),
  now: Now.nullable().catch(null),
  timeline: list(
    z.object({ minute: num, day: z.number().int(), when: optLabel, kind: text(40), icon: optText(8), text: text(600) }),
    700,
  ),
  diary: list(z.object({ day: z.number().int(), text: text(TEXT_MAX) }), 60),
});
export type OwnerChronicle = z.output<typeof ChronicleSchema>;

// ---------------------------------------------------------------- inventions

export const InventionsSchema = z.object({
  v: z.literal(1),
  valley: Valley,
  inventions: list(
    z.object({
      id: text(120),
      name: text(120),
      kind: optText(40),
      description: optText(TEXT_MAX),
      inventor: optText(60),
      day: optInt,
      placed: flag,
      summary: optText(600),
      notes: list(text(300), 12), // Wildmind keeps 12 referee notes
      rationale: optText(TEXT_MAX),
    }),
    200,
  ),
  refused: list(z.object({ when: optLabel, text: text(600) }), 30),
});
export type OwnerInventions = z.output<typeof InventionsSchema>;

// ---------------------------------------------------------------- whispers

const Answer = z.object({
  logId,
  when: optLabel,
  thought: optText(TEXT_MAX),
  goal: optText(600),
  mood: optText(200),
});

export const WhispersSchema = z.object({
  v: z.literal(1),
  pending: list(text(TEXT_MAX), 5),
  reserveLeftUsd: optNum,
  modelAvailable: flag,
  whispers: list(
    z.object({
      logId,
      when: optLabel,
      text: text(TEXT_MAX),
      status: z.enum(['pending', 'heard', 'dropped']),
      answer: Answer.nullable().catch(null),
    }),
    50,
  ),
});
export type OwnerWhispers = z.output<typeof WhispersSchema>;

/** Wildmind's 202 for an accepted whisper. */
export const WhisperAcceptedSchema = z.object({
  v: z.literal(1),
  ok: z.literal(true),
  logId,
  when: optLabel,
  pending: list(text(TEXT_MAX), 5),
  dropped: optText(TEXT_MAX),
  asleep: flag,
  modelAvailable: flag,
});
export type OwnerWhisperAccepted = z.output<typeof WhisperAcceptedSchema>;

// ---------------------------------------------------------------- queries

const LOG_ID = /^\d{1,12}$/;

function clampInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

/**
 * What the phone may ask of /talk, rebuilt from scratch: only the named
 * parameters, each one checked, and anything malformed left out rather than
 * forwarded. Nothing else the phone sends goes upstream.
 */
export function talkQuery(q: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  // Wildmind refuses the whole page (400) for a malformed one, so only clean
  // ones go: `before` is at least 1 (nothing is older than id 0), `since` at least 0.
  const before = q.get('before')?.trim();
  if (before && LOG_ID.test(before) && Number(before) >= 1) out.set('before', before);
  const since = q.get('since')?.trim();
  if (since && LOG_ID.test(since)) out.set('since', since);
  out.set('limit', String(clampInt(q.get('limit'), 100, 200)));
  const who = q.get('who');
  if (who && (PEOPLE as readonly string[]).includes(who)) out.set('who', who);
  const kinds = [...new Set((q.get('kinds') ?? '').split(',').map((k) => k.trim()))].filter((k) =>
    (TALK_KINDS as readonly string[]).includes(k),
  );
  if (kinds.length) out.set('kinds', kinds.join(','));
  return out;
}

/** The person a chronicle is for; null when the phone named someone else. */
export function chronicleId(q: URLSearchParams): Person | null {
  const id = q.get('id');
  if (id === null || id === '') return 'main';
  return (PEOPLE as readonly string[]).includes(id) ? (id as Person) : null;
}

export function whispersQuery(q: URLSearchParams): URLSearchParams {
  return new URLSearchParams({ limit: String(clampInt(q.get('limit'), 20, 50)) });
}

// ---------------------------------------------------------------- whisper body

export type WhisperBodyError = 'bad-request' | 'empty' | 'too-long';

/**
 * `{ text }` from the phone, trimmed and stripped of control characters (line
 * breaks become spaces). `to` is never read: a whisper from the app is always
 * for JKai.
 */
export function parseWhisperBody(body: unknown): { ok: true; text: string } | { error: WhisperBodyError } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad-request' };
  const raw = (body as { text?: unknown }).text;
  if (typeof raw !== 'string') return { error: 'bad-request' };
  const t = raw.replace(/\s*[\r\n\t]+\s*/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!t) return { error: 'empty' };
  // Counted in characters (code points), as Wildmind counts them.
  if (Array.from(t).length > WHISPER_MAX) return { error: 'too-long' };
  return { ok: true, text: t };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The phone's Idempotency-Key, lowercased, when it is a UUID; otherwise null. */
export function idempotencyKey(raw: string | null): string | null {
  const v = raw?.trim() ?? '';
  return UUID.test(v) ? v.toLowerCase() : null;
}
