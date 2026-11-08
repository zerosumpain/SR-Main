import { describe, expect, it } from 'vitest';
import { addDays, bookingChecklist } from './booking';
import type { Booking, Facts, Wish } from './model';
import { emptyFacts } from './research';

const facts = (f: Partial<Facts>): Facts => ({ ...emptyFacts('brief', '2026-10-13T00:00:00Z'), ...f });
const wish = (id: string, f: Partial<Facts> | null, extra: Partial<Wish> = {}): Wish => ({
  id,
  title: id,
  place: null,
  priority: 'must',
  durationSec: null,
  partOfDay: 'any',
  fixedDate: null,
  fixedStartMin: null,
  locked: false,
  suggested: false,
  skipped: false,
  facts: f ? facts(f) : null,
  note: null,
  sortHint: 0,
  ...extra,
});

describe('bookingChecklist', () => {
  it('orders by urgency and book-by date, and skips what needs no booking', () => {
    const items = bookingChecklist({
      wishes: [
        wish('vatican', { bookingRequired: true, bookAheadDays: 30, bookingUrl: 'https://tickets.museivaticani.va/' }),
        wish('borghese', { bookingRequired: true, bookAheadDays: 7 }),
        wish('colosseum', { bookingRequired: true, bookAheadDays: 20 }),
        wish('trevi', { bookingRequired: false }),
        wish('suggested', { bookingRequired: true }, { suggested: true }),
        wish('pantheon', { bookingRequired: true }),
      ],
      bookings: [],
      plan: null,
      tripStart: '2026-10-27',
      today: '2026-10-13',
    });
    expect(items.map((i) => i.wishId)).toEqual(['vatican', 'colosseum', 'borghese', 'pantheon']);
    expect(items[0]).toMatchObject({ urgency: 'overdue', bookBy: '2026-09-27', url: 'https://tickets.museivaticani.va/' });
    expect(items[1]).toMatchObject({ urgency: 'overdue', bookBy: addDays('2026-10-27', -20) });
    expect(items[2]).toMatchObject({ urgency: 'now', bookBy: '2026-10-20' });
    expect(items[3]).toMatchObject({ urgency: 'now', bookBy: null });
  });

  it('shows a booked wish last with its reference, and free-standing bookings', () => {
    const bookings: Booking[] = [
      { id: 'b1', wishId: 'v', title: 'Vatican', date: '2026-10-29', startMin: 540, endMin: null, reference: 'AB12', url: null, documentId: null, status: 'booked' },
      { id: 'b2', wishId: null, title: 'Train to Naples', date: null, startMin: null, endMin: null, reference: null, url: null, documentId: null, status: 'to-book' },
    ];
    const items = bookingChecklist({ wishes: [wish('v', { bookingRequired: true, bookAheadDays: 30 })], bookings, plan: null, tripStart: '2026-10-27', today: '2026-10-13' });
    expect(items.map((i) => i.title)).toEqual(['Train to Naples', 'v']);
    expect(items[1]).toMatchObject({ urgency: 'done', why: 'Booked — ref AB12.', visitDate: '2026-10-29' });
  });
});
