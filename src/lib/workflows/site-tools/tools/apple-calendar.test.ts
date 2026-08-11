import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/workflows/nodes/apple-calendar', () => ({
  resolveOptions_calendar: vi.fn(),
  appleCalendarExecutor: { execute: vi.fn() },
}));

import { appleCalendarExecutor, resolveOptions_calendar } from '$lib/workflows/nodes/apple-calendar';
import {
  allDayRange,
  appleCalendarTools,
  handleAppleCalendarCreate,
  handleAppleCalendarList,
  resolveCalendar,
  toLondonIcalDateTime,
} from './apple-calendar';

beforeEach(() => vi.clearAllMocks());

describe('Apple Calendar chat tools', () => {
  it('registers direct general-chat read and confirmation-gated write actions', () => {
    expect(appleCalendarTools.map((tool) => tool.name)).toEqual(['apple_calendar_list', 'apple_calendar_create']);
    expect(appleCalendarTools.find((tool) => tool.name === 'apple_calendar_create')?.destructive).toBe(true);
    expect(appleCalendarTools.find((tool) => tool.name === 'apple_calendar_list')?.destructive).not.toBe(true);
  });

  it('resolves the displayed Family calendar only when unambiguous', () => {
    expect(resolveCalendar([{ value: '/family/', label: 'Family' }], 'family')).toEqual({ value: '/family/', label: 'Family' });
    expect(resolveCalendar([{ value: '/a/', label: 'Family' }, { value: '/b/', label: 'Family' }], 'Family')).toMatchObject({ error: expect.stringMatching(/ambiguous/i) });
  });

  it('keeps London time and converts an inclusive two-day all-day range to exclusive DTEND', () => {
    expect(toLondonIcalDateTime('2026-09-23T10:30:00+01:00')).toBe('20260923T103000');
    expect(toLondonIcalDateTime('2026-09-23T10:30')).toBe('20260923T103000');
    expect(allDayRange('2026-09-23', '2026-09-24')).toEqual({
      start: '20260923', end: '20260925', rangeStart: '2026-09-23T00:00:00Z', rangeEnd: '2026-09-25T00:00:00Z',
    });
  });

  it('lists resources before delegating an event read to the workflow executor', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { events: [{ title: 'Lunch' }] }, rowCount: 1 } as never);
    const result = await handleAppleCalendarList({ credentialId: 'cred', calendar: 'Family', dateRangeStart: '2026-09-23T00:00:00Z', dateRangeEnd: '2026-09-24T00:00:00Z' });
    expect(result.success).toBe(true);
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith({}, expect.objectContaining({ operation: 'list', calendar: '/family/' }), {});
  });

  it('delegates a create with a deterministic UID and never accepts credentials as arguments', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([{ value: '/family/', label: 'Family' }]);
    vi.mocked(appleCalendarExecutor.execute).mockResolvedValue({ output: { id: 'event', title: 'Lunch' }, rowCount: 1 } as never);
    const result = await handleAppleCalendarCreate({ credentialId: 'cred', calendar: 'Family', title: 'Lunch', allDayStart: '2026-09-23', allDayEnd: '2026-09-24' });
    expect(result).toMatchObject({ success: true, data: { id: 'event' } });
    expect(appleCalendarExecutor.execute).toHaveBeenCalledWith({}, expect.objectContaining({
      credentialId: 'cred', eventUid: expect.stringMatching(/^jkai-/), allDay: true, eventEnd: '20260925', timezone: 'Europe/London',
    }), {});
  });

  it('does not access CalDAV when the calendar cannot be resolved', async () => {
    vi.mocked(resolveOptions_calendar).mockResolvedValue([]);
    const result = await handleAppleCalendarCreate({ credentialId: 'cred', calendar: 'Family', title: 'Lunch', start: '2026-09-23T10:00:00+01:00', end: '2026-09-23T11:00:00+01:00' });
    expect(result.success).toBe(false);
    expect(appleCalendarExecutor.execute).not.toHaveBeenCalled();
  });
});
