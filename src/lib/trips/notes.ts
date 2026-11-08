// src/lib/trips/notes.ts
//
// v8: "From your notes" — what the owner's memory already holds about a trip
// being started (the flights, the Airbnb, a booked tour), offered for a
// one-tap confirm instead of a question. The pure half: which notes are worth
// reading, what the reader is asked, and how its answer becomes `NoteFact`s.
//
// The privacy rule (v5, kept in v8): no memory text on the phone wire, for
// anyone. So a NoteFact's `label` and `detail` are BUILT from the extracted
// trip facts — carrier, flight number, airports, times, the area, the dates —
// never a sentence from memory; its `ops` are ready to apply (each marked
// `source: 'notes'`); its `ref` (the memory id) is for the owner's site only.
// PURE.

import { dayLabel } from './changes';
import type { NoteFact } from './decisions';
import type { LocalDate, TripOp } from './model';
import { addDays, datesBetween, dayNumber } from './solver/calendar';

export interface NoteRow {
  id: string;
  text: string;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const BOOKING = /\b(flight|flights|fly|flying|airline|depart|arriv|hotel|airbnb|apartment|stay|booking|booked|reservation|confirmation|check-?in|ticket|tickets|tour|train|eurostar|ryanair|easyjet|jet2|ba\b|british airways|wizz|vueling|ita airways)|\b[a-z][a-z0-9]\s?\d{3,4}\b/i;

/** The ways a note may write one of the trip's dates. */
function dateForms(d: LocalDate): string[] {
  const [y, m, dd] = d.split('-').map(Number);
  const mon = MONTHS[m - 1];
  const ord = dd % 10 === 1 && dd !== 11 ? 'st' : dd % 10 === 2 && dd !== 12 ? 'nd' : dd % 10 === 3 && dd !== 13 ? 'rd' : 'th';
  return [d, `${dd} ${mon}`, `${dd} ${mon.slice(0, 3)}`, `${mon} ${dd}`, `${mon.slice(0, 3)} ${dd}`, `${String(dd).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`, `${dd}/${m}/${y}`, `${dd}${ord} ${mon}`];
}

/**
 * The notes worth reading: those that name the destination, and those that
 * name one of the trip's dates (± 2 days) alongside a booking word. At most
 * `limit`, the destination's first.
 */
export function relevantRows(rows: NoteRow[], q: { destination: string; startDate: LocalDate; endDate: LocalDate }, limit = 25): NoteRow[] {
  const place = q.destination.split(',')[0].trim().toLowerCase();
  const forms = datesBetween(addDays(q.startDate, -2), addDays(q.endDate, 2)).flatMap(dateForms);
  const named: NoteRow[] = [];
  const dated: NoteRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const t = r.text.toLowerCase();
    if (place.length >= 3 && t.includes(place)) named.push(r);
    else if (BOOKING.test(t) && forms.some((f) => t.includes(f))) dated.push(r);
  }
  return [...named, ...dated].slice(0, limit);
}

export const NOTES_SYSTEM = `You read a traveller's own notes and pull out the BOOKINGS for one trip: flights (or trains), where they are staying, and tours or tickets booked for a time.
Only what the notes actually say — never a guess. Dates as YYYY-MM-DD, times as HH:MM (24-hour, local to that place). "ref" is the id of the note it came from.
Answer ONLY with JSON:
{"flights": [{"kind": "flight"|"train", "direction": "outbound"|"return"|"internal", "carrier": string|null, "number": string|null, "from": {"name": string, "code": string|null, "timeZone": IANA zone|null}, "to": {"name": string, "code": string|null, "timeZone": IANA zone|null}, "departDate", "departTime", "arriveDate", "arriveTime", "bookingRef": string|null, "ref"}],
 "stays": [{"name": string (e.g. "Airbnb", "Hotel Raphael"), "area": the neighbourhood or nearby landmark|null, "address": string|null, "fromDate": first night, "toDate": the morning they leave, "checkInTime": string|null, "ref"}],
 "tours": [{"title": string, "place": string|null, "date", "startTime", "endTime": string|null, "reference": string|null, "ref"}]}
Empty lists when the notes hold nothing for this trip.`;

export function notesPrompt(q: { destination: string; startDate: LocalDate; endDate: LocalDate }, rows: NoteRow[]): string {
  return [`Trip: ${q.destination}, ${q.startDate} to ${q.endDate}.`, '', 'Notes:', ...rows.map((r) => `[${r.id}] ${r.text.replace(/\s+/g, ' ').slice(0, 600)}`)].join('\n');
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const isDate = (v: unknown): v is LocalDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
function minutes(v: unknown): number | null {
  const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? n : null;
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const within = (d: LocalDate, q: { startDate: LocalDate; endDate: LocalDate }, slack: number) => dayNumber(d) >= dayNumber(q.startDate) - slack && dayNumber(d) <= dayNumber(q.endDate) + slack;

/** A short, stable id from what the fact says (the same flight read twice is the same NoteFact). */
export function noteId(kind: NoteFact['kind'], key: string): string {
  let h = 0x811c9dc5;
  for (const c of key.toLowerCase()) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `note:${kind}:${h.toString(36)}`;
}

/** "Fri 30 Oct" → "Fri 30 Oct"; "26 Oct – 30 Oct" spans compactly. */
function span(from: LocalDate, to: LocalDate): string {
  const a = dayLabel(from).split(' ');
  const b = dayLabel(to).split(' ');
  return a[2] === b[2] ? `${a[1]}–${b[1]} ${b[2]}` : `${a[1]} ${a[2]} – ${b[1]} ${b[2]}`;
}

/**
 * The reader's answer → NoteFacts. Every label and detail is assembled from
 * the extracted fields; anything without the fields it needs, or outside the
 * trip's dates, is dropped. `ref` is the note's id when it was one of `ids`.
 */
export function readNoteFacts(raw: unknown, q: { destination: string; startDate: LocalDate; endDate: LocalDate }, ids: Set<string>): NoteFact[] {
  const r = isObj(raw) ? raw : {};
  const out: NoteFact[] = [];
  const refOf = (v: unknown) => (typeof v === 'string' && ids.has(v) ? v : null);
  for (const f of (Array.isArray(r.flights) ? r.flights : []).filter(isObj)) {
    const from = isObj(f.from) ? f.from : {};
    const to = isObj(f.to) ? f.to : {};
    const fromName = text(from.name, 80);
    const toName = text(to.name, 80);
    const dm = minutes(f.departTime);
    const am = minutes(f.arriveTime);
    if (!fromName || !toName || !isDate(f.departDate) || dm === null || am === null || !within(f.departDate, q, 2)) continue;
    const arriveDate = isDate(f.arriveDate) && f.arriveDate >= f.departDate ? f.arriveDate : f.departDate;
    const code = (v: unknown) => {
      const c = text(v, 4)?.toUpperCase() ?? null;
      return c && /^[A-Z]{3,4}$/.test(c) ? c : null;
    };
    const fromCode = code(from.code);
    const toCode = code(to.code);
    const number = text(f.number, 10)?.replace(/\s+/g, '').toUpperCase() ?? null;
    const carrier = text(f.carrier, 40);
    const kind = f.kind === 'train' ? 'train' : 'flight';
    const direction = f.direction === 'return' || f.direction === 'internal' ? f.direction : 'outbound';
    const zone = (v: unknown) => (typeof v === 'string' && /^[A-Za-z]+\/[A-Za-z_\-/]+$/.test(v) ? v : null);
    const label = `${kind === 'train' ? 'Train' : 'Flight'}${number ? ` ${number}` : carrier ? ` ${carrier}` : ''} ${fromCode ?? fromName} ${hhmm(dm)} → ${toCode ?? toName}`;
    const detail = `${dayLabel(f.departDate)}, ${kind === 'train' ? 'arrives' : 'lands'} ${hhmm(am)}${arriveDate !== f.departDate ? ` on ${dayLabel(arriveDate)}` : ''}${carrier && number ? ` · ${carrier}` : ''}`;
    const segment = {
      kind,
      direction,
      carrier,
      number,
      from: { name: fromName, code: fromCode, timeZone: zone(from.timeZone) },
      to: { name: toName, code: toCode, timeZone: zone(to.timeZone) },
      departDate: f.departDate,
      departMin: dm,
      arriveDate,
      arriveMin: am,
      confidence: 'stated',
      bookingRef: text(f.bookingRef, 40),
      sources: [],
    };
    out.push({ id: noteId('transport', `${f.departDate}|${hhmm(dm)}|${fromCode ?? fromName}|${toCode ?? toName}`), kind: 'transport', label, detail, ops: [{ op: 'addTransport', segment, source: 'notes' } as unknown as TripOp], ref: refOf(f.ref) });
  }
  for (const s of (Array.isArray(r.stays) ? r.stays : []).filter(isObj)) {
    const name = text(s.name, 80);
    if (!name || !isDate(s.fromDate) || !isDate(s.toDate) || s.toDate <= s.fromDate || !within(s.fromDate, q, 1)) continue;
    const area = text(s.area, 80);
    const address = text(s.address, 160);
    const nights = dayNumber(s.toDate) - dayNumber(s.fromDate);
    const fromDate = s.fromDate < q.startDate ? q.startDate : s.fromDate;
    const toDate = s.toDate > addDays(q.endDate, 1) ? addDays(q.endDate, 1) : s.toDate;
    out.push({
      id: noteId('stay', `${name}|${s.fromDate}|${s.toDate}`),
      kind: 'stay',
      label: `${name}${area ? ` in ${area}` : ''}`,
      detail: `${span(s.fromDate, s.toDate)}, ${nights} ${nights === 1 ? 'night' : 'nights'}`,
      ops: [{ op: 'addStay', name: area ? `${name}, ${area}` : name, placeQuery: address ?? `${area ?? name}, ${q.destination}`, fromDate, toDate, checkInMin: minutes(s.checkInTime), checkOutMin: null, source: 'notes' } as unknown as TripOp],
      ref: refOf(s.ref),
    });
  }
  for (const t of (Array.isArray(r.tours) ? r.tours : []).filter(isObj)) {
    const title = text(t.title, 100);
    const start = minutes(t.startTime);
    if (!title || !isDate(t.date) || start === null || !within(t.date, q, 0)) continue;
    const end = minutes(t.endTime);
    const place = text(t.place, 120);
    out.push({
      id: noteId('booking', `${title}|${t.date}|${hhmm(start)}`),
      kind: 'booking',
      label: `${title}, ${dayLabel(t.date)} ${hhmm(start)}`,
      detail: place,
      ops: [
        { op: 'addWish', wish: { title, placeQuery: place ? `${place}, ${q.destination}` : `${title}, ${q.destination}`, priority: 'must', durationMin: end !== null && end > start ? end - start : null, partOfDay: 'any', fixedDate: t.date, fixedStartMin: start, note: null, replacesMeal: null }, source: 'notes' } as unknown as TripOp,
        { op: 'addBooking', booking: { wishId: null, title, date: t.date, startMin: start, endMin: end !== null && end > start ? end : null, reference: text(t.reference, 60), url: null, documentId: null, status: 'booked' }, source: 'notes' } as unknown as TripOp,
      ],
      ref: refOf(t.ref),
    });
  }
  return out.filter((n, i) => out.findIndex((m) => m.id === n.id) === i);
}

/** For the phone: the same facts, no memory reference (labels never held memory text). */
export const phoneNotes = (notes: NoteFact[]): NoteFact[] => notes.map((n) => ({ ...n, ref: null }));
