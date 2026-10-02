// src/lib/daydream/act/plan.ts
//
// "Do it for me": a note's suggested step, carried out with one tap and no
// further questions. PURE — the plans, the checks they must pass, and their
// words. The model call that drafts a plan is `plan.server.ts`; the writes are
// `act.server.ts`.
//
// Owner, 2026-10-02: a note suggested "Put 10 October in the diary to chase
// the bike dispatch" — a good call — and the only answers available were
// "more of this" or "not for me". He wanted it to go ahead and set it up.
//
// ── What it may do ─────────────────────────────────────────────────────────
//
// A CLOSED set of kinds. The tier is decided by who it reaches and whether it
// can be taken back:
//
//   calendar_event  one tap   an entry in his own diary. Undo deletes it.
//   reminder        one tap   a message to HIM at a time. Undo cancels it
//                             until it fires.
//   calendar_move   one tap   moves an entry of his that has no other
//                             attendees. Undo puts it back where it was.
//   email_draft     guided    a reply drafted on the thread the note came
//                             from. It reaches another person, so it stops at
//                             a DRAFT: he reads it on the card and sends it
//                             with a second tap. Undo discards the draft;
//                             once sent, there is no undo and the card says so.
//
// Payments, cancellations, disputes, bookings, other people's accounts and
// deletions are not on the list and will not be: they cannot be taken back.
//
// ── Why the checks are code ────────────────────────────────────────────────
//
// A model drafts the plan from the note's words. The tap is his consent to
// THE NOTE, so a plan must not say anything the note did not: every date it
// writes appears in the note, an entry it moves is named in the note, a draft
// replies only to a sender the note's evidence names — and the recipient is
// looked up by code, never written by the model. A plan that fails a check is
// refused with the reason; it never acts on a guess.

export const ACT_KINDS = ['calendar_event', 'reminder', 'calendar_move', 'email_draft'] as const;
export type ActKind = (typeof ACT_KINDS)[number];

export interface CalendarPlan {
  kind: 'calendar_event';
  /** What goes in the diary. */
  title: string;
  /** Local day, YYYY-MM-DD. */
  date: string;
  /** Local time HH:MM for a 30-minute slot; null is an all-day entry. */
  time: string | null;
}

export interface ReminderPlan {
  kind: 'reminder';
  /** What he is reminded of. */
  text: string;
  date: string;
  /** Local HH:MM; null means the morning (`REMINDER_DEFAULT_TIME`). */
  time: string | null;
}

export interface MovePlan {
  kind: 'calendar_move';
  /** The diary entry's title, as the note names it. */
  event: string;
  /** The day it is on now, and the day it moves to. */
  from: string;
  to: string;
  /** A new local start time, or null to keep its time of day. */
  time: string | null;
}

export interface DraftPlan {
  kind: 'email_draft';
  /** The sender's domain, as the note's evidence names it. The address is
   *  looked up from his mailbox at draft time — never written by a model. */
  domain: string;
  subject: string;
  body: string;
}

export type ActPlan = CalendarPlan | ReminderPlan | MovePlan | DraftPlan;

/** What happened when it was carried out, stored beside the plan. */
export interface ActDone {
  at: string;
  /** calendar_event: the calendar written to; calendar_move: the entry's. */
  calendar: string;
  /** calendar_event: iCalendar UID — what Undo finds the entry by. */
  uid: string;
  /** calendar_event / calendar_move: the CalDAV resource. */
  eventId: string | null;
  undoneAt: string | null;
  /** reminder: the scheduled callback's name, and when it fires. */
  callback?: string;
  fireAt?: string;
  /** calendar_move: where the entry was, for Undo. */
  before?: { allDay: boolean; start: string; end: string; title: string };
  after?: { allDay: boolean; start: string; end: string };
  /** email_draft: the draft, as written, and whether it went. */
  draft?: { id: string; messageId: string; threadId: string; to: string; subject: string; body: string; accountEmail: string };
  sentAt?: string | null;
}

/** The `proposed_actions` entry a think note carries. `payload` is the plan
 *  as JSON (the column's existing shape); `done` is added once carried out. */
export interface StoredAction {
  kind: string;
  label: string;
  payload: string;
  done?: ActDone;
}

export const MAX_TITLE = 120;
export const MAX_SUBJECT = 150;
export const MAX_BODY = 2000;
export const HORIZON_DAYS = 366;
export const SLOT_MINUTES = 30;
export const REMINDER_DEFAULT_TIME = '09:00';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function isRealDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

function isTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max + 1) : '';
}

/**
 * Does the note's own text name this day? Accepts "10 October", "October 10",
 * "10th Oct", "2026-10-10", and "tomorrow" for the day after `today`.
 */
export function noteNamesDate(text: string, date: string, today: string): boolean {
  const t = text.toLowerCase();
  if (t.includes(date)) return true;
  if (dayNumber(date) - dayNumber(today) === 1 && /\btomorrow\b/.test(t)) return true;
  if (date === today && /\btoday\b/.test(t)) return true;
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  const day = Number(date.slice(8, 10));
  const mon = `(?:${month}|${month.slice(0, 3)})\\.?`;
  const dd = `0?${day}(?:st|nd|rd|th)?`;
  return new RegExp(`\\b${dd}\\s+(?:of\\s+)?${mon}\\b|\\b${mon}\\s+${dd}\\b`).test(t);
}

/** Every word of `name` that identifies it appears in the note. */
export function noteNames(text: string, name: string): boolean {
  const t = text.toLowerCase();
  if (t.includes(name.toLowerCase())) return true;
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return words.length > 0 && words.every((w) => t.includes(w));
}

function checkDate(date: string, ctx: { noteText: string; today: string }, what = 'it'): string | null {
  if (!isRealDate(date)) return `The step does not give a date ${what} can use.`;
  const ahead = dayNumber(date) - dayNumber(ctx.today);
  if (ahead < 0) return `That date (${date}) has already passed.`;
  if (ahead > HORIZON_DAYS) return 'That date is more than a year away.';
  if (!noteNamesDate(ctx.noteText, date, ctx.today)) return `The note does not name ${date} itself, so it will not guess a date.`;
  return null;
}

/** A plan as drafted, checked against the note it came from. `evidenceText`
 *  is what the note's sources said — where a sender's domain is named. */
export function checkPlan(
  raw: unknown,
  ctx: { noteText: string; today: string; evidenceText?: string },
): { ok: true; plan: ActPlan } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'There is no step here it can carry out by itself.' };
  const r = raw as Record<string, unknown>;
  const time = isTime(r.time) ? (r.time as string).trim() : null;

  switch (r.kind) {
    case 'calendar_event': {
      const title = clean(r.title, MAX_TITLE);
      if (title.length < 3 || title.length > MAX_TITLE) return { ok: false, reason: 'The diary entry had no usable title.' };
      const date = typeof r.date === 'string' ? r.date.trim() : '';
      const bad = checkDate(date, ctx);
      if (bad) return { ok: false, reason: bad };
      return { ok: true, plan: { kind: 'calendar_event', title, date, time } };
    }
    case 'reminder': {
      const text = clean(r.text, 200);
      if (text.length < 3 || text.length > 200) return { ok: false, reason: 'The reminder had nothing to say.' };
      const date = typeof r.date === 'string' ? r.date.trim() : '';
      const bad = checkDate(date, ctx);
      if (bad) return { ok: false, reason: bad };
      return { ok: true, plan: { kind: 'reminder', text, date, time } };
    }
    case 'calendar_move': {
      const event = clean(r.event, MAX_TITLE);
      if (event.length < 3 || event.length > MAX_TITLE) return { ok: false, reason: 'It could not tell which diary entry to move.' };
      if (!noteNames(ctx.noteText, event)) return { ok: false, reason: `The note does not name “${event}”, so it will not move it.` };
      const from = typeof r.from === 'string' ? r.from.trim() : '';
      const to = typeof r.to === 'string' ? r.to.trim() : '';
      if (!isRealDate(from)) return { ok: false, reason: 'It could not tell which day the entry is on now.' };
      if (!noteNamesDate(ctx.noteText, from, ctx.today)) return { ok: false, reason: `The note does not name ${from}, so it will not guess which entry.` };
      const bad = checkDate(to, ctx, 'the move');
      if (bad) return { ok: false, reason: bad };
      if (from === to && !time) return { ok: false, reason: 'That would leave the entry where it is.' };
      return { ok: true, plan: { kind: 'calendar_move', event, from, to, time } };
    }
    case 'email_draft': {
      const domain = typeof r.domain === 'string' ? r.domain.trim().toLowerCase().replace(/^@/, '') : '';
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { ok: false, reason: 'It could not tell who the email is to.' };
      const where = `${ctx.noteText}\n${ctx.evidenceText ?? ''}`.toLowerCase();
      if (!where.includes(domain)) return { ok: false, reason: `Nothing in the note shows mail from ${domain}, so it will not write to them.` };
      // A header line, so never a line break: one is a header injection.
      const subject = clean(r.subject, MAX_SUBJECT);
      if (subject.length < 3 || subject.length > MAX_SUBJECT) return { ok: false, reason: 'The draft had no usable subject.' };
      const body = typeof r.body === 'string' ? r.body.replace(/\r\n?/g, '\n').trim() : '';
      if (body.length < 20 || body.length > MAX_BODY) return { ok: false, reason: 'The draft had no usable message.' };
      return { ok: true, plan: { kind: 'email_draft', domain, subject, body } };
    }
    default:
      return { ok: false, reason: 'This step is not one it can carry out by itself — it adds diary entries, reminders, diary moves and email drafts.' };
  }
}

/** "Sat 10 Oct", "Sat 10 Oct, 09:00". */
export function whenWords(plan: { date: string; time: string | null }): string {
  const d = new Date(`${plan.date}T12:00:00Z`);
  const m = MONTHS[d.getUTCMonth()];
  const day = `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${m.slice(0, 1).toUpperCase()}${m.slice(1, 3)}`;
  return plan.time ? `${day}, ${plan.time}` : day;
}

/** The label the card shows before the tap: exactly what will happen. */
export function planLabel(plan: ActPlan, calendar: string | null): string {
  switch (plan.kind) {
    case 'calendar_event':
      return `Add “${plan.title}” to ${calendar ? `your ${calendar} calendar` : 'your diary'} on ${whenWords(plan)}`;
    case 'reminder':
      return `Remind you on ${whenWords({ date: plan.date, time: plan.time ?? REMINDER_DEFAULT_TIME })}: “${plan.text}”`;
    case 'calendar_move':
      return `Move “${plan.event}” from ${whenWords({ date: plan.from, time: null })} to ${whenWords({ date: plan.to, time: plan.time })}`;
    case 'email_draft':
      return `Draft a reply to ${plan.domain} — you read it here and send it`;
  }
}

/** What it says once done. */
export function doneLabel(stored: StoredAction, plan: ActPlan): string {
  const d = stored.done;
  switch (plan.kind) {
    case 'calendar_event':
      return stored.label.replace(/^Add /, 'Added ');
    case 'reminder':
      return `It will remind you on ${whenWords({ date: plan.date, time: plan.time ?? REMINDER_DEFAULT_TIME })}: “${plan.text}”`;
    case 'calendar_move':
      return `Moved “${d?.before?.title ?? plan.event}” to ${whenWords({ date: plan.to, time: plan.time })}`;
    case 'email_draft':
      return d?.sentAt ? `Sent to ${d.draft?.to ?? plan.domain}` : `Drafted a reply to ${d?.draft?.to ?? plan.domain} — read it, then send`;
  }
}

/** The tool arguments for `apple_calendar_create`. A timed slot is given as a
 *  London wall-clock time converted to UTC, which is what the tool expects. */
export function toCreateArgs(plan: CalendarPlan, calendar: string, notes: string): Record<string, unknown> {
  const base = { calendar, title: plan.title, notes };
  if (!plan.time) return { ...base, allDayStart: plan.date, allDayEnd: plan.date };
  const start = londonToUtc(plan.date, plan.time);
  const end = new Date(Date.parse(start) + SLOT_MINUTES * 60_000).toISOString();
  return { ...base, start, end };
}

/** London wall-clock → UTC ISO, across the clock change. */
export function londonToUtc(date: string, time: string): string {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const [h, m] = londonClock(new Date(guess)).split(':').map(Number);
  const [wantH, wantM] = time.split(':').map(Number);
  const offsetMin = (h * 60 + m) - (wantH * 60 + wantM);
  // Wrap a day boundary (e.g. 23:30 UTC shows as 00:30 London).
  const wrapped = ((offsetMin + 720) % 1440 + 1440) % 1440 - 720;
  return new Date(guess - wrapped * 60_000).toISOString();
}

/** UTC instant → London "HH:MM". */
export function londonClock(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** UTC instant → London "YYYY-MM-DD". */
export function londonDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Where an entry lands when moved: the same length, the same time of day
 * unless a new one is given, on the new day — computed in London time, so a
 * move across the clock change keeps 09:00 as 09:00. All-day entries keep
 * their span of days.
 */
export function movedTimes(
  event: { start: string; end: string; allDay: boolean },
  plan: Pick<MovePlan, 'to' | 'time'>,
): { allDay: boolean; start: string; end: string } {
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (event.allDay) {
    const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    // Inclusive day range, as `allDayStart`/`allDayEnd` take it.
    return { allDay: true, start: plan.to, end: shiftDay(plan.to, spanDays - 1) };
  }
  const length = Math.max(5 * 60_000, end.getTime() - start.getTime());
  const newStart = londonToUtc(plan.to, plan.time ?? londonClock(start));
  return { allDay: false, start: newStart, end: new Date(Date.parse(newStart) + length).toISOString() };
}

/** An entry is all-day when it starts at London midnight and spans whole days. */
export function isAllDay(event: { start: string; end: string }): boolean {
  const s = new Date(event.start);
  const e = new Date(event.end);
  const span = e.getTime() - s.getTime();
  return londonClock(s) === '00:00' && span > 0 && Math.abs(span / 86_400_000 - Math.round(span / 86_400_000)) < 0.05;
}

/** `apple_calendar_update` arguments for a set of times. */
export function toUpdateTimes(t: { allDay: boolean; start: string; end: string }): Record<string, unknown> {
  return t.allDay ? { allDayStart: t.start, allDayEnd: t.end } : { start: t.start, end: t.end };
}

/** The before-image of an entry, in the same shape `toUpdateTimes` takes. */
export function beforeTimes(event: { start: string; end: string }): { allDay: boolean; start: string; end: string } {
  if (!isAllDay(event)) return { allDay: false, start: event.start, end: event.end };
  const first = londonDay(new Date(event.start));
  const days = Math.max(1, Math.round((Date.parse(event.end) - Date.parse(event.start)) / 86_400_000));
  return { allDay: true, start: first, end: shiftDay(first, days - 1) };
}

/** The stored action back out, or null when it is not one this build knows. */
export function readStored(actions: unknown): { stored: StoredAction; plan: ActPlan } | null {
  if (!Array.isArray(actions)) return null;
  for (const a of actions as StoredAction[]) {
    if (!a || !(ACT_KINDS as readonly string[]).includes(a.kind) || typeof a.payload !== 'string') continue;
    try {
      const p = JSON.parse(a.payload) as ActPlan;
      if (p?.kind === a.kind) return { stored: a, plan: p };
    } catch {
      /* not a plan this build can read */
    }
  }
  return null;
}

export function storeAction(plan: ActPlan, calendar: string | null, done?: ActDone): StoredAction {
  return { kind: plan.kind, label: planLabel(plan, calendar), payload: JSON.stringify(plan), ...(done ? { done } : {}) };
}

// ── What the reader sees ───────────────────────────────────────────────────

export interface NoteAct {
  kind: ActKind | null;
  /** `ready`: a plan is waiting for the tap. `open`: a step exists but no plan
   *  yet — the tap drafts one and carries it out. `done` / `undone` after;
   *  `sent` is a draft that went (no undo). */
  status: 'ready' | 'open' | 'done' | 'undone' | 'sent';
  /** What will happen, or what did. */
  label: string;
  doneAt: string | null;
  /** Guided kinds stop here for a second tap — the draft to read first. */
  draft: { to: string; subject: string; body: string; gmailUrl: string } | null;
  /** Whether Undo is possible now. */
  undoable: boolean;
}

const MONTH_WORDS = `(?:${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|')})`;

/**
 * Could this step be one it does? Offered only then, so the button is never
 * a tap that ends in "it cannot do that".
 */
export function looksDoable(step: string | null): boolean {
  if (!step) return false;
  const t = step.toLowerCase();
  return (
    /\b(diary|calendar|remind|reminder|reschedule|move)\b/.test(t) ||
    /\b(email|e-mail|reply|write to|chase|contact)\b/.test(t) ||
    /\btomorrow\b/.test(t) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORDS}\\b|\\b${MONTH_WORDS}\\s+\\d{1,2}\\b`).test(t)
  );
}

/** Kept for callers that predate the other kinds. */
export const looksSchedulable = looksDoable;

export function gmailDraftUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(messageId)}`;
}

export function noteAct(actions: unknown, step: string | null): NoteAct | null {
  const found = readStored(actions);
  if (found) {
    const { stored, plan } = found;
    const d = stored.done;
    const draft = d?.draft
      ? { to: d.draft.to, subject: d.draft.subject, body: d.draft.body, gmailUrl: gmailDraftUrl(d.draft.messageId) }
      : null;
    if (d?.undoneAt) return { kind: plan.kind, status: 'undone', label: stored.label, doneAt: d.at, draft: null, undoable: false };
    if (d?.sentAt) return { kind: plan.kind, status: 'sent', label: doneLabel(stored, plan), doneAt: d.sentAt, draft, undoable: false };
    if (d) {
      const fired = plan.kind === 'reminder' && !!d.fireAt && Date.parse(d.fireAt) <= Date.now();
      return { kind: plan.kind, status: 'done', label: doneLabel(stored, plan), doneAt: d.at, draft, undoable: !fired };
    }
    return { kind: plan.kind, status: 'ready', label: stored.label, doneAt: null, draft: null, undoable: false };
  }
  return looksDoable(step)
    ? { kind: null, status: 'open', label: 'jkai sets this up itself, now — no more questions.', doneAt: null, draft: null, undoable: false }
    : null;
}
