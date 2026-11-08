import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noteId, readNoteFacts, relevantRows } from './notes';

// From your notes: owner only, one reader call, labels built from trip facts.
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('./llm.server', () => ({ jsonCall: vi.fn(async () => { throw new Error('no model'); }) }));

const { noteFacts, confirmedNotes, readNotesQuery, clearNotesCacheForTest } = await import('./notes.server');

const Q = { destination: 'Rome', startDate: '2026-10-26', endDate: '2026-10-30' };
const MEMORY = [
  { id: 'm790', text: 'Booked Jet2 LS1235 Newcastle to Rome Fiumicino 26 Oct, 07:35, lands 11:30 — ref ABC123, seats 14A-D' },
  { id: 'm791', text: 'Return LS1236 FCO to NCL on 30 October at 12:10' },
  { id: 'm812', text: 'Airbnb for Rome: Via del Governo Vecchio 69, host Maria, door code 4421, 26–30 Oct' },
  { id: 'm900', text: 'Vatican Museums early tour booked 28 Oct 08:15' },
  { id: 'm999', text: 'Likes strong coffee' },
];
const ANSWER = {
  flights: [
    { kind: 'flight', direction: 'outbound', carrier: 'Jet2', number: 'LS 1235', from: { name: 'Newcastle', code: 'ncl', timeZone: 'Europe/London' }, to: { name: 'Rome Fiumicino', code: 'FCO', timeZone: 'Europe/Rome' }, departDate: '2026-10-26', departTime: '07:35', arriveDate: '2026-10-26', arriveTime: '11:30', bookingRef: 'ABC123', ref: 'm790' },
    { kind: 'flight', direction: 'return', carrier: 'Jet2', number: 'LS1236', from: { name: 'Rome Fiumicino', code: 'FCO' }, to: { name: 'Newcastle', code: 'NCL' }, departDate: '2026-10-30', departTime: '12:10', arriveDate: '2026-10-30', arriveTime: '14:05', ref: 'm791' },
    { from: { name: 'X' }, to: { name: 'Y' }, departDate: '2027-01-01', departTime: '10:00', arriveTime: '11:00', ref: 'm790' },
  ],
  stays: [{ name: 'Airbnb', area: 'Parione', address: 'Via del Governo Vecchio 69, Rome', fromDate: '2026-10-26', toDate: '2026-10-30', checkInTime: '15:00', ref: 'm812' }],
  tours: [{ title: 'Vatican Museums early tour', place: 'Vatican Museums', date: '2026-10-28', startTime: '08:15', endTime: '11:15', reference: null, ref: 'made-up' }],
};

describe('reading the notes', () => {
  it('reads the notes that name the place, or a trip date beside a booking word', () => {
    const rows = relevantRows([...MEMORY, { id: 'x', text: 'Dentist on 27 Oct' }, { id: 'y', text: 'Flight to Oslo booked 28 October' }], Q);
    expect(rows.map((r) => r.id)).toEqual(['m790', 'm812', 'm791', 'm900', 'y']);
  });

  it('labels are built from the facts, never a note’s words; ops are ready to apply', () => {
    const facts = readNoteFacts(ANSWER, Q, new Set(MEMORY.map((m) => m.id)));
    expect(facts.map((f) => [f.kind, f.label, f.detail, f.ref])).toEqual([
      ['transport', 'Flight LS1235 NCL 07:35 → FCO', 'Mon 26 Oct, lands 11:30 · Jet2', 'm790'],
      ['transport', 'Flight LS1236 FCO 12:10 → NCL', 'Fri 30 Oct, lands 14:05 · Jet2', 'm791'],
      ['stay', 'Airbnb in Parione', '26–30 Oct, 4 nights', 'm812'],
      ['booking', 'Vatican Museums early tour, Wed 28 Oct 08:15', 'Vatican Museums', null],
    ]);
    // What else the notes say (the host, the door code, seats, references) never reaches a label.
    const all = JSON.stringify(facts.map((f) => [f.label, f.detail]));
    for (const secret of ['Maria', '4421', '14A', 'ABC123', 'Via del Governo', 'Booked', 'host']) expect(all).not.toContain(secret);
    for (const m of MEMORY) expect(all).not.toContain(m.text);
    expect(facts[0].ops).toEqual([{ op: 'addTransport', source: 'notes', segment: expect.objectContaining({ kind: 'flight', direction: 'outbound', number: 'LS1235', confidence: 'stated', departMin: 455, arriveMin: 690, from: { name: 'Newcastle', code: 'NCL', timeZone: 'Europe/London' } }) }]);
    expect(facts[2].ops).toEqual([{ op: 'addStay', source: 'notes', name: 'Airbnb, Parione', placeQuery: 'Via del Governo Vecchio 69, Rome', fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: 900, checkOutMin: null }]);
    expect(facts[3].ops.map((o) => o.op)).toEqual(['addWish', 'addBooking']);
    expect(facts[3].ops[0]).toMatchObject({ wish: { fixedDate: '2026-10-28', fixedStartMin: 495, priority: 'must', durationMin: 180 } });
    expect(facts[3].ops[1]).toMatchObject({ booking: { status: 'booked', date: '2026-10-28', startMin: 495, endMin: 675 } });
    // The same flight read twice is the same fact.
    expect(readNoteFacts(ANSWER, Q, new Set())[0].id).toBe(facts[0].id);
    expect(noteId('stay', 'a')).toMatch(/^note:stay:[a-z0-9]+$/);
  });
});

describe('noteFacts', () => {
  const deps = (over: Record<string, unknown> = {}) => {
    const calls = { model: 0, rows: [] as string[][] };
    return {
      calls,
      d: {
        rows: async (queries: string[]) => {
          calls.rows.push(queries);
          return MEMORY;
        },
        model: async () => {
          calls.model++;
          return ANSWER;
        },
        now: () => 1_000,
        ...over,
      },
    };
  };
  beforeEach(() => clearNotesCacheForTest());

  it('owner only; anyone else gets nothing and no memory is read', async () => {
    const { d, calls } = deps();
    expect(await noteFacts({ email: 'kid@example.test', isOwner: false }, Q, { surface: 'phone', deps: d })).toEqual([]);
    expect(await noteFacts({ email: 'parent@example.test', isOwner: true }, Q, { surface: 'phone', deps: d })).toEqual([]);
    expect(calls.rows).toEqual([]);
  });

  it('the phone gets the same facts with no memory reference', async () => {
    const { d, calls } = deps();
    const site = await noteFacts({ email: 'owner@example.test', isOwner: true }, Q, { surface: 'site', deps: d });
    const phone = await noteFacts({ email: 'owner@example.test', isOwner: true }, Q, { surface: 'phone', deps: d });
    expect(site[0].ref).toBe('m790');
    expect(phone.every((n) => n.ref === null)).toBe(true);
    expect(phone.map((n) => n.label)).toEqual(site.map((n) => n.label));
    // One reader call for both (an hour's cache), so the start can confirm by id.
    expect(calls.model).toBe(1);
    expect(calls.rows[0]).toContain('Rome flight');
    const confirmed = await confirmedNotes({ email: 'owner@example.test', isOwner: true }, Q, [site[2].id], d);
    expect(confirmed.map((n) => n.kind)).toEqual(['stay']);
    expect(calls.model).toBe(1);
  });

  it('nothing relevant in memory: no model call', async () => {
    const { d, calls } = deps({ rows: async () => [{ id: 'm1', text: 'Likes strong coffee' }] });
    expect(await noteFacts({ email: 'owner@example.test', isOwner: true }, Q, { surface: 'site', deps: d })).toEqual([]);
    expect(calls.model).toBe(0);
  });

  it('the query must be a trip', () => {
    expect(readNotesQuery(new URLSearchParams('destination=Rome&startDate=2026-10-26&endDate=2026-10-30'))).toEqual(Q);
    expect(readNotesQuery(new URLSearchParams('destination=Rome&startDate=2026-10-30&endDate=2026-10-26'))).toBeNull();
    expect(readNotesQuery(new URLSearchParams('destination=&startDate=2026-10-26&endDate=2026-10-30'))).toBeNull();
    expect(readNotesQuery(new URLSearchParams('destination=Rome&startDate=2026-10-01&endDate=2026-12-30'))).toBeNull();
  });
});
