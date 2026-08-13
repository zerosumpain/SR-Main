import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/integrations/credentials', () => ({ getCredential: vi.fn() }));
vi.mock('tsdav', () => ({ default: { createDAVClient: vi.fn() } }));

import { getCredential } from '$lib/integrations/credentials';
import tsdav from 'tsdav';
import { appleCalendarExecutor, parseCalendarObject } from './apple-calendar';

const ics = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...lines, 'END:VCALENDAR'].join('\r\n');

const EVENT = ics(
  'BEGIN:VEVENT',
  'UID:u1',
  'DTSTAMP:20260811T120000Z',
  'DTSTART:20260923T093000Z',
  'DTEND:20260923T103000Z',
  'SUMMARY:Lunch with Sam',
  'LOCATION:The cafe',
  'DESCRIPTION:bring the thing',
  'END:VEVENT',
);

describe('parseCalendarObject', () => {
  // The regression this file exists for. The old code passed `jcal[2]` — the
  // components array — where ICAL.Component wants the whole jCal triple. It
  // threw on every event, and a bare catch turned each throw into a blank row,
  // so the list returned the right NUMBER of events and never a readable one.
  it('preserves the existing event fields and includes the original ICS', () => {
    expect(parseCalendarObject('/e/1.ics', EVENT)).toMatchObject({
      id: '/e/1.ics',
      title: 'Lunch with Sam',
      location: 'The cafe',
      start: '2026-09-23T09:30:00.000Z',
      end: '2026-09-23T10:30:00.000Z',
      description: 'bring the thing',
      uid: 'u1',
      dtstamp: '2026-08-11T12:00:00Z',
      rawIcs: EVENT,
    });
  });

  it('returns provenance and Apple extension properties from a manually-created event', () => {
    const manual = ics(
      'BEGIN:VEVENT',
      'UID:manual-1',
      'DTSTAMP:20260811T120000Z',
      'CREATED:20260801T090000Z',
      'LAST-MODIFIED:20260810T110000Z',
      'SEQUENCE:3',
      'STATUS:CONFIRMED',
      'DTSTART:20260923T093000Z',
      'DTEND:20260923T103000Z',
      'SUMMARY:School run',
      'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
      'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=School:geo:51.5,-0.1',
      'END:VEVENT',
    );
    expect(parseCalendarObject('/e/manual.ics', manual)).toMatchObject({
      title: 'School run', uid: 'manual-1', created: '2026-08-01T09:00:00Z', lastModified: '2026-08-10T11:00:00Z',
      dtstamp: '2026-08-11T12:00:00Z', sequence: '3', status: 'CONFIRMED', rawIcs: manual,
      rawProperties: [
        { name: 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR', value: 'AUTOMATIC' },
        { name: 'X-APPLE-STRUCTURED-LOCATION', value: 'geo:51.5,-0.1', parameters: { 'X-ADDRESS': 'School' } },
      ],
    });
  });

  it('returns meeting organizer and attendee parameters for an invite', () => {
    const invite = ics(
      'BEGIN:VEVENT',
      'UID:invite-1',
      'DTSTAMP:20260811T120000Z',
      'DTSTART:20260923T093000Z',
      'DTEND:20260923T103000Z',
      'SUMMARY:Planning',
      'ORGANIZER;CN=Alex Smith:mailto:alex@example.test',
      'ATTENDEE;CN=Sam Jones;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:sam@example.test',
      'ATTENDEE;CN=Pat Lee;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:mailto:pat@example.test',
      'END:VEVENT',
    );
    expect(parseCalendarObject('/e/invite.ics', invite)).toMatchObject({
      organizer: { cn: 'Alex Smith', address: 'mailto:alex@example.test' },
      attendees: [
        { cn: 'Sam Jones', address: 'mailto:sam@example.test', partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' },
        { cn: 'Pat Lee', address: 'mailto:pat@example.test', partstat: 'TENTATIVE', role: 'OPT-PARTICIPANT' },
      ],
    });
  });

  it('omits unavailable provenance fields from a minimal event', () => {
    const minimal = ics('BEGIN:VEVENT', 'DTSTART:20260923T093000Z', 'DTEND:20260923T103000Z', 'SUMMARY:Minimal', 'END:VEVENT');
    const parsed = parseCalendarObject('/e/minimal.ics', minimal);
    expect(parsed).toMatchObject({ title: 'Minimal', rawIcs: minimal });
    expect(parsed).not.toHaveProperty('uid');
    expect(parsed).not.toHaveProperty('organizer');
    expect(parsed).not.toHaveProperty('attendees');
    expect(parsed).not.toHaveProperty('rawProperties');
  });

  it('finds the event past a VTIMEZONE sibling', () => {
    // iCloud returns these on zoned events; getFirstSubcomponent('vevent')
    // must skip them rather than take whatever comes first.
    const withTz = ics(
      'BEGIN:VTIMEZONE',
      'TZID:Europe/London',
      'BEGIN:STANDARD',
      'DTSTART:19710101T020000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0000',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:u2',
      'DTSTAMP:20260811T120000Z',
      'DTSTART:20260923T093000Z',
      'DTEND:20260923T103000Z',
      'SUMMARY:Zoned',
      'END:VEVENT',
    );
    expect(parseCalendarObject('/e/2.ics', withTz).title).toBe('Zoned');
  });

  it('handles an all-day event, whose dates carry no time', () => {
    const allDay = ics(
      'BEGIN:VEVENT',
      'UID:u3',
      'DTSTAMP:20260811T120000Z',
      'DTSTART;VALUE=DATE:20260923',
      'DTEND;VALUE=DATE:20260925',
      'SUMMARY:Away',
      'END:VEVENT',
    );
    const parsed = parseCalendarObject('/e/3.ics', allDay);
    expect(parsed.title).toBe('Away');
    expect(parsed.start).toMatch(/^2026-09-23/);
  });

  // A blank row that claims to be an event is worse than one that admits it
  // could not be read — that is precisely how the original bug stayed hidden.
  it('says so when the body cannot be read, instead of returning a nameless event', () => {
    const bad = parseCalendarObject('/e/4.ics', 'this is not iCalendar');
    expect(bad.id).toBe('/e/4.ics');
    expect(bad.title).toBe('');
    expect(bad.rawIcs).toBe('this is not iCalendar');
    expect(bad.parseError).toBeTruthy();
  });

  it('says so when the object holds no event at all', () => {
    const data = ics('BEGIN:VTODO', 'UID:t1', 'END:VTODO');
    const noEvent = parseCalendarObject('/e/5.ics', data);
    expect(noEvent.rawIcs).toBe(data);
    expect(noEvent.parseError).toMatch(/no VEVENT/);
  });
});

describe('Apple Calendar event mutations', () => {
  const family = { url: '/family/', displayName: 'Family' };
  const work = { url: '/work/', displayName: 'Work' };
  const events = new Map<string, { url: string; etag: string; data: string }[]>();
  const client = {
    fetchCalendars: vi.fn(async () => [family, work]),
    fetchCalendarObjects: vi.fn(async ({ calendar }: { calendar: { url: string } }) => events.get(calendar.url) ?? []),
    createCalendarObject: vi.fn(async ({ calendar, filename, iCalString }) => {
      const url = `${calendar.url}${filename}`;
      events.set(calendar.url, [...(events.get(calendar.url) ?? []), { url, etag: 'one', data: iCalString }]);
      return { headers: new Headers({ Location: url }) };
    }),
    updateCalendarObject: vi.fn(async ({ calendarObject }: { calendarObject: { url: string; data: string } }) => {
      for (const [calendar, objects] of events) {
        const index = objects.findIndex((object) => object.url === calendarObject.url);
        if (index >= 0) events.set(calendar, objects.with(index, { ...objects[index], data: calendarObject.data, etag: 'two' }));
      }
    }),
    deleteCalendarObject: vi.fn(async ({ calendarObject }: { calendarObject: { url: string } }) => {
      for (const [calendar, objects] of events) events.set(calendar, objects.filter((object) => object.url !== calendarObject.url));
    }),
  };

  beforeEach(() => {
    events.clear();
    vi.clearAllMocks();
    vi.mocked(getCredential).mockResolvedValue({ kind: 'basic', payload: { username: 'user', password: 'secret' } } as never);
    vi.mocked(tsdav.createDAVClient).mockResolvedValue(client as never);
  });

  it('creates, updates, lists, and deletes an event while preserving omitted fields', async () => {
    const created = await appleCalendarExecutor.execute({}, {
      credentialId: 'cred', operation: 'create', calendar: family.url, eventUid: 'disposable', eventTitle: 'Big Data LDN 2026',
      eventStart: '20260923T093000Z', eventEnd: '20260923T103000Z', eventLocation: 'ExCeL', eventNotes: 'Bring badge',
    }, {} as never);
    const eventId = (created.output as { url: string }).url;

    const renamed = await appleCalendarExecutor.execute({}, {
      credentialId: 'cred', operation: 'update', calendar: family.url, eventId, eventTitle: 'John @ Big Data London',
    }, {} as never);
    expect(renamed.output).toMatchObject({ title: 'John @ Big Data London', location: 'ExCeL', notes: 'Bring badge' });

    const updated = await appleCalendarExecutor.execute({}, {
      credentialId: 'cred', operation: 'update', calendar: family.url, eventId, eventLocation: 'ExCeL London', eventNotes: 'Reception at 9',
    }, {} as never);
    expect(updated.output).toMatchObject({ title: 'John @ Big Data London', location: 'ExCeL London', notes: 'Reception at 9' });

    const dated = await appleCalendarExecutor.execute({}, {
      credentialId: 'cred', operation: 'update', calendar: family.url, eventId, allDay: true, eventStart: '20260924', eventEnd: '20260926',
    }, {} as never);
    expect(dated.output).toMatchObject({ title: 'John @ Big Data London', start: expect.stringMatching(/^2026-09-24/), end: expect.stringMatching(/^2026-09-26/) });

    const listed = await appleCalendarExecutor.execute({}, {
      credentialId: 'cred', operation: 'list', calendar: family.url, dateRangeStart: '2026-09-23T00:00:00Z', dateRangeEnd: '2026-09-24T00:00:00Z',
    }, {} as never);
    expect((listed.output as { events: Array<{ title: string }> }).events).toEqual([expect.objectContaining({ title: 'John @ Big Data London' })]);

    const deleted = await appleCalendarExecutor.execute({}, { credentialId: 'cred', operation: 'delete', calendar: family.url, eventId }, {} as never);
    expect(deleted.output).toMatchObject({ id: eventId, title: 'John @ Big Data London', deleted: true });
    const afterDelete = await appleCalendarExecutor.execute({}, {
      credentialId: 'cred', operation: 'list', calendar: family.url, dateRangeStart: '2026-09-23T00:00:00Z', dateRangeEnd: '2026-09-24T00:00:00Z',
    }, {} as never);
    expect((afterDelete.output as { events: unknown[] }).events).toEqual([]);
  });

  it('rejects update and delete IDs outside the selected calendar', async () => {
    events.set(work.url, [{ url: '/work/event.ics', etag: 'one', data: EVENT }]);
    const config = { credentialId: 'cred', calendar: family.url, eventId: '/work/event.ics' };
    await expect(appleCalendarExecutor.execute({}, { ...config, operation: 'update', eventTitle: 'Nope' }, {} as never)).rejects.toThrow(/selected calendar/i);
    await expect(appleCalendarExecutor.execute({}, { ...config, operation: 'delete' }, {} as never)).rejects.toThrow(/selected calendar/i);
    expect(client.updateCalendarObject).not.toHaveBeenCalled();
    expect(client.deleteCalendarObject).not.toHaveBeenCalled();
  });
});
