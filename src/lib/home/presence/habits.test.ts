import { describe, expect, it } from 'vitest';
import { habitsOf, mergeOutings, outingsOf, partOf, type Outing } from './habits';
import type { Category, Visit } from './patterns';

const MIN = 60_000, H = 60 * MIN;
const clock = (t: number) => { const d = new Date(t); return { weekday: (d.getUTCDay() + 6) % 7, minute: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const dateOf = (t: number) => new Date(t).toISOString().slice(0, 10);

function visit(subject: string, placeId: string, category: Category, start: number, minutes: number, onFoot = 0): Visit {
  const c = clock(start);
  return { subject, placeId, category, start, end: start + minutes * MIN, minutes, inMinutes: 0, inMode: '', fromId: '', onFoot,
    date: dateOf(start), weekday: c.weekday, arriveMin: c.minute };
}
/** Home until `out`, a run of stops, home again: an outing, for `outingsOf`. */
function day(subject: string, d: string, out: number, stops: Array<[string, Category, number]>): Visit[] {
  const d0 = Date.parse(`${d}T00:00:00Z`);
  const vs: Visit[] = [visit(subject, 'home', 'home', d0, out * 60)];
  let t = d0 + out * H + 10 * MIN;
  for (const [id, cat, mins] of stops) { vs.push(visit(subject, id, cat, t, mins, 20)); t += mins * MIN + 10 * MIN; }
  vs.push(visit(subject, 'home', 'home', t, 60));
  return vs;
}
const onFoot = (a: number, b: number) => (b - a) / MIN / 4;
const SATURDAYS = ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24'];
const name = (id: string) => ({ lidl: 'Lidl', cafe: 'Cafe', park: 'Park' })[id] ?? id;

describe('habits', () => {
  it('names the part of the day by the hour', () => {
    expect(partOf(7 * 60)).toBe('early');
    expect(partOf(12 * 60 + 30)).toBe('midday');
    expect(partOf(23 * 60)).toBe('night');
    expect(partOf(2 * 60)).toBe('night');
  });

  it('reads outings off the stays between two at home, only when most of them was seen', () => {
    const vs = day('kate', '2026-10-03', 10, [['lidl', 'shops', 60], ['cafe', 'food', 45]]);
    const [o] = outingsOf('kate', vs, [], 'home', onFoot, clock);
    expect(o).toMatchObject({ stops: ['shops', 'food'], kind: 'about', anchor: 'shops', weekday: 5, startMin: 600 });
    expect(o.minutes).toBe(10 + 60 + 10 + 45 + 10);
    // The same outing with nothing seen between leaving and the shop is dropped.
    const gappy = vs.map((v) => (v.placeId === 'lidl' ? { ...v, start: v.start + 3 * H, minutes: 5, end: v.start + 3 * H + 5 * MIN } : v));
    gappy[2] = { ...gappy[2], start: gappy[1].end + 5 * MIN, minutes: 5, end: gappy[1].end + 10 * MIN };
    gappy[3] = { ...gappy[3], start: gappy[3].start + 3 * H };
    expect(outingsOf('kate', gappy, [], 'home', onFoot, clock)).toEqual([]);
  });

  it('finds the Saturday shop, what goes with it, and when the food happens', () => {
    const visits: Visit[] = [], outings: Outing[] = [];
    const seen = new Map<string, number>();
    // Every Saturday: shops, then the cafe on three of them. Four Sundays at the park, no food.
    for (const [i, d] of SATURDAYS.entries()) {
      const vs = day('kate', d, 10, i < 3 ? [['lidl', 'shops', 60], ['cafe', 'food', 45]] : [['lidl', 'shops', 60]]);
      visits.push(...vs); outings.push(...outingsOf('kate', vs, [], 'home', onFoot, clock));
      seen.set(d, 5);
    }
    for (const d of ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']) {
      const vs = day('kate', d, 14, [['park', 'outdoors', 90]]);
      visits.push(...vs); outings.push(...outingsOf('kate', vs, [], 'home', onFoot, clock));
      seen.set(d, 6);
    }
    const h = habitsOf(visits, outings, seen, name, (s) => s);
    expect(h.routines[0]).toMatchObject({ category: 'shops', weekday: 5, hits: 4, of: 4, rate: 1, usual: '10:10', part: 'morning', places: ['Lidl'] });
    expect(h.routines.find((r) => r.category === 'outdoors')).toMatchObject({ weekday: 6, hits: 4, part: 'afternoon' });
    // Three dates of food out of four Saturdays clears the bar too.
    expect(h.routines.find((r) => r.category === 'food')).toMatchObject({ hits: 3, of: 4 });
    expect(h.week.find((r) => r.category === 'shops')!.days[5]).toMatchObject({ hits: 4, of: 4, rate: 1 });

    expect(h.outings.about).toMatchObject({ outings: 8, foodShare: 0.38 });
    expect(h.outings.byAnchor.map((a) => a.anchor)).toEqual(['shops', 'outdoors']);
    const pair = h.outings.pairs.find((p) => p.a === 'food' && p.b === 'shops');
    // Too few: three outings with food is under the five a pairing needs.
    expect(pair).toBeUndefined();
    expect(h.outings.sequences).toEqual([{ from: 'shops', to: 'food', n: 3 }]);

    // Four visits a kind of place is under the five a time-of-day profile needs.
    expect(h.times).toEqual([]);
  });

  it('finds the two hours that hold the most arrivals', () => {
    const at = ['2026-10-03T12:10', '2026-10-04T12:40', '2026-10-10T13:20', '2026-10-11T12:05', '2026-10-17T19:00', '2026-10-18T13:45'];
    const visits = at.map((t) => visit('kate', 'cafe', 'food', Date.parse(`${t}:00Z`), 50));
    const [food] = habitsOf(visits, [], new Map(), name, (s) => s).times;
    expect(food).toMatchObject({ category: 'food', visits: 6, weekendShare: 1, medianStay: 50 });
    expect(food.peak).toEqual({ from: '12:00', to: '14:00', share: 0.83 });
  });

  it('counts people out together as one outing', () => {
    const a = outingsOf('kate', day('kate', '2026-10-03', 10, [['lidl', 'shops', 60]]), [], 'home', onFoot, clock);
    const b = outingsOf('john', day('john', '2026-10-03', 10, [['lidl', 'shops', 60], ['cafe', 'food', 30]]), [], 'home', onFoot, clock);
    const merged = mergeOutings([...a, ...b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].people.sort()).toEqual(['john', 'kate']);
    expect(merged[0].stops).toEqual(['shops', 'food']);
  });
});
