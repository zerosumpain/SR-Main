// src/lib/daydream/calendar/read.ts
//
// The one place daydreaming reads the diary.
//
// It used to be three: `snapshot.ts` for today, `features/calendar.ts` for the
// feature store, `ponder/run.ts` for the week ahead. Each called
// `apple_calendar_list` and mapped the rows its own way, which was harmless
// while nothing filtered — and stops being harmless the moment the owner can
// hide an event. Three readers means three chances to forget the filter, and
// the failure is silent: the engine simply carries on reasoning about a
// commitment it was told to ignore.
//
// So there is one reader now. Exclusions are applied HERE, once, and the
// hidden count comes back with the events so a filtered diary can never pass
// for an empty one.

import { ExclusionSet, NO_EXCLUSIONS } from './exclusions';

/** One occurrence, with the fields the tool actually returns. */
export interface RawCalendarEvent {
  /** CalDAV resource URL. Shared by every occurrence of a recurring event. */
  id: string | null;
  /** iCalendar UID — the series identity, and what a series exclusion keys on. */
  uid: string | null;
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  calendar: string | null;
}

export interface CalendarRead {
  /** What the engine is allowed to see. */
  events: RawCalendarEvent[];
  /** What an exclusion hid, and which rule hid it. Never fed to a detector or
   *  a prompt; it exists so the page can show what is being ignored. */
  hidden: Array<RawCalendarEvent & { hiddenBy: string }>;
  /** The tool hit its merge cap; counts derived from this are a floor. */
  truncated: boolean;
  /** At least one calendar could not be read. A partial diary must never be
   *  treated as an empty one — that is how "your afternoon is free" gets said
   *  over the top of a meeting. */
  partial: boolean;
  available: boolean;
  error: string | null;
}

const EMPTY: CalendarRead = {
  events: [],
  hidden: [],
  truncated: false,
  partial: false,
  available: false,
  error: null,
};

/** Map one tool row, dropping anything without a usable start. */
export function toRawEvent(e: unknown): RawCalendarEvent | null {
  const ev = e as Record<string, unknown>;
  const start = typeof ev.start === 'string' ? ev.start : '';
  if (!start || Number.isNaN(Date.parse(start))) return null;
  return {
    id: typeof ev.id === 'string' ? ev.id : null,
    uid: typeof ev.uid === 'string' ? ev.uid : null,
    title: typeof ev.title === 'string' && ev.title.trim() ? ev.title : '(untitled)',
    start,
    end: typeof ev.end === 'string' ? ev.end : null,
    location: typeof ev.location === 'string' ? ev.location : null,
    calendar: typeof ev.calendar === 'string' ? ev.calendar : null,
  };
}

/**
 * Read a window of the diary, with the owner's exclusions applied.
 *
 * `exclusions` is passed in rather than loaded here so the callers that read
 * in a loop — the feature store walks 250 days in chunks — load the rule set
 * once instead of once per chunk.
 */
export async function readCalendar(
  args: { dateRangeStart: string; dateRangeEnd: string },
  exclusions: ExclusionSet = NO_EXCLUSIONS,
): Promise<CalendarRead> {
  try {
    // Dynamically imported for the reason snapshot.ts already documents: a
    // static import of the registry boots platform services — WhatsApp
    // included — in any test that touches this module.
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const res = await executeTool('apple_calendar_list', args);
    const data = res?.data as
      | { events?: unknown[]; truncated?: unknown; unavailable?: unknown[] }
      | undefined;
    if (!res?.success || !data) {
      return { ...EMPTY, error: res?.error ? String(res.error) : 'calendar read failed' };
    }

    const all = (Array.isArray(data.events) ? data.events : [])
      .map(toRawEvent)
      .filter((e): e is RawCalendarEvent => e !== null);

    const events: RawCalendarEvent[] = [];
    const hidden: Array<RawCalendarEvent & { hiddenBy: string }> = [];
    for (const e of all) {
      const by = exclusions.reasonFor(e);
      if (by) hidden.push({ ...e, hiddenBy: by });
      else events.push(e);
    }

    return {
      events,
      hidden,
      truncated: data.truncated === true,
      partial: Array.isArray(data.unavailable) && data.unavailable.length > 0,
      available: true,
      error: null,
    };
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) };
  }
}
