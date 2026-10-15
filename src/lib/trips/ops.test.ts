import { describe, expect, it } from 'vitest';
import type { Booking, Stay, Trip, Wish } from './model';
import { applyOps, describeOp, knownUrlOrNull, knownUrlsOf, MAX_OPS, readPlannerAnswer, urlsIn, type OpContext, type OpEffects } from './ops';
import { emptyFacts } from './research';

const TRIP: Trip = {
  id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome',
  startDate: '2026-10-27', endDate: '2026-10-30', pace: 'normal', modes: ['walk'], status: 'draft', notes: null,
};
const STAY: Stay = { id: 's1', name: 'Flat', address: null, location: { lat: 41.895, lng: 12.4716 }, fromDate: '2026-10-27', toDate: '2026-10-31', checkInMin: 900, checkOutMin: 600 };
const wish = (id: string, title: string, extra: Partial<Wish> = {}): Wish => ({
  id, title, place: { name: title, location: { lat: 41.9, lng: 12.48 }, osmId: null, address: null }, priority: 'nice', durationSec: null,
  partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0, ...extra,
});

/** Effects that record what they were asked to do, with a tiny place index. */
function fakes(places: Record<string, { lat: number; lng: number }> = { 'Pantheon, Rome': { lat: 41.8986, lng: 12.4769 }, "Via dei Cappellari 10, Rome": { lat: 41.8953, lng: 12.4706 } }) {
  const calls: string[] = [];
  let n = 0;
  const fx: OpEffects = {
    resolvePlace: async (q) => (places[q] ? { name: q.split(',')[0], location: places[q], osmId: 'node/1', address: q } : null),
    setTrip: async (f) => void calls.push(`setTrip:${f.destination}:${f.startDate}`),
    addStay: async (s) => {
      calls.push(`addStay:${s.name}`);
      return { id: `stay${++n}`, ...s };
    },
    updateStay: async (id) => void calls.push(`updateStay:${id}`),
    removeStay: async (id) => void calls.push(`removeStay:${id}`),
    addWish: async (w) => {
      calls.push(`addWish:${w.title}:${w.place ? 'placed' : 'unplaced'}`);
      return wish(`w${++n}`, w.title, { place: w.place, priority: w.priority });
    },
    updateWish: async (id, p) => void calls.push(`updateWish:${id}:${Object.keys(p).sort().join(',')}`),
    removeWish: async (id) => void calls.push(`removeWish:${id}`),
    addBooking: async (b) => {
      calls.push(`addBooking:${b.title}:${b.url ?? 'nourl'}`);
      return { id: `b${++n}`, wishId: b.wishId, title: b.title, date: b.date ?? null, startMin: b.startMin ?? null, endMin: b.endMin ?? null, reference: b.reference ?? null, url: b.url ?? null, documentId: null, status: b.status ?? 'to-book' } as Booking;
    },
    updateBooking: async (id, p) => void calls.push(`updateBooking:${id}:${p.url ?? 'nourl'}`),
  };
  return { fx, calls };
}

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { trip: { ...TRIP }, stays: [STAY], wishes: [wish('w-pan', 'Pantheon')], bookings: [], knownUrls: new Set(), ...over };
}

describe('readPlannerAnswer', () => {
  it('reads the JSON answer and trims quick replies', () => {
    const r = readPlannerAnswer({ reply: ' Done. ', ops: [{ op: 'research' }], quickReplies: ['Yes', 'Yes', '', 'No', 'Maybe', 'Later', 'Never'] });
    expect(r).toEqual({ reply: 'Done.', ops: [{ op: 'research' }], quickReplies: ['Yes', 'No', 'Maybe', 'Later'] });
  });
  it('always has a reply', () => {
    expect(readPlannerAnswer(null).reply).toMatch(/say that again/);
    expect(readPlannerAnswer('plain text').reply).toBe('plain text');
    expect(readPlannerAnswer({ reply: 'x', ops: 'nope' }).ops).toEqual([]);
  });
});

describe('applyOps', () => {
  // v7: a place already found on the map (a meal option) survives a parent's
  // approval, but a model can never hand in coordinates of its own.
  const armando = { name: 'Armando', location: { lat: 41.899, lng: 12.477 }, osmId: 'node/9', address: null };
  const mealWish = { title: 'Armando', placeQuery: null, priority: 'must', durationMin: 60, partOfDay: 'any', fixedDate: '2026-10-27', replacesMeal: 'lunch', place: armando };

  it('keeps a found place on a trusted addWish (an approved suggestion)', async () => {
    const { fx, calls } = fakes();
    let placed: unknown = null;
    const trusted: OpEffects = { ...fx, trustsPlaces: true, addWish: async (w) => { placed = w.place; return fx.addWish(w); } };
    const r = await applyOps([{ op: 'addWish', wish: mealWish }], ctx(), trusted);
    expect(r.rejected).toEqual([]);
    expect(placed).toEqual(armando);
    expect(calls).toEqual(['addWish:Armando:placed']);
  });

  it("ignores a model's coordinates: no place without a query to resolve", async () => {
    const { fx, calls } = fakes();
    await applyOps([{ op: 'addWish', wish: mealWish }], ctx(), fx);
    expect(calls).toEqual(['addWish:Armando:unplaced']);
  });

  it('applies in order, so a later op sees an earlier one', async () => {
    const { fx, calls } = fakes();
    const c = ctx({ stays: [], wishes: [] });
    const r = await applyOps(
      [
        { op: 'setTrip', fields: { destination: 'Rome', startDate: '2026-11-02', endDate: '2026-11-05' } },
        // Inside the NEW dates only because setTrip ran first.
        { op: 'addStay', name: 'Flat', placeQuery: 'Via dei Cappellari 10, Rome', fromDate: '2026-11-02', toDate: '2026-11-06', checkInMin: 900, checkOutMin: 600 },
        { op: 'addWish', wish: { title: 'Pantheon', placeQuery: 'Pantheon, Rome', priority: 'must', durationMin: 45, partOfDay: 'morning', fixedDate: '2026-11-03' } },
      ],
      c,
      fx,
    );
    expect(r.rejected).toEqual([]);
    expect(calls).toEqual(['setTrip:Rome:2026-11-02', 'addStay:Flat', 'addWish:Pantheon:placed']);
    expect(r.applied.map((o) => o.op)).toEqual(['setTrip', 'addStay', 'addWish']);
    expect(r.changed).toBe(true);
    expect(r.research).toEqual([{ wishIds: ['w2'], depth: 'brief' }]);
    expect(c.trip.startDate).toBe('2026-11-02');
  });

  it('rejects bad ops with a reason and carries on', async () => {
    const { fx, calls } = fakes();
    const r = await applyOps(
      [
        { op: 'launchRocket' },
        'not an op',
        { op: 'setTrip', fields: { timeZone: 'Mars/Olympus' } },
        { op: 'addStay', name: 'Flat', placeQuery: 'Nowhere at all', fromDate: '2026-10-27', toDate: '2026-10-29' },
        { op: 'addStay', name: 'Flat', placeQuery: 'Via dei Cappellari 10, Rome', fromDate: '2026-12-01', toDate: '2026-12-03' },
        { op: 'updateWish', id: 'nope', fields: { priority: 'must' } },
        { op: 'updateWish', id: 'w-pan', fields: { suggested: true } },
        { op: 'updateWish', id: 'w-pan', fields: { fixedDate: '2027-01-01' } },
        { op: 'addWish', wish: { title: 'pantheon' } },
        { op: 'removeStay', id: 'missing' },
        { op: 'research', wishIds: ['ghost'], depth: 'deep' },
        { op: 'updateWish', id: 'w-pan', fields: { priority: 'must' } },
      ],
      ctx(),
      fx,
    );
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'Unknown operation “launchRocket”.',
      'Not an operation.',
      'Pick the time zone of the destination, e.g. Europe/Rome.',
      'Could not find “Nowhere at all” on the map — give a street address or a nearby landmark.',
      "The stay's dates fall outside the trip (2026-10-27 to 2026-10-30).",
      'No such wish.',
      'A suggestion can only be accepted (suggested: false).',
      '2027-01-01 is not a day of the trip.',
      '“pantheon” is already a wish.',
      'No such stay.',
      'research names no wish that exists.',
    ]);
    expect(calls).toEqual(['updateWish:w-pan:priority']);
  });

  it('places by OpenStreetMap only, and keeps an unplaceable wish without a place', async () => {
    const { fx, calls } = fakes();
    await applyOps([{ op: 'addWish', wish: { title: 'Secret bar', placeQuery: 'Somewhere secret', priority: 'nice' } }], ctx(), fx);
    expect(calls).toEqual(['addWish:Secret bar:unplaced']);
    const moved = await applyOps([{ op: 'updateWish', id: 'w-pan', fields: { placeQuery: 'Pantheon, Rome' } }], ctx(), fakes().fx);
    expect(moved.applied).toHaveLength(1);
  });

  it('never stores a booking link it did not already know (D5)', async () => {
    const { fx, calls } = fakes();
    const known = new Set(['https://www.museivaticani.va/tickets']);
    const r = await applyOps(
      [
        { op: 'addBooking', booking: { wishId: 'w-pan', title: 'Pantheon timed entry', url: 'https://www.getyourguide.com/pantheon', status: 'to-book' } },
        { op: 'addBooking', booking: { wishId: null, title: 'Vatican', url: 'https://www.museivaticani.va/tickets/', status: 'booked', reference: 'AB12' } },
        { op: 'addBooking', booking: { wishId: 'ghost', title: 'x' } },
      ],
      ctx({ knownUrls: known }),
      fx,
    );
    expect(calls).toEqual(['addBooking:Pantheon timed entry:nourl', 'addBooking:Vatican:https://www.museivaticani.va/tickets']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['That booking names a wish that does not exist.']);
  });

  it('updates and removes by id, and queues research and suggestions without changing the plan', async () => {
    const { fx, calls } = fakes();
    const r = await applyOps(
      [
        { op: 'research', wishIds: ['w-pan', 'ghost'], depth: 'deep' },
        { op: 'suggestNearby', near: 'Trastevere', theme: 'food' },
      ],
      ctx(),
      fx,
    );
    expect(r.changed).toBe(false);
    expect(r.research).toEqual([{ wishIds: ['w-pan'], depth: 'deep' }]);
    expect(r.suggest).toEqual([{ near: 'Trastevere', theme: 'food' }]);
    const r2 = await applyOps(
      [
        { op: 'updateStay', id: 's1', fields: { toDate: '2026-10-30', placeQuery: 'Via dei Cappellari 10, Rome' } },
        { op: 'updateStay', id: 's1', fields: { fromDate: '2026-10-30', toDate: '2026-10-30' } },
        { op: 'removeWish', id: 'w-pan' },
        { op: 'updateWish', id: 'w-pan', fields: { priority: 'must' } },
      ],
      ctx(),
      fx,
    );
    expect(calls).toEqual(['updateStay:s1', 'removeWish:w-pan']);
    expect(r2.rejected.map((x) => x.reason)).toEqual(['A stay is at least one night.', 'No such wish.']);
  });

  it(`stops after ${MAX_OPS} ops`, async () => {
    const { fx } = fakes();
    const many = Array.from({ length: MAX_OPS + 2 }, () => ({ op: 'suggestNearby', near: null, theme: null }));
    const r = await applyOps(many, ctx(), fx);
    expect(r.applied).toHaveLength(MAX_OPS);
    expect(r.rejected).toHaveLength(2);
  });
});

describe('links', () => {
  it('knows the links a trip holds and the ones the person typed', () => {
    const w = wish('w', 'Vatican', { facts: { ...emptyFacts(), bookingUrl: 'https://tickets.example/', sources: [{ url: 'https://src.example/a', title: null }] } });
    const known = knownUrlsOf([w], urlsIn('my booking: https://my.example/ref?x=1.'));
    expect([...known].sort()).toEqual(['https://my.example/ref?x=1', 'https://src.example/a', 'https://tickets.example/']);
    expect(knownUrlOrNull('https://tickets.example', known)).toBe('https://tickets.example/');
    expect(knownUrlOrNull('https://invented.example/', known)).toBeNull();
    expect(knownUrlOrNull('javascript:alert(1)', known)).toBeNull();
  });

  it('describes an op for the event log', () => {
    expect(describeOp({ op: 'updateWish', id: 'w', fields: { priority: 'must' } }, { w: 'Pantheon' })).toBe('Pantheon changed (priority).');
    expect(describeOp({ op: 'removeStay', id: 's' })).toBe('A stay was removed.');
  });
});

describe('v2.1: day loads and meal-replacing wishes', () => {
  it('merges day loads, drops normal and out-of-trip days, refuses bad loads', async () => {
    const { fx } = fakes();
    const seen: unknown[] = [];
    fx.setTrip = async (f) => void seen.push(f.dayLoads);
    const c = ctx({ trip: { ...TRIP, dayLoads: { '2026-10-27': 'full' } } });
    const r = await applyOps(
      [
        { op: 'setTrip', fields: { dayLoads: { '2026-10-28': 'light', '2027-01-01': 'light' } } },
        { op: 'setTrip', fields: { dayLoads: { '2026-10-27': 'normal' } } },
        { op: 'setTrip', fields: { dayLoads: { '2026-10-29': 'sleepy' } } },
      ],
      c,
      fx,
    );
    expect(seen).toEqual([{ '2026-10-27': 'full', '2026-10-28': 'light' }, { '2026-10-28': 'light' }]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['A day is light, normal or full, not “sleepy”.']);
    expect(describeOp(r.applied[0])).toBe('Day loads set: 2026-10-27 full, 2026-10-28 light.');
  });

  it('adds a wish that is that day’s lunch, and can change it back', async () => {
    const { fx } = fakes();
    const added: unknown[] = [];
    const orig = fx.addWish;
    fx.addWish = async (w) => {
      added.push(w.replacesMeal);
      return orig(w);
    };
    const r = await applyOps(
      [
        { op: 'addWish', wish: { title: 'Long lunch in Trastevere', placeQuery: 'Pantheon, Rome', fixedDate: '2026-10-29', durationMin: 120, replacesMeal: 'lunch' } },
        { op: 'addWish', wish: { title: 'Brunch', replacesMeal: 'elevenses' } },
        { op: 'updateWish', id: 'w-pan', fields: { replacesMeal: null } },
      ],
      ctx(),
      fx,
    );
    expect(added).toEqual(['lunch']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['A wish can replace breakfast, lunch or dinner.']);
    expect(r.applied.map((o) => o.op)).toEqual(['addWish', 'updateWish']);
  });
});

describe('v3: transport, remember and the profile', () => {
  const flight = {
    kind: 'flight', direction: 'outbound', carrier: 'Jet2', number: 'ls 1235',
    from: { name: 'Newcastle', code: 'ncl', timeZone: 'Europe/London', location: { lat: 1, lng: 1 } },
    to: { name: 'Rome Fiumicino', code: 'FCO', timeZone: 'Europe/Rome' },
    departDate: '2026-10-27', departMin: 455, arriveDate: '2026-10-27', arriveMin: 665,
    confidence: 'researched', sources: [{ url: 'https://flights.example/ls1235', title: 'LS1235' }, { url: 'https://made-up.example', title: 'x' }],
  };

  it('adds a journey: places by OpenStreetMap, never the model’s coordinates; only known links', async () => {
    const { fx } = fakes({ 'Newcastle NCL airport': { lat: 55.04, lng: -1.69 } });
    const saved: unknown[] = [];
    fx.addTransport = async (s) => {
      saved.push(s);
      return { id: 'tr1', ...s };
    };
    const c = ctx({ knownUrls: new Set(['https://flights.example/ls1235']), transport: [] });
    const r = await applyOps([{ op: 'addTransport', segment: flight }], c, fx);
    expect(r.rejected).toEqual([]);
    expect(saved[0]).toMatchObject({
      number: 'LS1235',
      from: { name: 'Newcastle', code: 'NCL', location: { lat: 55.04, lng: -1.69 }, timeZone: 'Europe/London' },
      to: { name: 'Rome Fiumicino', code: 'FCO', location: null, timeZone: 'Europe/Rome' },
      confidence: 'researched',
      sources: [{ url: 'https://flights.example/ls1235', title: 'LS1235' }],
      status: null,
    });
    expect(r.changed).toBe(true);
    expect(c.transport).toHaveLength(1);
  });

  it('refuses a bad journey and unknown ids', async () => {
    const { fx } = fakes();
    fx.addTransport = async (s) => ({ id: 'x', ...s });
    const r = await applyOps(
      [
        { op: 'addTransport', segment: { ...flight, kind: 'rocket' } },
        { op: 'addTransport', segment: { ...flight, number: 'not a flight' } },
        { op: 'addTransport', segment: { ...flight, arriveDate: '2026-10-26' } },
        { op: 'addTransport', segment: { ...flight, to: { name: 'Rome', timeZone: 'Moon/Base' } } },
        { op: 'updateTransport', id: 'ghost', fields: { arriveMin: 700 } },
        { op: 'removeTransport', id: 'ghost' },
      ],
      ctx({ transport: [] }),
      fx,
    );
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'kind is flight, train, coach, ferry or car.',
      '“NOTAFLIGHT” is not a flight number.',
      'It arrives before it leaves.',
      "The to end's time zone is not a time zone.",
      'No such journey.',
      'No such journey.',
    ]);
  });

  it('remembers only a short, categorised preference, and shows it in the profile', async () => {
    const { fx } = fakes();
    const remembered: string[] = [];
    let saved: unknown = null;
    fx.remember = async (text, category) => {
      remembered.push(`${category}:${text}`);
      return { stored: true };
    };
    fx.saveProfile = async (p) => void (saved = p);
    const r = await applyOps(
      [
        { op: 'remember', text: 'ok', category: 'preferences' },
        { op: 'remember', text: 'We never do early starts', category: 'secrets' },
        { op: 'remember', text: 'We never do early starts', category: 'preferences' },
        { op: 'remember', text: 'Ann cannot manage stairs', category: 'health' },
      ],
      ctx(),
      fx,
    );
    expect(r.rejected.map((x) => x.reason)).toEqual(['remember needs the preference in a short sentence.', 'remember’s category is preferences, people, health or places.']);
    expect(remembered).toEqual(['preferences:We never do early starts', 'health:Ann cannot manage stairs']);
    expect(saved).toMatchObject({ preferences: [{ text: 'We never do early starts', source: 'conversation' }], constraints: [{ text: 'Ann cannot manage stairs' }] });
    expect(r.changed).toBe(false);
    // No memory path, no memory write.
    const none = await applyOps([{ op: 'remember', text: 'We never do early starts', category: 'preferences' }], ctx(), fakes().fx);
    expect(none.rejected.map((x) => x.reason)).toEqual(['Memory is not available here.']);
  });

  it('corrects the profile', async () => {
    const { fx } = fakes();
    let saved: unknown = null;
    fx.saveProfile = async (p) => void (saved = p);
    const r = await applyOps([{ op: 'updateProfile', profile: { constraints: [{ text: 'Not vegetarian after all' }], secret: 'x' } }, { op: 'updateProfile', profile: {} }], ctx(), fx);
    expect(saved).toMatchObject({ constraints: [{ text: 'Not vegetarian after all', source: 'conversation' }] });
    expect(r.applied).toEqual([{ op: 'updateProfile', profile: { constraints: [{ text: 'Not vegetarian after all' }] } }]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['updateProfile changed nothing.']);
  });
});
