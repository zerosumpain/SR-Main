import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/workflows/nodes/apple-calendar', () => ({
  appleCalendarDef: { type: 'apple-calendar' },
  parseCalendarDateRange: vi.fn((start: string, end: string) => {
    const rangeStart = new Date(start);
    const rangeEnd = new Date(end);
    if (Number.isNaN(rangeStart.getTime())) return { error: 'dateRangeStart must be an ISO-8601 date or date-time.' };
    if (Number.isNaN(rangeEnd.getTime())) return { error: 'dateRangeEnd must be an ISO-8601 date or date-time.' };
    if (rangeStart > rangeEnd) return { error: 'dateRangeStart must be on or before dateRangeEnd.' };
    return { start: rangeStart, end: rangeEnd };
  }),
  resolveOptions_calendar: vi.fn(),
  appleCalendarExecutor: { execute: vi.fn() },
}));
vi.mock('$lib/integrations/credentials', () => ({ listCredentials: vi.fn() }));

import { appleCalendarExecutor, resolveOptions_calendar } from '$lib/workflows/nodes/apple-calendar';
import { listCredentials } from '$lib/integrations/credentials';
import { inferToolsets } from '../keyword-classifier';
import { getToolsetDefinitions } from '../registry';
import {
  allDayRange,
  appleCalendarTools,
  handleAppleCalendarCreate,
  handleAppleCalendarDelete,
  handleAppleCalendarList,
  handleAppleCalendarUpdate,
  matchesProvenance,
  matchesQuery,
  resolveAppleCredential,
  resolveCalendar,
  resolveCalendarSelection,
  resolveRangeBound,
  toUtcIcalDateTime,
} from './apple-calendar';

beforeEach(() => vi.clearAllMocks());

describe('Apple Calendar chat tools', () => {
  it('registers direct general-chat read and confirmation-gated write actions', () => {
    expect(appleCalendarTools.map((tool) => tool.name)).toEqual(['apple_calendar_list', 'apple_calendar_create', 'apple_calendar_update', 'apple_calendar_delete']);
    expect(appleCalendarTools.find((tool) => tool.name === 'apple_calendar_create')?.destructive).toBe(true);
    expect(appleCalendarTools.find((tool) => tool.name === 'apple_calendar_update')?.destructive).toBe(true);
    expect(appleCalendarTools.find((tool) => tool.name === 'apple_calendar_delete')?.destructive).toBe(true);
    expect(appleCalendarTools.find((tool) => tool.name === 'apple_calendar_list')?.destructive).not.toBe(true);
    expect(inferToolsets('Add a meeting to my iCloud calendar')).toContain('apple-calendar');
    expect(getToolsetDefinitions('apple-calendar').map((tool) => tool.function.name)).toEqual(['apple_calendar_list', 'apple_calendar_create', 'apple_calendar_update', 'apple_calendar_delete']);
  });

  it('returns the calendar list, not events, when explicitly asked for it', async () => {
    vi.mocked(listCredentials).mockResolvedValue([{ id: 'cred', label: 'iCloud', integrationType: 'apple-calendar' }] as never);
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family Calendar' }] as never);
    const result = await handleAppleCalendarList({ listCalendars: true });
    expect(result).toEqual({ success: true, data: { credentialId: 'cred', calendars: [{ value: '/family/', label: 'Family Calendar' }] } });
    expect(appleCalendarExecutor.execute).not.toHaveBeenCalled();
  });

  it('surfaces a usable message when the credential resolves to no calendars', async () => {
    vi.mocked(listCredentials).mockResolvedValue([{ id: 'cred', label: 'iCloud', integrationType: 'apple-calendar' }] as never);
    // A stub that answers with nothing used to reach `'error' in undefined`
    // several frames later; the caller needs to be told which credential.
    vi.mocked(resolveOptions_calendar).mockResolvedValue(undefined as never);
    expect(await handleAppleCalendarList({})).toMatchObject({ success: false, error: expect.stringMatching(/no calendars/i) });
  });

  it('resolves the displayed Family calendar only when unambiguous', () => {
    expect(resolveCalendar([{ value: '/family/', label: 'Family' }], 'family')).toEqual({ value: '/family/', label: 'Family' });
    expect(resolveCalendar([{ value: '/a/', label: 'Family' }, { value: '/b/', label: 'Family' }], 'Family')).toMatchObject({ error: expect.stringMatching(/ambiguous/i) });
  });

  it('lists available calendar labels when no calendar matches', () => {
    expect(resolveCalendar([
      { value: '/family/', label: 'Family' },
      { value: '/family-calendar/', label: 'Family Calendar' },
      { value: '/personal/', label: 'Personal Calendar' },
      { value: '/home/', label: 'Home' },
    ], 'Famly')).toEqual({
      error: 'No calendar named "Famly" was found for this Apple Calendar credential. Available: Family, Family Calendar, Personal Calendar, Home. Use the calendar resource URL returned by apple_calendar_list when names are similar.',
    });
  });

  it('caps available calendar labels and reports how many were omitted', () => {
    const options = Array.from({ length: 12 }, (_, index) => ({ value: `/calendar-${index + 1}/`, label: `Calendar ${index + 1}` }));
    expect(resolveCalendar(options, 'Missing')).toMatchObject({
      error: expect.stringContaining('Available: Calendar 1, Calendar 2, Calendar 3, Calendar 4, Calendar 5, Calendar 6, Calendar 7, Calendar 8, Calendar 9, Calendar 10, +2 more.'),
    });
  });

  it('lists available labels and resource-URL advice for ambiguous calendar names', () => {
    expect(resolveCalendar([
      { value: '/family-a/', label: 'Family' },
      { value: '/family-b/', label: 'Family' },
      { value: '/personal/', label: 'Personal Calendar' },
    ], 'Family')).toEqual({
      error: 'Calendar name "Family" is ambiguous. Available: Family, Family, Personal Calendar. Use the calendar resource URL returned by apple_calendar_list.',
    });
  });

  it('reads a bare date-time as London wall-clock and emits a UTC instant, on both sides of DST', () => {
    // An offset-bearing input already names its instant.
    expect(toUtcIcalDateTime('2026-09-23T10:30:00+01:00')).toBe('20260923T093000Z');
    // A bare one is what the user said out loud: 10:30 in London. September is
    // BST, so that is 09:30 UTC...
    expect(toUtcIcalDateTime('2026-09-23T10:30')).toBe('20260923T093000Z');
    // ...and January is GMT, where the same wall clock is 10:30 UTC. This pair
    // is the whole point of resolving the zone rather than tagging a TZID.
    expect(toUtcIcalDateTime('2026-01-23T10:30')).toBe('20260123T103000Z');
    expect(toUtcIcalDateTime('not a date')).toMatchObject({ error: expect.stringMatching(/invalid/i) });
  });

  it('converts an inclusive two-day all-day range to an exclusive DTEND', () => {
    expect(allDayRange('2026-09-23', '2026-09-24')).toEqual({
      start: '20260923', end: '20260925', rangeStart: '2026-09-23T00:00:00Z', rangeEnd: '2026-09-25T00:00:00Z',
    });
    expect(allDayRange('2026-09-24', '2026-09-23')).toMatchObject({ error: expect.stringMatching(/on or after/i) });
  });

  it('lists resources before delegating an event read to the workflow executor', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { events: [{ title: 'Lunch' }] }, rowCount: 1 } as never);
    const result = await handleAppleCalendarList({ credentialId: 'cred', calendar: 'Family', dateRangeStart: '2026-09-23T00:00:00Z', dateRangeEnd: '2026-09-24T00:00:00Z' });
    expect(result.success).toBe(true);
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ operation: 'list', calendar: '/family/' }),
      expect.objectContaining({ dryRun: false }),
    );
  });

  it('rejects invalid and reversed event date ranges before calling CalDAV', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    const invalid = await handleAppleCalendarList({ credentialId: 'cred', calendar: 'Family', dateRangeStart: 'nope', dateRangeEnd: '2026-08-15T23:59:59Z' });
    expect(invalid).toMatchObject({ success: false, error: expect.stringMatching(/dateRangeStart.*ISO/i) });
    const reversed = await handleAppleCalendarList({ credentialId: 'cred', calendar: 'Family', dateRangeStart: '2026-08-16T00:00:00Z', dateRangeEnd: '2026-08-15T23:59:59Z' });
    expect(reversed).toMatchObject({ success: false, error: expect.stringMatching(/on or before/i) });
    expect(appleCalendarExecutor.execute).not.toHaveBeenCalled();
  });

  it('passes raw ICS diagnostics only when explicitly requested', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { events: [] }, rowCount: 0 } as never);
    await handleAppleCalendarList({ credentialId: 'cred', calendar: 'Family', dateRangeStart: '2026-08-12T00:00:00Z', dateRangeEnd: '2026-08-15T23:59:59Z' });
    expect(appleCalendarExecutor.execute).toHaveBeenLastCalledWith({}, expect.objectContaining({ includeRawIcs: false }), expect.anything());
    await handleAppleCalendarList({ credentialId: 'cred', calendar: 'Family', dateRangeStart: '2026-08-12T00:00:00Z', dateRangeEnd: '2026-08-15T23:59:59Z', includeRawIcs: true });
    expect(appleCalendarExecutor.execute).toHaveBeenLastCalledWith({}, expect.objectContaining({ includeRawIcs: true }), expect.anything());
  });

  it('delegates a create with a deterministic UID and never accepts credentials as arguments', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { id: 'event', title: 'Lunch' }, rowCount: 1 } as never);
    const result = await handleAppleCalendarCreate({ credentialId: 'cred', calendar: 'Family', title: 'Lunch', allDayStart: '2026-09-23', allDayEnd: '2026-09-24' });
    expect(result).toMatchObject({ success: true, data: { id: 'event' } });
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        credentialId: 'cred', eventUid: expect.stringMatching(/^jkai-/), allDay: true, eventEnd: '20260925',
      }),
      expect.objectContaining({ dryRun: false }),
    );
  });

  it('gives the duplicate check a resolved instant, not the caller’s unanchored string', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { id: 'event' }, rowCount: 1 } as never);
    await handleAppleCalendarCreate({ credentialId: 'cred', calendar: 'Family', title: 'Lunch', start: '2026-09-23T10:30', end: '2026-09-23T11:30' });
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        allDay: false, eventStart: '20260923T093000Z', eventEnd: '20260923T103000Z',
        duplicateRangeStart: '2026-09-23T09:30:00Z', duplicateRangeEnd: '2026-09-23T10:30:00Z',
      }),
      expect.objectContaining({ dryRun: false }),
    );
  });

  it('does not access CalDAV when the calendar cannot be resolved', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([]);
    const result = await handleAppleCalendarCreate({ credentialId: 'cred', calendar: 'Family', title: 'Lunch', start: '2026-09-23T10:00:00+01:00', end: '2026-09-23T11:00:00+01:00' });
    expect(result.success).toBe(false);
    expect(appleCalendarExecutor.execute).not.toHaveBeenCalled();
  });

  it('updates only supplied fields and sends the selected credential and calendar for ownership validation', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { id: '/family/event.ics', title: 'John @ Big Data London', location: 'ExCeL', notes: 'existing notes' }, rowCount: 1 } as never);
    const result = await handleAppleCalendarUpdate({ credentialId: 'cred', calendar: 'Family', eventId: '/family/event.ics', title: 'John @ Big Data London' });
    expect(result).toMatchObject({ success: true, data: { title: 'John @ Big Data London', location: 'ExCeL', notes: 'existing notes' } });
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith({}, expect.objectContaining({
      credentialId: 'cred', calendar: '/family/', operation: 'update', eventId: '/family/event.ics', eventTitle: 'John @ Big Data London',
    }), expect.anything());
    expect(vi.mocked(appleCalendarExecutor.execute).mock.calls[0][1]).not.toHaveProperty('eventLocation');
  });

  it('updates location and notes without clearing other omitted fields', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { id: '/family/event.ics', title: 'Big Data LDN 2026', location: 'ExCeL London', notes: 'Bring badge' }, rowCount: 1 } as never);
    await handleAppleCalendarUpdate({ credentialId: 'cred', calendar: 'Family', eventId: '/family/event.ics', location: 'ExCeL London', notes: 'Bring badge' });
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith({}, expect.objectContaining({ eventLocation: 'ExCeL London', eventNotes: 'Bring badge' }), expect.anything());
    expect(vi.mocked(appleCalendarExecutor.execute).mock.calls[0][1]).not.toHaveProperty('eventTitle');
  });

  it('deletes only after sending the selected calendar for event ownership validation', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { id: '/family/event.ics', title: 'Disposable', deleted: true }, rowCount: 1 } as never);
    await handleAppleCalendarDelete({ credentialId: 'cred', calendar: 'Family', eventId: '/other/event.ics' });
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith({}, expect.objectContaining({ credentialId: 'cred', calendar: '/family/', operation: 'delete', eventId: '/other/event.ics' }), expect.anything());
  });
});

describe('Apple Calendar reads answer in one call', () => {
  const oneCredential = () => vi.mocked(listCredentials).mockResolvedValue([{ id: 'cred', label: 'iCloud', integrationType: 'apple-calendar' }] as never);
  const calendars = [
    { value: '/family/', label: 'Family' },
    { value: '/family-calendar/', label: 'Family Calendar' },
  ];

  it('reads every calendar on the only credential with no arguments at all', async () => {
    oneCredential();
    vi.mocked(resolveOptions_calendar).mockResolvedValue(calendars as never);
    vi.mocked(appleCalendarExecutor.execute).mockImplementation(async (_input, config) => {
      const calendar = (config as { calendar?: string }).calendar;
      return { output: { events: calendar === '/family-calendar/' ? [{ title: 'Date night', start: '2026-08-20T19:00:00Z' }] : [] }, rowCount: 1 };
    });

    const result = await handleAppleCalendarList({});

    // The whole point: the caller named nothing, and still got the answer.
    expect(result.success).toBe(true);
    const data = result.data as { events: Array<Record<string, unknown>>; calendarsRead: string[] };
    expect(data.events).toEqual([{ title: 'Date night', start: '2026-08-20T19:00:00Z', calendar: 'Family Calendar' }]);
    expect(data.calendarsRead).toEqual(['Family', 'Family Calendar']);
    // The empty `Family` calendar is the trap the old ladder fell into — it was
    // read, it just had nothing, and that is now visible rather than fatal.
    expect(appleCalendarExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it('keeps the calendars that answered when one of them fails', async () => {
    oneCredential();
    vi.mocked(resolveOptions_calendar).mockResolvedValue(calendars as never);
    vi.mocked(appleCalendarExecutor.execute).mockImplementation(async (_input, config) => {
      if ((config as { calendar?: string }).calendar === '/family/') throw new Error('timed out');
      return { output: { events: [{ title: 'Swimming', start: '2026-08-18T09:00:00Z' }] }, rowCount: 1 };
    });

    const result = await handleAppleCalendarList({});

    expect(result.success).toBe(true);
    const data = result.data as { events: unknown[]; unavailable: string[] };
    expect(data.events).toHaveLength(1);
    // A partial read that stays silent reads as an empty diary — the exact
    // wrong conclusion, and the one the previous shape kept inviting.
    expect(data.unavailable).toEqual(['Family: timed out']);
  });

  it('fails loudly only when every calendar fails', async () => {
    oneCredential();
    vi.mocked(resolveOptions_calendar).mockResolvedValue(calendars as never);
    vi.mocked(appleCalendarExecutor.execute).mockRejectedValue(new Error('CalDAV down') as never);
    expect(await handleAppleCalendarList({})).toMatchObject({ success: false, error: expect.stringContaining('CalDAV down') });
  });

  it('filters on text across title, notes and attendees', () => {
    const event = { title: 'Dinner', description: 'anniversary', attendees: [{ cn: 'Katie', address: 'k@example.com' }] };
    expect(matchesQuery(event, 'katie')).toBe(true);
    expect(matchesQuery(event, 'ANNIVERSARY')).toBe(true);
    expect(matchesQuery(event, 'dentist')).toBe(false);
    expect(matchesQuery(event, '   ')).toBe(true);
    // Fields are joined on a newline so a query cannot straddle two of them.
    expect(matchesQuery({ title: 'Dinner', location: 'Leeds' }, 'dinner leeds')).toBe(false);
  });

  it('excludes an event with no creation stamp when filtering on provenance', () => {
    const after = new Date('2026-08-13T00:00:00Z');
    expect(matchesProvenance({ created: '2026-08-14T10:00:00Z' }, { createdAfter: after })).toBe(true);
    expect(matchesProvenance({ created: '2026-08-01T10:00:00Z' }, { createdAfter: after })).toBe(false);
    // "Added in the last three days" is a claim about the stamp. An event with
    // no stamp cannot support it, so it must not be reported as newly added.
    expect(matchesProvenance({ title: 'undated' }, { createdAfter: after })).toBe(false);
    expect(matchesProvenance({ title: 'undated' }, {})).toBe(true);
  });

  it('resolves the relative date forms a person actually says', () => {
    const now = new Date('2026-08-16T09:30:00Z');
    expect(resolveRangeBound('today', 'start', now)).toBe('2026-08-16T00:00:00Z');
    expect(resolveRangeBound('today', 'end', now)).toBe('2026-08-16T23:59:59Z');
    expect(resolveRangeBound('tomorrow', 'start', now)).toBe('2026-08-17T00:00:00Z');
    expect(resolveRangeBound('-3d', 'start', now)).toBe('2026-08-13T00:00:00Z');
    expect(resolveRangeBound('+2w', 'end', now)).toBe('2026-08-30T23:59:59Z');
    // A bare date is a whole local day, or an end date drops that day's events.
    expect(resolveRangeBound('2026-08-20', 'end', now)).toBe('2026-08-20T23:59:59Z');
    expect(resolveRangeBound('2026-08-20T18:00:00Z', 'start', now)).toBe('2026-08-20T18:00:00.000Z');
    expect(resolveRangeBound('next tuesday-ish', 'start', now)).toMatchObject({ error: expect.stringMatching(/relative form/i) });
  });

  it('narrows to named calendars, and to an array of them', () => {
    expect(resolveCalendarSelection(calendars, undefined)).toEqual(calendars);
    expect(resolveCalendarSelection(calendars, 'Family Calendar')).toEqual([calendars[1]]);
    expect(resolveCalendarSelection(calendars, ['Family', 'Family Calendar'])).toEqual(calendars);
    // Duplicates collapse rather than reading the same calendar twice.
    expect(resolveCalendarSelection(calendars, ['Family', '/family/'])).toEqual([calendars[0]]);
    expect(resolveCalendarSelection(calendars, 'Nonexistent')).toMatchObject({ error: expect.stringMatching(/was found/i) });
  });

  it('asks which credential only when more than one is configured', async () => {
    vi.mocked(listCredentials).mockResolvedValue([
      { id: 'a', label: 'iCloud personal', integrationType: 'apple-calendar' },
      { id: 'b', label: 'iCloud work', integrationType: 'apple-calendar' },
    ] as never);
    const ambiguous = await resolveAppleCredential(undefined);
    expect(ambiguous).toMatchObject({ error: expect.stringMatching(/more than one/i), credentials: [{ id: 'a' }, { id: 'b' }] });

    vi.mocked(listCredentials).mockResolvedValue([] as never);
    expect(await resolveAppleCredential(undefined)).toMatchObject({ error: expect.stringMatching(/no apple calendar credentials/i) });

    // An explicit id is never second-guessed, and costs no lookup.
    vi.mocked(listCredentials).mockClear();
    expect(await resolveAppleCredential(' cred ')).toEqual({ credentialId: 'cred' });
    expect(listCredentials).not.toHaveBeenCalled();
  });

  it('lets a write skip credential discovery but still name its calendar', async () => {
    oneCredential();
    vi.mocked(resolveOptions_calendar).mockResolvedValue(calendars as never);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { id: 'x' }, rowCount: 1 } as never);
    const result = await handleAppleCalendarCreate({ calendar: 'Family Calendar', title: 'Dinner', start: '2026-08-21T19:00', end: '2026-08-21T21:00' });
    expect(result.success).toBe(true);
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith({}, expect.objectContaining({ credentialId: 'cred', calendar: '/family-calendar/' }), expect.anything());
    // Reads may fan out; a write may not guess which calendar was meant.
    expect(appleCalendarTools.find((t) => t.name === 'apple_calendar_create')?.parameters).toMatchObject({ required: ['calendar', 'title'] });
  });
});
