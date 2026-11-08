// src/lib/trips/booking.ts
//
// The booking checklist (D5: links, lead times and a checklist — the site
// never books). One row per wish whose facts say it needs booking, or that
// already has a booking row, ordered by how soon it has to be done. PURE.

import type { Booking, LocalDate, SolvedPlan, Wish } from './model';

export type Urgency = 'overdue' | 'now' | 'soon' | 'later' | 'done' | 'unknown';

export interface ChecklistItem {
  wishId: string | null;
  bookingId: string | null;
  title: string;
  /** The planned (or fixed) local date of the visit, when known. */
  visitDate: LocalDate | null;
  /** Book by this local date: the visit minus the lead time. */
  bookBy: LocalDate | null;
  bookAheadDays: number | null;
  required: boolean | null;
  /** Official seller only (facts.bookingUrl, else officialUrl). */
  url: string | null;
  reference: string | null;
  status: Booking['status'] | 'to-book';
  urgency: Urgency;
  /** One line explaining the row. */
  why: string;
}

const RANK: Record<Urgency, number> = { overdue: 0, now: 1, soon: 2, unknown: 3, later: 4, done: 5 };

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(to) - p(from)) / 86_400_000);
}

/** Where each wish is planned, from the latest plan. */
function plannedDates(plan: SolvedPlan | null): Map<string, LocalDate> {
  const out = new Map<string, LocalDate>();
  for (const day of plan?.days ?? []) for (const s of day.stops) if (s.wishId) out.set(s.wishId, day.date);
  return out;
}

export function bookingChecklist(input: {
  wishes: Wish[];
  bookings: Booking[];
  plan: SolvedPlan | null;
  tripStart: LocalDate;
  today: LocalDate;
}): ChecklistItem[] {
  const planned = plannedDates(input.plan);
  const byWish = new Map(input.bookings.filter((b) => b.wishId).map((b) => [b.wishId as string, b]));
  const items: ChecklistItem[] = [];

  for (const w of input.wishes) {
    if (w.suggested || w.skipped) continue;
    const booking = byWish.get(w.id) ?? null;
    const f = w.facts;
    if (!booking && !f?.bookingRequired && !(f?.bookAheadDays && f.bookAheadDays > 0)) continue;
    if (booking?.status === 'cancelled' && !f?.bookingRequired) continue;
    const visitDate = booking?.date ?? w.fixedDate ?? planned.get(w.id) ?? null;
    const lead = f?.bookAheadDays ?? null;
    const anchor = visitDate ?? input.tripStart;
    const bookBy = lead !== null ? addDays(anchor, -lead) : null;
    let urgency: Urgency;
    let why: string;
    if (booking?.status === 'booked') {
      urgency = 'done';
      why = booking.reference ? `Booked — ref ${booking.reference}.` : 'Booked.';
    } else if (!bookBy) {
      urgency = f?.bookingRequired ? 'now' : 'unknown';
      why = f?.bookingRequired ? 'Booking required; lead time unknown — book as soon as you can.' : 'Booking may be needed; lead time unknown.';
    } else {
      const left = daysBetween(input.today, bookBy);
      urgency = left < 0 ? 'overdue' : left <= 7 ? 'now' : left <= 30 ? 'soon' : 'later';
      why =
        left < 0
          ? `Should have been booked by ${bookBy} (${lead} days ahead).`
          : `Book by ${bookBy} — usually sells out ${lead} days ahead.`;
    }
    items.push({
      wishId: w.id,
      bookingId: booking?.id ?? null,
      title: w.title,
      visitDate,
      bookBy,
      bookAheadDays: lead,
      required: f?.bookingRequired ?? null,
      url: booking?.url ?? f?.bookingUrl ?? f?.officialUrl ?? null,
      reference: booking?.reference ?? null,
      status: booking?.status ?? 'to-book',
      urgency,
      why,
    });
  }

  // Bookings not tied to a wish (a train, a tour) are listed too.
  for (const b of input.bookings) {
    if (b.wishId || b.status === 'cancelled') continue;
    items.push({
      wishId: null,
      bookingId: b.id,
      title: b.title,
      visitDate: b.date,
      bookBy: null,
      bookAheadDays: null,
      required: null,
      url: b.url,
      reference: b.reference,
      status: b.status,
      urgency: b.status === 'booked' ? 'done' : 'unknown',
      why: b.status === 'booked' ? (b.reference ? `Booked — ref ${b.reference}.` : 'Booked.') : 'To book.',
    });
  }

  return items.sort(
    (a, b) =>
      RANK[a.urgency] - RANK[b.urgency] ||
      (a.bookBy ?? '9999').localeCompare(b.bookBy ?? '9999') ||
      a.title.localeCompare(b.title) ||
      (a.wishId ?? a.bookingId ?? '').localeCompare(b.wishId ?? b.bookingId ?? ''),
  );
}
