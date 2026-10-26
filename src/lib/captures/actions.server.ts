// Carrying out a capture's follow-up, once the owner has tapped Approve.
//
// The tap is the consent, as on a daydream note's "Do it for me"
// (`$lib/daydream/act/act.server.ts`): the tools are called directly through
// the registry, in-process, not through chat's confirmation gate — that gate
// stops a MODEL writing on its own initiative, and here the owner pressed the
// button for this one row. Reused, not reimplemented: every kind lands on a
// tool that already exists.
//
//   research   → research_start (depth `brief`), in the background: it takes
//                a couple of minutes, and the phone should not hold a request
//                open for it. The row stays `approved` until it finishes.
//   calendar   → apple_calendar_create, on the calendar named in params or the
//                one chosen once for jkai's diary entries.
//   followup   → schedule_tool_call_at → notify_owner (category reminder) at
//   todo_me      `when` / `due_at`. NOT `followup_schedule`: that tool only
//                watches a research or build id, in memory, and cannot carry
//                a message to a time (CONTRACT "Main deviations").
//   todo_other → a message draft stored on the row. Never sent.
//   remember   → an outbox `note` job, filed under the capture so a delete
//                takes it with it.
//
// Never throws: a failure is the row's `failed` state, with the reason.

import type { Capture, CaptureAction } from '$lib/db/schema';
import { enqueueIntelJob } from '$lib/intel-client/outbox';
import { rememberRefId, updateAction } from './store.server';
import type {
  CalendarActionParams,
  CaptureActionKind,
  FollowupActionParams,
  RememberActionParams,
  ResearchActionParams,
} from './types';

export interface ActionOutcome {
  state: 'done' | 'failed' | 'approved';
  refKind?: string | null;
  refId?: string | null;
  error?: string | null;
  /** Params to store back (the draft a todo_other made). */
  params?: Record<string, unknown>;
}

const SITE = 'https://strangeramblings.com';
const DEFAULT_REMINDER_HOUR = '09:00';

async function tool(name: string, args: Record<string, unknown>) {
  // Dynamic: the registry boots platform services on import.
  const { executeTool } = await import('$lib/tools/registry');
  return executeTool(name, args);
}

const why = (res: { error?: unknown } | null | undefined) => String(res?.error ?? 'no reason given').slice(0, 300);

/** Tomorrow at nine, London — when a to-do with no time is brought back. */
async function tomorrowMorning(now: Date): Promise<string> {
  const { londonToUtc } = await import('$lib/daydream/act/plan');
  const d = new Date(now.getTime() + 24 * 3600_000);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return londonToUtc(date, DEFAULT_REMINDER_HOUR);
}

async function remind(a: CaptureAction, c: Capture, fireAt: string, body: string, now: Date): Promise<ActionOutcome> {
  if (Date.parse(fireAt) <= now.getTime() + 60_000) return { state: 'failed', error: 'That time has already gone. Edit the time and approve again.' };
  const name = `capture-remind-${a.id}`;
  const res = await tool('schedule_tool_call_at', {
    name,
    tool_name: 'notify_owner',
    args: {
      category: 'reminder',
      title: a.title.slice(0, 120),
      body: body.slice(0, 1_000),
      url: `sr://captures/${c.id}`,
      severity: 'info',
      dedupeKey: `capture-remind:${a.id}`,
    },
    fire_at_iso: fireAt,
  });
  if (!res?.success) return { state: 'failed', error: `The reminder could not be set: ${why(res)}` };
  return { state: 'done', refKind: 'callback', refId: name };
}

/** The draft a todo_other leaves behind. Words only; nothing is sent. */
export function draftFor(a: Pick<CaptureAction, 'who' | 'title' | 'detail'>): string {
  const who = (a.who ?? '').trim();
  const lines = [`Hi${who ? ` ${who.split(/\s+/)[0]}` : ''},`, '', a.title.trim()];
  if (a.detail?.trim()) lines.push(a.detail.trim());
  lines.push('', 'Thanks');
  return lines.join('\n');
}

/** Run one approved action. Exported for the background research path and tests. */
export async function executeCaptureAction(a: CaptureAction, c: Capture, now = new Date()): Promise<ActionOutcome> {
  try {
    const kind = a.kind as CaptureActionKind;
    switch (kind) {
      case 'research': {
        const { question } = a.params as unknown as ResearchActionParams;
        const res = await tool('research_start', {
          topic: question,
          depth: 'brief',
          goals: [a.title, ...(a.detail ? [a.detail] : [])].slice(0, 3),
        });
        if (!res?.success) return { state: 'failed', error: `Research did not run: ${why(res)}` };
        const d = (res.data ?? {}) as { id?: string };
        return { state: 'done', refKind: 'research', refId: d.id ?? null };
      }
      case 'calendar': {
        const p = a.params as unknown as CalendarActionParams;
        let calendar = p.calendar ?? null;
        if (!calendar) {
          const { actCalendar } = await import('$lib/daydream/act/act.server');
          calendar = await actCalendar();
        }
        if (!calendar) {
          return { state: 'failed', error: 'Choose which calendar jkai writes to (a daydream note asks once), or name one in the action.' };
        }
        const end = p.end ?? new Date(Date.parse(p.start) + 60 * 60_000).toISOString();
        const notes = [
          p.attendees?.length ? `With: ${p.attendees.join(', ')}` : '',
          a.detail ?? '',
          `From a capture: ${SITE}/captures/${c.id}`,
        ].filter(Boolean).join('\n');
        const res = await tool('apple_calendar_create', {
          calendar,
          title: p.title,
          start: p.start,
          end,
          ...(p.location ? { location: p.location } : {}),
          notes,
        });
        if (!res?.success) return { state: 'failed', error: `Your calendar did not take it: ${why(res)}` };
        const d = (res.data ?? {}) as { id?: unknown; url?: unknown };
        const ref = typeof d.url === 'string' ? d.url : typeof d.id === 'string' ? d.id : null;
        return { state: 'done', refKind: 'calendar', refId: ref };
      }
      case 'followup': {
        const p = a.params as unknown as FollowupActionParams;
        return await remind(a, c, p.when, p.message, now);
      }
      case 'todo_me': {
        const fireAt = a.dueAt ? a.dueAt.toISOString() : await tomorrowMorning(now);
        return await remind(a, c, fireAt, a.detail || a.title, now);
      }
      case 'todo_other': {
        return { state: 'done', refKind: 'draft', refId: null, params: { ...(a.params ?? {}), draft: draftFor(a) } };
      }
      case 'remember': {
        const p = a.params as unknown as RememberActionParams;
        const refId = rememberRefId(c.id, a.id);
        const jobId = await enqueueIntelJob('note', `capture:${c.id}`, {
          title: (p.entity ? `${p.entity}: ${a.title}` : a.title).slice(0, 200),
          content: p.fact,
          source: 'capture',
          spaceId: c.spaceId,
          metadata: { autoKind: 'capture', refId, captureId: c.id, sourceUrl: `/captures/${c.id}`, ...(p.entity ? { entity: p.entity } : {}) },
          process: true,
        });
        return { state: 'done', refKind: 'intel-job', refId: String(jobId) };
      }
      default:
        return { state: 'failed', error: `unknown action kind: ${String(kind)}` };
    }
  } catch (err) {
    return { state: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

/** Write an outcome onto the row. */
export async function recordOutcome(a: CaptureAction, out: ActionOutcome): Promise<CaptureAction> {
  const row = await updateAction(a.id, {
    state: out.state,
    refKind: out.refKind ?? null,
    refId: out.refId ?? null,
    error: out.error ?? null,
    ...(out.params ? { params: out.params } : {}),
  });
  return row ?? { ...a, state: out.state, refKind: out.refKind ?? null, refId: out.refId ?? null, error: out.error ?? null };
}

/** Kinds that run longer than a tap should wait for: started, answered `approved`. */
export const BACKGROUND_KINDS: ReadonlySet<CaptureActionKind> = new Set(['research']);

/**
 * Approve: run it now, or start it and return `approved` for a background
 * kind. The row is already claimed (`approved`) by the caller, so a second
 * tap cannot run it twice.
 */
export async function runApprovedAction(a: CaptureAction, c: Capture): Promise<CaptureAction> {
  if (BACKGROUND_KINDS.has(a.kind as CaptureActionKind)) {
    void executeCaptureAction(a, c)
      .then((out) => recordOutcome(a, out))
      .catch((err) => console.error(`[captures] action ${a.id} failed:`, err instanceof Error ? err.message : err));
    return a;
  }
  return recordOutcome(a, await executeCaptureAction(a, c));
}
