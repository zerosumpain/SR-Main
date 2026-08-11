import { describe, expect, it } from 'vitest';
import { parseCalendarObject } from './apple-calendar';

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
  it('reads the fields off a real iCalendar body', () => {
    expect(parseCalendarObject('/e/1.ics', EVENT)).toEqual({
      id: '/e/1.ics',
      title: 'Lunch with Sam',
      location: 'The cafe',
      start: '2026-09-23T09:30:00.000Z',
      end: '2026-09-23T10:30:00.000Z',
      description: 'bring the thing',
    });
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
    expect(bad.parseError).toBeTruthy();
  });

  it('says so when the object holds no event at all', () => {
    const noEvent = parseCalendarObject('/e/5.ics', ics('BEGIN:VTODO', 'UID:t1', 'END:VTODO'));
    expect(noEvent.parseError).toMatch(/no VEVENT/);
  });
});
