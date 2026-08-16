import { register } from '../registry-internal';
import type { ToolDefinition, ToolResult } from '../registry-internal';
import { appleCalendarExecutor, parseCalendarDateRange, resolveOptions_calendar } from '$lib/workflows/nodes/apple-calendar';
import { standaloneContext } from '$lib/workflows/standalone-context';
import { listCredentials } from '$lib/integrations/credentials';

const TIMEZONE = 'Europe/London';

type CalendarOption = { value: string; label: string };

function availableCalendarLabels(options: CalendarOption[]): string {
  const labels = options.slice(0, 10).map((option) => option.label);
  const omitted = options.length - labels.length;
  return [...labels, ...(omitted ? [`+${omitted} more`] : [])].join(', ');
}

export function resolveCalendar(options: CalendarOption[], requested: unknown): CalendarOption | { error: string } {
  const selection = typeof requested === 'string' ? requested.trim() : '';
  if (!selection) return { error: 'calendar is required. Call apple_calendar_list with credentialId first to see available calendars.' };
  const exact = options.filter((option) => option.value === selection || option.label === selection);
  const named = exact.length ? exact : options.filter((option) => option.label.toLowerCase() === selection.toLowerCase());
  if (named.length === 1) return named[0];
  if (named.length > 1) return { error: `Calendar name "${selection}" is ambiguous. Available: ${availableCalendarLabels(options)}. Use the calendar resource URL returned by apple_calendar_list.` };
  return { error: `No calendar named "${selection}" was found for this Apple Calendar credential. Available: ${availableCalendarLabels(options)}. Use the calendar resource URL returned by apple_calendar_list when names are similar.` };
}

/**
 * Which calendars a READ covers.
 *
 * Omitting `calendar` means every calendar on the credential, and that default
 * is the point of this function rather than a convenience. Names are matched
 * exactly and a near-miss returns an EMPTY calendar rather than an error, so
 * "pick one calendar by name" is a shape that fails silently: on 2026-08-15 a
 * single question cost ten calls walking calendars one at a time and still
 * answered nothing, because only one of several similarly-named calendars
 * holds events. Reading all of them cannot miss, and the caller can still
 * narrow with a name or an array when it genuinely knows which one it wants.
 *
 * Writes keep the single-calendar resolver above: picking the wrong calendar
 * to READ costs an extra row, picking the wrong one to WRITE puts an event in
 * the wrong place.
 */
export function resolveCalendarSelection(
  options: CalendarOption[],
  requested: unknown,
): CalendarOption[] | { error: string } {
  if (requested === undefined || requested === null || requested === '') return options;
  const wanted = Array.isArray(requested) ? requested : [requested];
  const chosen: CalendarOption[] = [];
  for (const one of wanted) {
    const resolved = resolveCalendar(options, one);
    if ('error' in resolved) return resolved;
    if (!chosen.some((c) => c.value === resolved.value)) chosen.push(resolved);
  }
  return chosen;
}

/** Days a read covers when the caller names no range at all. */
export const DEFAULT_RANGE_DAYS = 30;

/** Merged event rows returned by one read, before truncation markers. */
export const MAX_MERGED_EVENTS = 100;

const RELATIVE_UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

/**
 * Resolve a caller-supplied range bound to an ISO instant.
 *
 * Accepts the absolute ISO-8601 the node has always wanted, plus the relative
 * forms a person actually says — `today`, `tomorrow`, `+7d`, `-3d`, `+3m`.
 * Without these every calendar question cost a `current_date` call first, and
 * then the model did the arithmetic itself; both are round trips spent on
 * something the server already knows.
 *
 * Date-only and keyword forms snap to a Europe/London day boundary — `today`
 * as a range start means 00:00 local, not "this instant", or "what's on
 * today" silently loses the morning.
 */
export function resolveRangeBound(
  value: unknown,
  edge: 'start' | 'end',
  now: Date = new Date(),
): string | { error: string } {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return { error: `${edge === 'start' ? 'dateRangeStart' : 'dateRangeEnd'} is required.` };

  const dayOffset = (days: number): string => {
    const parts = dateParts(now);
    const anchor = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
    const shifted = new Date(anchor + days * 86_400_000);
    const day = shifted.toISOString().slice(0, 10);
    return edge === 'start' ? `${day}T00:00:00Z` : `${day}T23:59:59Z`;
  };

  if (raw === 'today' || raw === 'now') return dayOffset(0);
  if (raw === 'tomorrow') return dayOffset(1);
  if (raw === 'yesterday') return dayOffset(-1);

  const relative = raw.match(/^([+-])(\d{1,4})\s*([dwmy])$/);
  if (relative) {
    const magnitude = Number(relative[2]) * RELATIVE_UNIT_DAYS[relative[3]];
    return dayOffset(relative[1] === '-' ? -magnitude : magnitude);
  }

  // A bare YYYY-MM-DD is a whole local day, not midnight UTC — otherwise an
  // end date of "2026-08-20" excludes everything that happens on the 20th.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return edge === 'start' ? `${raw}T00:00:00Z` : `${raw}T23:59:59Z`;

  const absolute = new Date(raw);
  if (Number.isNaN(absolute.getTime())) {
    return { error: `Invalid ${edge === 'start' ? 'dateRangeStart' : 'dateRangeEnd'} "${String(value)}". Use ISO-8601, a YYYY-MM-DD date, or a relative form such as "today", "tomorrow", "+7d", "-3d".` };
  }
  return absolute.toISOString();
}

/** The window a read covers when the caller supplies neither bound. */
export function defaultRange(now: Date = new Date()): { start: string; end: string } {
  return {
    start: resolveRangeBound('today', 'start', now) as string,
    end: resolveRangeBound(`+${DEFAULT_RANGE_DAYS}d`, 'end', now) as string,
  };
}

type EventRow = Record<string, unknown>;

/** Case-insensitive substring match over the fields a person would search. */
export function matchesQuery(event: EventRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack: string[] = [];
  for (const key of ['title', 'location', 'description'] as const) {
    const value = event[key];
    if (typeof value === 'string') haystack.push(value);
  }
  const attendees = event.attendees;
  if (Array.isArray(attendees)) {
    for (const attendee of attendees) {
      if (attendee && typeof attendee === 'object') {
        for (const key of ['cn', 'address'] as const) {
          const value = (attendee as Record<string, unknown>)[key];
          if (typeof value === 'string') haystack.push(value);
        }
      }
    }
  }
  const organizer = event.organizer;
  if (organizer && typeof organizer === 'object') {
    for (const key of ['cn', 'address'] as const) {
      const value = (organizer as Record<string, unknown>)[key];
      if (typeof value === 'string') haystack.push(value);
    }
  }
  return haystack.join('\n').toLowerCase().includes(needle);
}

/**
 * Filter on when the event ROW was written, not when the event happens.
 *
 * "What got added to the calendar this week" is a question about `created` /
 * `lastModified`, which every parsed event already carries — but with no filter
 * for them the only way to answer was to read a wide event window and eyeball
 * it, which is what happened on 2026-08-15 and produced the wrong answer.
 *
 * An event missing the stamp is EXCLUDED when the caller filters on it. The
 * alternative — treating "unknown" as a match — reports events as newly added
 * when nothing is known about when they were added, and that is the claim the
 * question is actually testing.
 */
export function matchesProvenance(
  event: EventRow,
  bounds: { createdAfter?: Date; modifiedAfter?: Date },
): boolean {
  for (const [field, after] of [['created', bounds.createdAfter], ['lastModified', bounds.modifiedAfter]] as const) {
    if (!after) continue;
    const raw = event[field];
    if (typeof raw !== 'string') return false;
    const stamp = new Date(raw);
    if (Number.isNaN(stamp.getTime()) || stamp < after) return false;
  }
  return true;
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

/**
 * The credential to act on, resolving the single-credential case rather than
 * demanding it be discovered first.
 *
 * Discovering it cost a whole round trip on every calendar question, for a
 * value that has exactly one possible answer here. When more than one
 * credential IS configured the ambiguity is real, so the list comes back and
 * the caller chooses — the same shape `gmail_list_accounts` uses for mailboxes.
 * Credentials themselves are still never accepted in arguments; only the safe
 * id crosses the boundary.
 */
export async function resolveAppleCredential(
  requested: unknown,
): Promise<{ credentialId: string } | { error: string; credentials?: Array<{ id: string; label: string }> }> {
  const explicit = typeof requested === 'string' ? requested.trim() : '';
  if (explicit) return { credentialId: explicit };
  let credentials: Array<{ id: string; label: string; integrationType?: string }>;
  try {
    credentials = await listCredentials('apple-calendar');
  } catch (err) {
    return { error: err instanceof Error ? `Unable to list Apple Calendar credentials: ${err.message}` : 'Unable to list Apple Calendar credentials.' };
  }
  if (!credentials.length) {
    return { error: 'No Apple Calendar credentials are configured. Add an iCloud app-specific-password credential before reading calendars.' };
  }
  if (credentials.length === 1) return { credentialId: credentials[0].id };
  return {
    error: `More than one Apple Calendar credential is configured — pass credentialId to choose: ${credentials.map((c) => `${c.label} (${c.id})`).join(', ')}.`,
    credentials: credentials.map(({ id, label }) => ({ id, label })),
  };
}

async function selectedCalendar(args: Record<string, unknown>): Promise<{ credentialId: string; calendar: CalendarOption } | { error: string }> {
  const credential = await resolveAppleCredential(args.credentialId);
  if ('error' in credential) return { error: credential.error };
  try {
    const calendar = resolveCalendar(await resolveOptions_calendar(credential.credentialId), args.calendar);
    if ('error' in calendar) return calendar;
    return { credentialId: credential.credentialId, calendar };
  } catch (err) {
    return { error: err instanceof Error ? `Unable to access Apple Calendar: ${err.message}` : 'Unable to access Apple Calendar.' };
  }
}

/**
 * Read events — the one call a calendar question should cost.
 *
 * Every argument is optional. With none, this reads the next 30 days across
 * every calendar on the only configured credential, which is the answer to
 * "what's on?". `listCalendars: true` is the explicit escape hatch back to the
 * old discovery behaviour, kept because a write still needs a calendar name.
 *
 * The ladder this replaces (credentials, then calendars, then one call per
 * calendar) was the single most expensive shape in the toolchain: 20 of 196
 * tool calls over ten conversations, twice answering nothing at all.
 */
export async function handleAppleCalendarList(args: Record<string, unknown>): Promise<ToolResult> {
  const credential = await resolveAppleCredential(args.credentialId);
  if ('error' in credential) {
    return { success: false, error: credential.error, ...(credential.credentials ? { data: { credentials: credential.credentials } } : {}) };
  }
  const { credentialId } = credential;

  if (args.includeRawIcs !== undefined && typeof args.includeRawIcs !== 'boolean') {
    return { success: false, error: 'includeRawIcs must be a boolean.' };
  }

  let calendars: CalendarOption[];
  try {
    const resolved = await resolveOptions_calendar(credentialId);
    // Not defensive padding: a credential that resolves to nothing is the
    // wrong-credential case, and letting a non-array through here surfaces as
    // an opaque TypeError several frames away instead of a usable message.
    calendars = Array.isArray(resolved) ? resolved : [];
  } catch (err) {
    return { success: false, error: err instanceof Error ? `Unable to access Apple Calendar: ${err.message}` : 'Unable to access Apple Calendar.' };
  }
  if (args.listCalendars === true) return { success: true, data: { credentialId, calendars } };

  const selection = resolveCalendarSelection(calendars, args.calendar);
  if ('error' in selection) return { success: false, error: selection.error };
  if (!selection.length) {
    return { success: false, error: 'This Apple Calendar credential exposes no calendars.' };
  }

  const fallback = defaultRange();
  const start = resolveRangeBound(args.dateRangeStart ?? fallback.start, 'start');
  if (typeof start !== 'string') return { success: false, error: start.error };
  const end = resolveRangeBound(args.dateRangeEnd ?? fallback.end, 'end');
  if (typeof end !== 'string') return { success: false, error: end.error };
  const range = parseCalendarDateRange(start, end);
  if ('error' in range) return { success: false, error: range.error };

  const provenance: { createdAfter?: Date; modifiedAfter?: Date } = {};
  for (const [arg, key] of [['createdAfter', 'createdAfter'], ['modifiedAfter', 'modifiedAfter']] as const) {
    if (args[arg] === undefined) continue;
    const bound = resolveRangeBound(args[arg], 'start');
    if (typeof bound !== 'string') return { success: false, error: bound.error.replace(/dateRangeStart/g, arg) };
    provenance[key] = new Date(bound);
  }
  const query = typeof args.query === 'string' ? args.query : '';

  // One calendar failing must not lose the calendars that answered. Reading
  // several and reporting none because the fourth timed out is how the ladder
  // used to fail, and it looked identical to an empty diary.
  const reads = await Promise.all(selection.map(async (calendar) => {
    try {
      const result = await appleCalendarExecutor.execute({}, {
        credentialId, operation: 'list', calendar: calendar.value,
        dateRangeStart: start, dateRangeEnd: end, includeRawIcs: args.includeRawIcs === true,
      }, standaloneContext());
      const output = (result.output ?? {}) as { events?: unknown; truncated?: unknown };
      const events = Array.isArray(output.events) ? (output.events as EventRow[]) : [];
      return { calendar, events, truncated: output.truncated === true, error: null as string | null };
    } catch (err) {
      return { calendar, events: [] as EventRow[], truncated: false, error: err instanceof Error ? err.message : 'read failed' };
    }
  }));

  const failures = reads.filter((r) => r.error).map((r) => `${r.calendar.label}: ${r.error}`);
  if (failures.length === reads.length) {
    return { success: false, error: `Unable to list Apple Calendar events. ${failures.join('; ')}` };
  }

  const matched: EventRow[] = reads
    .flatMap((read) => read.events.map((event): EventRow => ({ ...event, calendar: read.calendar.label })))
    .filter((event) => matchesQuery(event, query) && matchesProvenance(event, provenance))
    .sort((a, b) => String(a.start ?? '').localeCompare(String(b.start ?? '')));

  const events = matched.slice(0, MAX_MERGED_EVENTS);
  return {
    success: true,
    data: {
      events,
      totalCount: matched.length,
      truncated: matched.length > MAX_MERGED_EVENTS || reads.some((r) => r.truncated),
      limit: MAX_MERGED_EVENTS,
      calendarsRead: reads.filter((r) => !r.error).map((r) => r.calendar.label),
      range: { start, end },
      ...(query ? { query } : {}),
      // A partial read has to say so. Silence here reads as "nothing on that
      // calendar", which is the exact wrong conclusion.
      ...(failures.length ? { unavailable: failures } : {}),
    },
  };
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
    description: 'Read iCloud Calendar events. ANSWER A CALENDAR QUESTION IN ONE CALL: every argument is optional, and with none it reads the next 30 days across EVERY calendar on the only configured credential — do not call it first to discover the credential, then again for calendars, then once per calendar. Narrow with `query` (case-insensitive text over title, location, notes, organiser and attendees), `calendar` (a name or an array of names to restrict to), and `dateRangeStart`/`dateRangeEnd`, which accept ISO-8601, a YYYY-MM-DD date, or relative forms — "today", "tomorrow", "+7d", "-3d", "+3m" — so you never need a separate date lookup. Use `createdAfter`/`modifiedAfter` for "what was added or changed recently", which is a different question from when the event happens. Returns at most 100 compact rows merged across calendars and sorted by start, each tagged with its `calendar`, plus totalCount, truncated, calendarsRead, and `unavailable` when a calendar could not be read — treat a result with `unavailable` as partial, never as an empty diary. Set includeRawIcs only for intentional diagnostics. Pass `listCalendars: true` only when you need calendar names for a WRITE. ORGANIZER identifies a meeting organiser, not a guaranteed creator or audit identity for manually added shared-calendar events. Credentials are resolved server-side; only their safe ids and labels are returned.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id. Omit — it is resolved automatically when only one is configured.' }, calendar: { type: ['string', 'array'], items: { type: 'string' }, description: 'Restrict the read to one calendar, or several. Omit to read every calendar, which is almost always what you want. A resource URL, or a displayed name matched exactly.' }, dateRangeStart: { type: 'string', description: 'Range start: ISO-8601, YYYY-MM-DD, or relative ("today", "-3d", "+2w"). Defaults to today.' }, dateRangeEnd: { type: 'string', description: 'Range end: ISO-8601, YYYY-MM-DD, or relative ("tomorrow", "+30d", "+3m"). Defaults to 30 days out.' }, query: { type: 'string', description: 'Case-insensitive text filter over event title, location, notes, organiser and attendees.' }, createdAfter: { type: 'string', description: 'Only events whose calendar entry was CREATED after this point. Same date forms as the range. Events with no creation stamp are excluded.' }, modifiedAfter: { type: 'string', description: 'Only events whose calendar entry was last MODIFIED after this point. Same date forms as the range.' }, listCalendars: { type: 'boolean', description: 'Return the calendar list instead of events. Only needed to pick a calendar for a write.' }, includeRawIcs: { type: 'boolean', description: 'Include raw ICS and extension properties for diagnostics. Defaults to false.' } }, required: [] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarList,
  },
  {
    name: 'apple_calendar_create', destructive: true,
    description: 'Create an iCloud Calendar event on a selected existing credential and calendar. Use start/end ISO date-times, or allDayStart/allDayEnd inclusive YYYY-MM-DD dates. This is an external write and requires user confirmation. Identical retries are de-duplicated by a deterministic UID based on credential, calendar, title, start and end.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id. Omit — it is resolved automatically when only one is configured.' }, calendar: { type: 'string', description: 'Calendar resource URL or unambiguous displayed name (for example Family).' }, title: { type: 'string' }, start: { type: 'string', description: 'ISO-8601 event start date-time.' }, end: { type: 'string', description: 'ISO-8601 event end date-time.' }, allDayStart: { type: 'string', description: 'Inclusive all-day start date, YYYY-MM-DD.' }, allDayEnd: { type: 'string', description: 'Inclusive all-day end date, YYYY-MM-DD.' }, location: { type: 'string' }, notes: { type: 'string' } }, required: ['calendar', 'title'] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarCreate,
  },
  {
    name: 'apple_calendar_update', destructive: true,
    description: 'Edit an existing iCloud Calendar event, such as renaming it or changing its time, all-day dates, location, or notes. Only supplied fields change; omitted fields are preserved. This external write requires user confirmation and verifies the event belongs to the selected credential and calendar.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id. Omit — it is resolved automatically when only one is configured.' }, calendar: { type: 'string', description: 'Calendar resource URL or unambiguous displayed name.' }, eventId: { type: 'string', description: 'Event resource URL returned by listing events; it must belong to this calendar.' }, title: { type: 'string', description: 'Replacement event title.' }, start: { type: 'string', description: 'Replacement ISO-8601 timed start; omit to preserve it.' }, end: { type: 'string', description: 'Replacement ISO-8601 timed end; omit to preserve it.' }, allDayStart: { type: 'string', description: 'Replacement inclusive all-day start, YYYY-MM-DD; provide with allDayEnd.' }, allDayEnd: { type: 'string', description: 'Replacement inclusive all-day end, YYYY-MM-DD; provide with allDayStart.' }, location: { type: 'string', description: 'Replacement location; an empty string clears it.' }, notes: { type: 'string', description: 'Replacement notes; an empty string clears them.' } }, required: ['calendar', 'eventId'] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarUpdate,
  },
  {
    name: 'apple_calendar_delete', destructive: true,
    description: 'Delete an existing iCloud Calendar event from the selected credential and calendar. This cannot be undone, requires user confirmation, and verifies the event belongs to that calendar before deletion.',
    parameters: { type: 'object', properties: { credentialId: { type: 'string', description: 'Existing Apple Calendar credential id. Omit — it is resolved automatically when only one is configured.' }, calendar: { type: 'string', description: 'Calendar resource URL or unambiguous displayed name.' }, eventId: { type: 'string', description: 'Event resource URL returned by listing events; it must belong to this calendar.' } }, required: ['calendar', 'eventId'] },
    category: 'Apple Calendar', toolset: 'apple-calendar', handler: handleAppleCalendarDelete,
  },
];

for (const tool of appleCalendarTools) register(tool);
