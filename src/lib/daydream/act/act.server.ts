// src/lib/daydream/act/act.server.ts
//
// Carrying out a note's step, and taking it back. The tap is the consent: no
// confirmation gate, no sign-off sheet — which is why only reversible kinds
// that stay with him are one tap (`plan.ts`), why the one kind that reaches
// another person stops at a draft, and why every plan is checked against the
// note's own words before anything is written.
//
// Called directly through the tool registry, the same way the diary is READ
// (`$lib/calendar/read.ts`), not through chat's confirmation gate: the gate
// exists to stop a model writing on its own initiative, and here the owner
// pressed the button.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { daydreamThoughts, gmailAccounts } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { localDay } from '../features/build';
import { splitNarrative } from '../think/explain';
import { noteHref } from '../think/notes';
import {
  REMINDER_DEFAULT_TIME,
  beforeTimes,
  checkPlan,
  doneLabel,
  isAllDay,
  londonToUtc,
  movedTimes,
  noteNames,
  readStored,
  shiftDay,
  storeAction,
  toCreateArgs,
  toUpdateTimes,
  type ActDone,
  type ActPlan,
  type BatchPlan,
  type CalendarPlan,
  type HoldPlan,
  type DraftPlan,
  type MovePlan,
  type ReminderPlan,
  type StoredAction,
} from './plan';

/** Which of his calendars a new diary entry goes in. Chosen once. */
export const ACT_CALENDAR_KEY = 'daydream.act.calendar';
const SITE = 'https://strangeramblings.com';

export type ActResult =
  | { ok: true; status: 'done' | 'undone' | 'sent'; label: string; calendar?: string; already?: boolean }
  | { ok: false; reason: string; needsCalendar?: false }
  | { ok: false; reason: string; needsCalendar: true; calendars: string[] };

type Done = { done: ActDone; calendar?: string };
type Outcome = Done | { ok: false; reason: string; needsCalendar?: boolean; calendars?: string[] };

async function tool(name: string, args: Record<string, unknown>) {
  // Dynamic for the reason `calendar/read.ts` gives: the registry boots
  // platform services on import.
  const { executeTool } = await import('$lib/tools/registry');
  return executeTool(name, args);
}

const why = (res: { error?: unknown } | null | undefined) => String(res?.error ?? 'no reason given').slice(0, 200);

/** His calendars by name, for the one-time choice. */
export async function listCalendars(): Promise<string[]> {
  const res = await tool('apple_calendar_list', { listCalendars: true });
  const calendars = (res?.data as { calendars?: Array<{ label?: string }> } | undefined)?.calendars ?? [];
  return calendars.map((c) => String(c.label ?? '')).filter(Boolean);
}

export async function actCalendar(): Promise<string | null> {
  const v = await getSetting<string | null>(ACT_CALENDAR_KEY);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function chooseCalendar(name: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const names = await listCalendars();
  if (!names.includes(name)) return { ok: false, reason: `There is no calendar called “${name}”.` };
  await setSetting(ACT_CALENDAR_KEY, name);
  return { ok: true };
}

function noteText(row: { title: string; narrative: string | null; explanation: string }): { body: string; next: string | null; all: string } {
  const body = row.narrative ?? row.explanation;
  const split = splitNarrative(body);
  return { body: split.summary, next: split.next, all: `${row.title}\n${body}` };
}

/** What the note's sources said, as stored with it — where a sender's
 *  domain is named for a draft. */
function evidenceText(evidence: unknown): string {
  if (!Array.isArray(evidence)) return '';
  return (evidence as Array<{ note?: unknown }>).map((e) => (typeof e?.note === 'string' ? e.note : '')).join('\n');
}

function replaceAction(actions: unknown, entry: StoredAction): StoredAction[] {
  const rest = (Array.isArray(actions) ? (actions as StoredAction[]) : []).filter((a) => a?.kind !== entry.kind);
  return [...rest, entry];
}

const baseDone = (now: Date): ActDone => ({ at: now.toISOString(), calendar: '', uid: '', eventId: null, undoneAt: null });

// ── One function per kind ──────────────────────────────────────────────────

async function addEntry(plan: CalendarPlan, thoughtId: string, now: Date): Promise<Outcome> {
  const calendar = await actCalendar();
  if (!calendar) {
    return { ok: false, needsCalendar: true, reason: 'Choose which calendar it should use. It asks once.', calendars: await listCalendars().catch(() => []) };
  }
  const created = await tool('apple_calendar_create', toCreateArgs(plan, calendar, `Added by jkai from a daydream note: ${SITE}${noteHref(thoughtId)}`));
  if (!created?.success) return { ok: false, reason: `Your calendar did not take it: ${why(created)}` };
  const data = (created.data ?? {}) as { id?: unknown; url?: unknown; calendar?: unknown };
  const url = typeof data.url === 'string' ? data.url : '';
  const used = typeof data.calendar === 'string' && data.calendar ? data.calendar : calendar;
  return {
    calendar: used,
    done: { ...baseDone(now), calendar: used, uid: typeof data.id === 'string' ? data.id : '', eventId: url.startsWith('http') || url.startsWith('/') ? url : null },
  };
}

export const reminderName = (thoughtId: string) => `daydream-remind-${thoughtId}`;

async function scheduleReminder(plan: ReminderPlan, thoughtId: string, now: Date): Promise<Outcome> {
  const fireAt = londonToUtc(plan.date, plan.time ?? REMINDER_DEFAULT_TIME);
  if (Date.parse(fireAt) <= now.getTime() + 60_000) return { ok: false, reason: 'That time has already gone.' };
  const scheduled = await tool('schedule_tool_call_at', {
    name: reminderName(thoughtId),
    tool_name: 'notify_owner',
    args: {
      category: 'reminder',
      title: 'Reminder',
      body: plan.text,
      url: noteHref(thoughtId),
      severity: 'info',
      dedupeKey: `daydream-remind:${thoughtId}`,
    },
    fire_at_iso: fireAt,
    // The same note re-done after an Undo moves its own reminder.
    replace_existing: true,
  });
  if (!scheduled?.success) return { ok: false, reason: `The reminder could not be set: ${why(scheduled)}` };
  return { done: { ...baseDone(now), callback: reminderName(thoughtId), fireAt } };
}

/** An event held in the diary, and the "book it" reminder before it. If the
 *  reminder cannot be set the entry is taken back out — a hold that silently
 *  lost half of what the label promised is worse than a refusal. */
async function holdEvent(plan: HoldPlan, thoughtId: string, now: Date): Promise<Outcome> {
  const entry = await addEntry({ kind: 'calendar_event', title: plan.title, date: plan.date, time: plan.time }, thoughtId, now);
  if ('ok' in entry) return entry;
  if (!plan.remind) return entry;
  const reminder = await scheduleReminder(
    { kind: 'reminder', text: `Book: ${plan.title} (${plan.date}${plan.time ? ` ${plan.time}` : ''})`, date: plan.remind, time: null },
    thoughtId,
    now,
  );
  if ('ok' in reminder) {
    if (entry.done.eventId) await tool('apple_calendar_delete', { calendar: entry.done.calendar, eventId: entry.done.eventId }).catch(() => null);
    return { ok: false, reason: `The diary entry was taken back out because the reminder could not be set: ${reminder.reason}` };
  }
  return { calendar: entry.calendar, done: { ...entry.done, callback: reminder.done.callback, fireAt: reminder.done.fireAt } };
}

/** A plan's sessions, all or none: a failure part-way removes what was written. */
async function writeBatch(plan: BatchPlan, thoughtId: string, now: Date): Promise<Outcome> {
  const written: NonNullable<ActDone['batch']> = [];
  let calendar = '';
  for (const e of plan.entries) {
    const one = await addEntry({ kind: 'calendar_event', title: e.title, date: e.date, time: e.time }, thoughtId, now);
    if ('ok' in one) {
      for (const w of written) {
        if (w.eventId) await tool('apple_calendar_delete', { calendar, eventId: w.eventId }).catch(() => null);
      }
      return written.length ? { ok: false, reason: `Stopped at “${e.title}” and took the others back out: ${one.reason}` } : one;
    }
    calendar = one.calendar ?? calendar;
    written.push({ uid: one.done.uid, eventId: one.done.eventId, date: e.date, title: e.title });
  }
  return { calendar, done: { ...baseDone(now), calendar, batch: written } };
}

/** Find an entry this note wrote, by its UID, and delete it. Not found is gone
 *  already — removed by hand, most likely. */
async function removeEntry(calendar: string, entry: { uid: string; eventId: string | null; date: string; title: string }): Promise<string | null> {
  let eventId = entry.eventId;
  if (entry.uid) {
    const listed = await tool('apple_calendar_list', { calendar, dateRangeStart: entry.date, dateRangeEnd: shiftDay(entry.date, 2), query: entry.title });
    const events = ((listed?.data as { events?: Array<{ id?: unknown; uid?: unknown }> } | undefined)?.events ?? []);
    const match = events.find((e) => e.uid === entry.uid);
    eventId = match && typeof match.id === 'string' ? match.id : listed?.success ? null : eventId;
  }
  if (!eventId) return null;
  const deleted = await tool('apple_calendar_delete', { calendar, eventId });
  return deleted?.success ? null : `Your calendar did not let it remove “${entry.title}”: ${why(deleted)}`;
}

interface DiaryRow { id?: unknown; title?: unknown; start?: unknown; end?: unknown; calendar?: unknown; attendees?: unknown; organizer?: unknown }

async function moveEntry(plan: MovePlan, now: Date): Promise<Outcome> {
  const listed = await tool('apple_calendar_list', { dateRangeStart: plan.from, dateRangeEnd: shiftDay(plan.from, 1) });
  if (!listed?.success) return { ok: false, reason: `Your diary could not be read: ${why(listed)}` };
  const rows = ((listed.data as { events?: DiaryRow[] } | undefined)?.events ?? []).filter(
    (e) => typeof e.title === 'string' && typeof e.start === 'string' && typeof e.end === 'string' && typeof e.id === 'string',
  );
  // The entry whose title carries every word of the name — a name `checkPlan`
  // has already found in the note. Matching on "anything the note mentions"
  // would also catch the entry it clashes WITH. Exactly one, or no guess.
  const matches = rows.filter((e) => noteNames(String(e.title), plan.event));
  if (matches.length === 0) return { ok: false, reason: `There is no “${plan.event}” in your diary on ${plan.from}.` };
  if (matches.length > 1) return { ok: false, reason: `There are ${matches.length} entries that could be “${plan.event}” on ${plan.from}, so it will not guess which.` };
  const e = matches[0];
  // Other people's time is not his to move with one tap.
  if (Array.isArray(e.attendees) && e.attendees.length > 0) {
    return { ok: false, reason: `“${e.title}” has other people invited, so it will not move it without them.` };
  }
  const start = String(e.start);
  const end = String(e.end);
  const before = beforeTimes({ start, end });
  const after = movedTimes({ start, end, allDay: isAllDay({ start, end }) }, plan);
  const calendar = String(e.calendar ?? '');
  const updated = await tool('apple_calendar_update', { calendar, eventId: String(e.id), ...toUpdateTimes(after) });
  if (!updated?.success) return { ok: false, reason: `Your calendar did not take the move: ${why(updated)}` };
  return {
    calendar,
    done: { ...baseDone(now), calendar, eventId: String(e.id), before: { ...before, title: String(e.title) }, after },
  };
}

/** The owner's own sending mailbox: the most recently used active account. */
async function ownerMailbox() {
  const { ownerGmailWhere } = await import('$lib/integrations/gmail/owner-accounts');
  const [acct] = await db
    .select()
    .from(gmailAccounts)
    .where(ownerGmailWhere(eq(gmailAccounts.status, 'active')))
    .orderBy(desc(gmailAccounts.updatedAt))
    .limit(1);
  return acct ?? null;
}

/** "Shop <orders@bikeshop.co.uk>" → "orders@bikeshop.co.uk". */
export function addressOf(from: string): string {
  const angled = from.match(/<([^<>\s]+@[^<>\s]+)>/);
  const bare = from.match(/[^\s<>"']+@[^\s<>"']+/);
  return (angled?.[1] ?? bare?.[0] ?? '').toLowerCase();
}

async function draftReply(plan: DraftPlan, thoughtId: string, now: Date): Promise<Outcome> {
  const acct = await ownerMailbox();
  if (!acct) return { ok: false, reason: 'No Gmail account is connected to draft from.' };
  const { gmailService } = await import('$lib/integrations/gmail/service');
  // The recipient is FOUND, not written: the newest mail from the domain the
  // note's evidence names, replied to on its own thread.
  const ids = await gmailService.listMessages(acct, `from:${plan.domain} newer_than:180d`, 5);
  if (!ids.length) return { ok: false, reason: `There is no recent mail from ${plan.domain} to reply to.` };
  const msg = await gmailService.fetchMessage(acct, ids[0]);
  const to = addressOf(msg.headers.from);
  if (!to || !(to.endsWith(`@${plan.domain}`) || to.endsWith(`.${plan.domain}`))) {
    return { ok: false, reason: `The newest mail from ${plan.domain} has no address to reply to.` };
  }
  const original = msg.headers.subject || plan.subject;
  const subject = /^re:/i.test(original) ? original : `Re: ${original}`;
  const body = `${plan.body}\n`;
  const created = await gmailService.createDraft(acct, {
    to,
    subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 200),
    bodyText: body,
    threadId: msg.threadId,
    inReplyTo: msg.headers.messageId,
    references: [msg.headers.references, msg.headers.messageId].filter(Boolean).join(' ') || undefined,
  });
  if (!created.draftId) return { ok: false, reason: 'Gmail did not keep the draft.' };
  return {
    done: {
      ...baseDone(now),
      draft: { id: created.draftId, messageId: created.messageId, threadId: created.threadId, to, subject, body: plan.body, accountEmail: acct.email },
      sentAt: null,
    },
  };
}

// ── The three things he can tap ────────────────────────────────────────────

async function loadRow(tx: DbExecutor, thoughtId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daydream-act:${thoughtId}`}))`);
  const [row] = await tx
    .select({
      title: daydreamThoughts.title,
      narrative: daydreamThoughts.narrative,
      explanation: daydreamThoughts.explanation,
      evidence: daydreamThoughts.evidence,
      actions: daydreamThoughts.proposedActions,
    })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, thoughtId))
    .limit(1);
  return row ?? null;
}

/** "Do it for me". Idempotent: a second tap reports the first one's result. */
export async function doIt(thoughtId: string, now = new Date()): Promise<ActResult> {
  const result = await db.transaction(async (tx): Promise<ActResult> => {
    const row = await loadRow(tx, thoughtId);
    if (!row) return { ok: false, reason: 'That note no longer exists.' };

    const existing = readStored(row.actions);
    if (existing?.stored.done && !existing.stored.done.undoneAt) {
      return { ok: true, status: existing.stored.done.sentAt ? 'sent' : 'done', label: doneLabel(existing.stored, existing.plan), already: true };
    }

    const text = noteText(row);
    const evidence = evidenceText(row.evidence);
    const today = localDay(now);
    let draft: unknown = existing?.plan;
    if (!draft) {
      const { draftPlan } = await import('./plan.server');
      try {
        draft = await draftPlan({ title: row.title, body: text.body, next: text.next, evidence }, today);
      } catch {
        return { ok: false, reason: 'It could not work out what to do just now. Try again in a minute.' };
      }
      const said = (draft as { kind?: unknown; why?: unknown } | null)?.kind === 'none' ? (draft as { why?: unknown }).why : null;
      if (typeof said === 'string' && said.trim()) return { ok: false, reason: said.trim().slice(0, 200) };
    }
    // Re-checked even when stored: a date can pass between writing and tapping.
    const checked = checkPlan(draft, { noteText: text.all, today, evidenceText: evidence });
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const plan: ActPlan = checked.plan;

    let outcome: Outcome;
    switch (plan.kind) {
      case 'calendar_event': outcome = await addEntry(plan, thoughtId, now); break;
      case 'reminder': outcome = await scheduleReminder(plan, thoughtId, now); break;
      case 'calendar_move': outcome = await moveEntry(plan, now); break;
      case 'email_draft': outcome = await draftReply(plan, thoughtId, now); break;
      case 'event_hold': outcome = await holdEvent(plan, thoughtId, now); break;
      case 'calendar_batch': outcome = await writeBatch(plan, thoughtId, now); break;
    }
    if ('ok' in outcome) {
      return outcome.needsCalendar
        ? { ok: false, needsCalendar: true, reason: outcome.reason, calendars: outcome.calendars ?? [] }
        : { ok: false, reason: outcome.reason };
    }
    const entry = storeAction(plan, outcome.calendar ?? null, outcome.done);
    await tx
      .update(daydreamThoughts)
      .set({ proposedActions: replaceAction(row.actions, entry), updatedAt: now })
      .where(eq(daydreamThoughts.id, thoughtId));
    return { ok: true, status: 'done', label: doneLabel(entry, plan), calendar: outcome.calendar };
  });

  // Doing it is the strongest "worth knowing" there is. After the commit, and
  // only when this tap did the work.
  if (result.ok && !result.already) {
    const { recordFeedback } = await import('../thought-store');
    await recordFeedback(thoughtId, 'useful', 'did it', 'explicit').catch(() => {});
  }
  return result;
}

/** The guided kind's second tap: send the draft as it stands in Gmail. */
export async function sendIt(thoughtId: string, now = new Date()): Promise<ActResult> {
  return db.transaction(async (tx): Promise<ActResult> => {
    const row = await loadRow(tx, thoughtId);
    const found = row ? readStored(row.actions) : null;
    const d = found?.stored.done;
    if (!found || found.plan.kind !== 'email_draft' || !d?.draft) return { ok: false, reason: 'There is no draft on this note to send.' };
    if (d.undoneAt) return { ok: false, reason: 'That draft was discarded.' };
    if (d.sentAt) return { ok: true, status: 'sent', label: doneLabel(found.stored, found.plan), already: true };
    const [acct] = await tx.select().from(gmailAccounts).where(eq(gmailAccounts.email, d.draft.accountEmail)).limit(1);
    if (!acct) return { ok: false, reason: 'The mailbox it was drafted in is no longer connected.' };
    const { gmailService } = await import('$lib/integrations/gmail/service');
    try {
      await gmailService.sendDraft(acct, d.draft.id);
    } catch (err) {
      return { ok: false, reason: `Gmail did not send it: ${String(err instanceof Error ? err.message : err).slice(0, 200)}. It may have been sent or deleted in Gmail already.` };
    }
    const entry: StoredAction = { ...found.stored, done: { ...d, sentAt: now.toISOString() } };
    await tx.update(daydreamThoughts).set({ proposedActions: replaceAction(row!.actions, entry), updatedAt: now }).where(eq(daydreamThoughts.id, thoughtId));
    return { ok: true, status: 'sent', label: doneLabel(entry, found.plan) };
  });
}

/** Undo, by kind. A sent email and a reminder that has fired cannot be. */
export async function undoIt(thoughtId: string, now = new Date()): Promise<ActResult> {
  return db.transaction(async (tx): Promise<ActResult> => {
    const row = await loadRow(tx, thoughtId);
    const found = row ? readStored(row.actions) : null;
    const done = found?.stored.done;
    if (!found || !done) return { ok: false, reason: 'There is nothing to undo on this note.' };
    if (done.undoneAt) return { ok: true, status: 'undone', label: found.stored.label, already: true };
    const plan = found.plan;

    switch (plan.kind) {
      case 'calendar_event': {
        let eventId = done.eventId;
        if (done.uid) {
          const listed = await tool('apple_calendar_list', {
            calendar: done.calendar, dateRangeStart: plan.date, dateRangeEnd: shiftDay(plan.date, 2), query: plan.title,
          });
          const events = ((listed?.data as { events?: Array<{ id?: unknown; uid?: unknown }> } | undefined)?.events ?? []);
          const match = events.find((e) => e.uid === done.uid);
          eventId = match && typeof match.id === 'string' ? match.id : listed?.success ? null : eventId;
        }
        if (eventId) {
          const deleted = await tool('apple_calendar_delete', { calendar: done.calendar, eventId });
          if (!deleted?.success) return { ok: false, reason: `Your calendar did not let it remove the entry: ${why(deleted)}` };
        }
        // Not found is gone already — removed by hand, most likely.
        break;
      }
      case 'reminder': {
        if (done.fireAt && Date.parse(done.fireAt) <= now.getTime()) return { ok: false, reason: 'It has already reminded you, so there is nothing to take back.' };
        const cancelled = await tool('cancel_scheduled_callback', { name: done.callback ?? reminderName(thoughtId) });
        if (!cancelled?.success) return { ok: false, reason: `The reminder could not be cancelled: ${why(cancelled)}` };
        break;
      }
      case 'calendar_move': {
        if (!done.before || !done.eventId) return { ok: false, reason: 'It did not keep where the entry was, so it cannot put it back.' };
        const restored = await tool('apple_calendar_update', { calendar: done.calendar, eventId: done.eventId, ...toUpdateTimes(done.before) });
        if (!restored?.success) return { ok: false, reason: `Your calendar did not take it back: ${why(restored)}` };
        break;
      }
      case 'event_hold': {
        const failed = await removeEntry(done.calendar, { uid: done.uid, eventId: done.eventId, date: plan.date, title: plan.title });
        if (failed) return { ok: false, reason: failed };
        // A reminder that has already fired has nothing left to cancel.
        if (done.callback && !(done.fireAt && Date.parse(done.fireAt) <= now.getTime())) {
          const cancelled = await tool('cancel_scheduled_callback', { name: done.callback });
          if (!cancelled?.success) return { ok: false, reason: `The entry is out, but the reminder could not be cancelled: ${why(cancelled)}` };
        }
        break;
      }
      case 'calendar_batch': {
        for (const entry of done.batch ?? []) {
          const failed = await removeEntry(done.calendar, entry);
          if (failed) return { ok: false, reason: failed };
        }
        break;
      }
      case 'email_draft': {
        if (done.sentAt) return { ok: false, reason: 'It has been sent, so it cannot be taken back.' };
        if (done.draft) {
          const [acct] = await tx.select().from(gmailAccounts).where(and(eq(gmailAccounts.email, done.draft.accountEmail))).limit(1);
          if (acct) {
            const { gmailService } = await import('$lib/integrations/gmail/service');
            await gmailService.deleteDraft(acct, done.draft.id);
          }
        }
        break;
      }
    }
    const entry: StoredAction = { ...found.stored, done: { ...done, undoneAt: now.toISOString() } };
    await tx
      .update(daydreamThoughts)
      .set({ proposedActions: replaceAction(row!.actions, entry), updatedAt: now })
      .where(eq(daydreamThoughts.id, thoughtId));
    return { ok: true, status: 'undone', label: found.stored.label };
  });
}
