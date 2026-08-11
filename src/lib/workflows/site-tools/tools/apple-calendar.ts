import { register } from '../registry-internal';
import type { ToolDefinition, ToolResult } from '../registry-internal';
import { appleCalendarExecutor, resolveOptions_calendar } from '$lib/workflows/nodes/apple-calendar';
import { standaloneContext } from '$lib/workflows/standalone-context';
import { listCredentials } from '$lib/integrations/credentials';

const TIMEZONE = 'Europe/London';

type CalendarOption = { value: string; label: string };

export function resolveCalendar(options: CalendarOption[], requested: unknown): CalendarOption | { error: string } {
  const selection = typeof requested === 'string' ? requested.trim() : '';
  if (!selection) return { error: 'calendar is required. Call apple_calendar_list with credentialId first to see available calendars.' };
  const exact = options.filter((option) => option.value === selection || option.label === selection);
  const named = exact.length ? exact : options.filter((option) => option.label.toLowerCase() === selection.toLowerCase());
  if (named.length === 1) return named[0];
  if (named.length > 1) return { error: `Calendar name "${selection}" is ambiguous. Use the calendar resource URL returned by apple_calendar_list.` };
  return { error: `No calendar named "${selection}" was found for this Apple Calendar credential. Call apple_calendar_list with credentialId to choose one.` };
}

function dateParts(value: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

/**
 * Interpret a bare `YYYY-MM-DDTHH:MM[:SS]` as a Europe/London wall clock.
 *
 * Two passes: read the string as though it were UTC, ask what London's clock
 * actually showed at that instant, and shift by the difference. One pass is
 * enough everywhere except within an hour of a DST change, where the offset
 * used to correct sits on the wrong side of the boundary; the second settles it.
 */
function londonWallClockToInstant(m: RegExpMatchArray): Date {
  const wanted = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const p = dateParts(new Date(guess));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    if (shown === wanted) break;
    guess -= shown - wanted;
  }
  return new Date(guess);
}

/**
 * Convert a date-time to a UTC iCalendar instant (`…Z`).
 *
 * Deliberately NOT a floating local time tagged `;TZID=Europe/London`: RFC 5545
 * requires a matching VTIMEZONE component for every TZID referenced, we emit
 * none, and a CalDAV server is entitled to reject the whole object for it. A
 * UTC instant needs no VTIMEZONE, cannot be misread, and still displays as
 * London time on a London device — which is the actual requirement.
 */
export function toUtcIcalDateTime(value: unknown): string | { error: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: 'start and end date-times are required.' };
  // A bare ISO date-time denotes the user's London wall-clock time, not UTC.
  const local = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  const date = local ? londonWallClockToInstant(local) : new Date(value);
  if (Number.isNaN(date.getTime())) return { error: `Invalid date-time "${value}". Use an ISO-8601 date-time.` };
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/** `20260923T093000Z` → `2026-09-23T09:30:00Z`, for CalDAV time-range queries. */
function icalToIso(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
}

/** iCalendar all-day DTEND is exclusive; a user-facing end date is inclusive. */
export function allDayRange(start: unknown, end: unknown): { start: string; end: string; rangeStart: string; rangeEnd: string } | { error: string } {
  if (typeof start !== 'string' || typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: 'allDayStart and allDayEnd must be YYYY-MM-DD dates.' };
  }
  if (end < start) return { error: 'allDayEnd must be on or after allDayStart.' };
  const exclusive = new Date(`${end}T00:00:00Z`);
  exclusive.setUTCDate(exclusive.getUTCDate() + 1);
  const exclusiveEnd = exclusive.toISOString().slice(0, 10);
  return { start: start.replaceAll('-', ''), end: exclusiveEnd.replaceAll('-', ''), rangeStart: `${start}T00:00:00Z`, rangeEnd: `${exclusiveEnd}T00:00:00Z` };
}

async function eventUid(credentialId: string, calendar: string, title: string, start: string, end: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([credentialId, calendar, title, start, end]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `jkai-${Array.from(new Uint8Array(hash)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function selectedCalendar(args: Record<string, unknown>): Promise<{ credentialId: string; calendar: CalendarOption } | { error: string }> {
  const credentialId = typeof args.credentialId === 'string' ? args.credentialId.trim() : '';
  if (!credentialId) return { error: 'credentialId is required. Select an existing Apple Calendar credential; credentials are never accepted in tool arguments.' };
  try {
    const calendar = resolveCalendar(await resolveOptions_calendar(credentialId), args.calendar);
    if ('error' in calendar) return calendar;
    return { credentialId, calendar };
  } catch (err) {
    return { error: err instanceof Error ? `Unable to access Apple Calendar: ${err.message}` : 'Unable to access Apple Calendar.' };
  }
}

export async function handleAppleCalendarList(args: Record<string, unknown>): Promise<ToolResult> {
  const credentialId = typeof args.credentialId === 'string' ? args.credentialId.trim() : '';
  if (!credentialId) {
    try {
      const credentials = await listCredentials('apple-calendar');
      if (!credentials.length) return { success: false, error: 'No Apple Calendar credentials are configured. Add an iCloud app-specific-password credential before listing calendars.' };
      return { success: true, data: { credentials: credentials.map(({ id, label, integrationType }) => ({ id, label, integrationType })) } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? `Unable to list Apple Calendar credentials: ${err.message}` : 'Unable to list Apple Calendar credentials.' };
    }
  }
  try {
    const calendars = await resolveOptions_calendar(credentialId);
    if (!args.calendar) return { success: true, data: { calendars } };
    const calendar = resolveCalendar(calendars, args.calendar);
    if ('error' in calendar) return { success: false, error: calendar.error };
    const start = typeof args.dateRangeStart === 'string' ? args.dateRangeStart : '';
    const end = typeof args.dateRangeEnd === 'string' ? args.dateRangeEnd : '';
    if (!start || !end) return { success: false, error: 'dateRangeStart and dateRangeEnd are required when listing events.' };
    const result = await appleCalendarExecutor.execute({}, { credentialId, operation: 'list', calendar: calendar.value, dateRangeStart: start, dateRangeEnd: end }, standaloneContext());
    return { success: true, data: { calendar: calendar.label, ...(result.output as Record<string, unknown>) } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? `Unable to list Apple Calendar events: ${err.message}` : 'Unable to list Apple Calendar events.' };
  }
}

function eventId(args: Record<string, unknown>): string | { error: string } {
  const id = typeof args.eventId === 'string' ? args.eventId.trim() : '';
  return id || { error: 'eventId is required. Use the event resource URL returned when listing events.' };
}

/**
 * Returns `{ patch }` rather than the patch itself, so that `'error' in result`
 * actually discriminates. A `Record<string, unknown> | { error: string }` union
 * does not: any record is allowed an `error` key, so TypeScript cannot narrow
 * it and `result.error` stays `unknown`. That was the second of the two type
 * errors that kept change request #216 out of production.
 */
function updatePatch(
  args: Record<string, unknown>,
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  for (const [argument, config] of [['title', 'eventTitle'], ['location', 'eventLocation'], ['notes', 'eventNotes']] as const) {
    if (args[argument] !== undefined) {
      if (typeof args[argument] !== 'string') return { error: `${argument} must be a string.` };
      patch[config] = args[argument];
    }
  }
  const timed = args.start !== undefined || args.end !== undefined;
  const allDay = args.allDayStart !== undefined || args.allDayEnd !== undefined;
  if (timed && allDay) return { error: 'Use either start/end or allDayStart/allDayEnd, not both.' };
  if (timed) {
    if (args.start !== undefined) {
      const start = toUtcIcalDateTime(args.start);
      if (typeof start !== 'string') return start;
      patch.eventStart = start;
    }
    if (args.end !== undefined) {
      const end = toUtcIcalDateTime(args.end);
      if (typeof end !== 'string') return end;
      patch.eventEnd = end;
    }
    patch.allDay = false;
  }
  if (allDay) {
    // Switching to (or editing) an all-day event needs a complete inclusive range.
    const range = allDayRange(args.allDayStart, args.allDayEnd);
    if ('error' in range) return range;
    patch.eventStart = range.start;
    patch.eventEnd = range.end;
    patch.allDay = true;
  }
  return Object.keys(patch).length ? { patch } : { error: 'Provide at least one field to edit.' };
}

export async function handleAppleCalendarCreate(args: Record<string, unknown>): Promise<ToolResult> {
  const selected = await selectedCalendar(args);
  if ('error' in selected) return { success: false, error: selected.error };
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) return { success: false, error: 'title is required.' };
  const allDay = args.allDayStart !== undefined || args.allDayEnd !== undefined;
  const range = allDay ? allDayRange(args.allDayStart, args.allDayEnd) : null;
  if (range && 'error' in range) return { success: false, error: range.error };
  const start = range ? range.start : toUtcIcalDateTime(args.start);
  const end = range ? range.end : toUtcIcalDateTime(args.end);
  if (typeof start !== 'string') return { success: false, error: start.error };
  if (typeof end !== 'string') return { success: false, error: end.error };
  const uid = await eventUid(selected.credentialId, selected.calendar.value, title, start, end);
  // The duplicate check queries CalDAV for the event's own window, so it must
  // be given resolved instants — handing back the caller's raw string would
  // send an unanchored local time to the server and search the wrong hour.
  const rangeStart = range ? range.rangeStart : icalToIso(start);
  const rangeEnd = range ? range.rangeEnd : icalToIso(end);
  try {
    const result = await appleCalendarExecutor.execute({}, {
      credentialId: selected.credentialId, operation: 'create', calendar: selected.calendar.value,
      eventTitle: title, eventStart: start, eventEnd: end, eventLocation: typeof args.location === 'string' ? args.location : undefined,
      eventNotes: typeof args.notes === 'string' ? args.notes : undefined, eventUid: uid, allDay,
      duplicateRangeStart: rangeStart, duplicateRangeEnd: rangeEnd,
    }, standaloneContext());
    return { success: true, data: result.output };
  } catch (err) {
    return { success: false, error: err instanceof Error ? `Unable to create Apple Calendar event: ${err.message}` : 'Unable to create Apple Calendar event.' };
  }
}

export async function handleAppleCalendarUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const selected = await selectedCalendar(args);
  if ('error' in selected) return { success: false, error: selected.error };
  const id = eventId(args);
  if (typeof id !== 'string') return { success: false, error: id.error };
  const patch = updatePatch(args);
  if ('error' in patch) return { success: false, error: patch.error };
  try {
    const result = await appleCalendarExecutor.execute({}, {
      credentialId: selected.credentialId, operation: 'update', calendar: selected.calendar.value, eventId: id, ...patch.patch,
    }, standaloneContext());
    return { success: true, data: result.output };
  } catch (err) {
    return { success: false, error: err instanceof Error ? `Unable to update Apple Calendar event: ${err.message}` : 'Unable to update Apple Calendar event.' };
  }
}

export async function handleAppleCalendarDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const selected = await selectedCalendar(args);
  if ('error' in selected) return { success: false, error: selected.error };
  const id = eventId(args);
  if (typeof id !== 'string') return { success: false, error: id.error };
  try {
    const result = await appleCalendarExecutor.execute({}, {
      credentialId: selected.credentialId, operation: 'delete', calendar: selected.calendar.value, eventId: id,
    }, standaloneContext());
    return { success: true, data: result.output };
  } catch (err) {
    return { success: false, error: err instanceof Error ? `Unable to delete Apple Calendar event: ${err.message}` : 'Unable to delete Apple Calendar event.' };
  }
}

export const appleCalendarTools: ToolDefinition[] = [
  {
    name: 'apple_calendar_list',
    description: 'List configured Apple Calendar credentials, then calendars, or events in a specified date range, from a selected existing credential. Pass a calendar resource URL or an unambiguous displayed name such as Family. Credentials are resolved server-side; only their safe ids and labels are returned.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id. Omit to list configured credential ids and labels.' }, calendar: { type: 'string', description: 'Calendar resource URL or unambiguous displayed name.' }, dateRangeStart: { type: 'string', description: 'ISO-8601 range start.' }, dateRangeEnd: { type: 'string', description: 'ISO-8601 range end.' } }, required: [] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarList,
  },
  {
    name: 'apple_calendar_create', destructive: true,
    description: 'Create an iCloud Calendar event on a selected existing credential and calendar. Use start/end ISO date-times, or allDayStart/allDayEnd inclusive YYYY-MM-DD dates. This is an external write and requires user confirmation. Identical retries are de-duplicated by a deterministic UID based on credential, calendar, title, start and end.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id.' }, calendar: { type: 'string', description: 'Calendar resource URL or unambiguous displayed name (for example Family).' }, title: { type: 'string' }, start: { type: 'string', description: 'ISO-8601 event start date-time.' }, end: { type: 'string', description: 'ISO-8601 event end date-time.' }, allDayStart: { type: 'string', description: 'Inclusive all-day start date, YYYY-MM-DD.' }, allDayEnd: { type: 'string', description: 'Inclusive all-day end date, YYYY-MM-DD.' }, location: { type: 'string' }, notes: { type: 'string' } }, required: ['credentialId', 'calendar', 'title'] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarCreate,
  },
  {
    name: 'apple_calendar_update', destructive: true,
    description: 'Edit an existing iCloud Calendar event, such as renaming it or changing its time, all-day dates, location, or notes. Only supplied fields change; omitted fields are preserved. This external write requires user confirmation and verifies the event belongs to the selected credential and calendar.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id.' }, calendar: { type: 'string', description: 'Calendar resource URL or unambiguous displayed name.' }, eventId: { type: 'string', description: 'Event resource URL returned by listing events; it must belong to this calendar.' }, title: { type: 'string', description: 'Replacement event title.' }, start: { type: 'string', description: 'Replacement ISO-8601 timed start; omit to preserve it.' }, end: { type: 'string', description: 'Replacement ISO-8601 timed end; omit to preserve it.' }, allDayStart: { type: 'string', description: 'Replacement inclusive all-day start, YYYY-MM-DD; provide with allDayEnd.' }, allDayEnd: { type: 'string', description: 'Replacement inclusive all-day end, YYYY-MM-DD; provide with allDayStart.' }, location: { type: 'string', description: 'Replacement location; an empty string clears it.' }, notes: { type: 'string', description: 'Replacement notes; an empty string clears them.' } }, required: ['credentialId', 'calendar', 'eventId'] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarUpdate,
  },
  {
    name: 'apple_calendar_delete', destructive: true,
    description: 'Delete an existing iCloud Calendar event from the selected credential and calendar. This cannot be undone, requires user confirmation, and verifies the event belongs to that calendar before deletion.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id.' }, calendar: { type: 'string', description: 'Calendar resource URL or unambiguous displayed name.' }, eventId: { type: 'string', description: 'Event resource URL returned by listing events; it must belong to this calendar.' } }, required: ['credentialId', 'calendar', 'eventId'] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarDelete,
  },
];

for (const tool of appleCalendarTools) register(tool);
