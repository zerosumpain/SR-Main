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
  resolveCalendar,
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

  it('safely discovers configured credential ids and labels before CalDAV access', async () => {
    vi.mocked(listCredentials).mockResolvedValue([{ id: 'cred', label: 'iCloud', integrationType: 'apple-calendar' }] as never);
    const result = await handleAppleCalendarList({});
    expect(result).toEqual({ success: true, data: { credentials: [{ id: 'cred', label: 'iCloud', integrationType: 'apple-calendar' }] } });
    expect(resolveOptions_calendar).not.toHaveBeenCalled();
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
