import { describe, expect, it } from 'vitest';
import {
  daydreamReading,
  fairCopy,
  plates,
  pulseReading,
  releasesReading,
  shipReading,
  stampPlace,
  stepsReading,
  wallWeeks,
  type FairInput,
  type PlateInput,
} from './notes';
import { shipDays, shipStats, type DayCount } from './rhythm';
import { NOTES } from './sentence';

// 14:40 in London on Friday 9 October 2026 (BST, so 13:40 UTC).
const NOW = Date.parse('2026-10-09T13:40:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const FACTS = { cadenceMinutes: 45, activeHours: { start: 7, end: 23 }, hitRate: 0.62, windowDays: 14 };
const FRESH = { state: 'fresh' as const, bpm: 52, at: minsAgo(11) };

/** Forty days to today with `today` and `yesterday` at the end. */
function forty(today = 0, yesterday = 2): DayCount[] {
  const cadence = [{ date: '2026-09-01', count: 3 }, { date: '2026-10-01', count: 14 }, { date: '2026-10-08', count: yesterday }, { date: '2026-10-09', count: today }];
  return shipDays(cadence, '2026-10-09');
}

/** Every word the sheet could show or say, for the checks that no state leaks. */
const allText = (o: unknown) => JSON.stringify(o);

describe('the pulse', () => {
  it('rings the rate and says whose watch read it', () => {
    expect(pulseReading(FRESH, NOW)).toEqual({ value: '52', unit: 'bpm', aside: 'apple watch, 11 minutes ago' });
  });

  it('is a dash a screen reader hears as words, and never says how long a stale watch has been quiet', () => {
    expect(pulseReading({ state: 'none' }, NOW)).toMatchObject({ value: '—', spoken: 'no fresh reading', aside: 'waiting on the watch' });
    const stale = pulseReading({ state: 'stale', at: minsAgo(3 * 1440) }, NOW);
    expect(stale).toMatchObject({ value: '—', spoken: 'no fresh reading', aside: 'nothing fresh from the watch' });
    expect(allText(stale)).not.toMatch(/day|hour|ago/);
  });

  it('calls the source the Apple Watch, and never Whoop', () => {
    const p = plates({ ...PLATES, pulse: FRESH }).pulse;
    expect(p.head).toContain('Apple Watch');
    expect(allText(p) + allText(pulseReading(FRESH, NOW))).not.toMatch(/whoop/i);
  });
});

describe('the steps', () => {
  it('tells none yet from a recorded zero', () => {
    expect(stepsReading(null)).toMatchObject({ value: '—', spoken: 'none yet', aside: 'the phone hasn’t sent any yet.' });
    expect(stepsReading(0)).toMatchObject({ value: '0', unit: 'steps' });
    expect(stepsReading(1)).toMatchObject({ value: '1', unit: 'step' });
    expect(stepsReading(3761)).toEqual({ value: '3,761', unit: 'steps', aside: 'so far. it’s a ruler, not a race.' });
  });
});

describe('the daydream', () => {
  it('counts down with the dial shaded for the wait', () => {
    const d = daydreamReading({ state: 'next', minutes: 40 }, FACTS);
    expect(d).toMatchObject({ lead: 'next think in', value: '40 minutes', aside: 'sleeps 23:00–07:00. the loop, not me.' });
    expect(d.dial).toEqual({ kind: 'wait', f: 40 / 45 });
    // A longer wait than one cycle (the loop rescheduled) shades the whole face, no more.
    expect(daydreamReading({ state: 'next', minutes: 90 }, FACTS).dial).toEqual({ kind: 'wait', f: 1 });
  });

  it('has words for thinking now, late, asleep, off and not yet heard from', () => {
    expect(daydreamReading({ state: 'now' }, FACTS)).toMatchObject({ value: 'thinking now', dial: { kind: 'wait', f: 0 } });
    expect(daydreamReading({ state: 'late', minutes: 180 }, FACTS)).toMatchObject({ value: 'running late', aside: 'it was due 3 hours ago.', dial: { kind: 'late' } });
    expect(daydreamReading({ state: 'asleep', wakes: '07:00' }, FACTS)).toMatchObject({ value: 'asleep', aside: 'till 07:00. the loop, not me.', dial: { kind: 'asleep' } });
    expect(daydreamReading({ state: 'off' }, FACTS)).toMatchObject({ value: 'switched off', dial: { kind: 'off' } });
    expect(daydreamReading({ state: 'unknown', cadence: 45 }, FACTS)).toMatchObject({ value: 'every 45 minutes', dial: { kind: 'idle' } });
  });

  it('says asleep of the loop, never of John', () => {
    for (const d of [daydreamReading({ state: 'asleep', wakes: '07:00' }, FACTS), daydreamReading({ state: 'next', minutes: 5 }, FACTS)])
      expect(d.aside).toContain('the loop, not me');
  });
});

describe('the deploys', () => {
  it('reads 0, 1 and many today with yesterday in the aside', () => {
    expect(shipReading(forty(0, 2))).toEqual({ value: '0', unit: 'deploys today', aside: 'none yet. two yesterday.' });
    expect(shipReading(forty(1, 0))).toEqual({ value: '1', unit: 'deploy today', aside: 'so far. a quiet yesterday.' });
    expect(shipReading(forty(12, 1))).toEqual({ value: '12', unit: 'deploys today', aside: 'so far. one yesterday.' });
  });

  it('says the record is unavailable rather than tally zeros', () => {
    expect(shipReading([])).toMatchObject({ value: '—', spoken: 'no record', aside: 'the record isn’t answering just now.' });
  });
});

describe('the releases', () => {
  it('pins the total with when the record began', () => {
    expect(releasesReading({ total: 1388, firstDeploy: '2026-03-20T10:00:00Z', days: 204 }, NOW)).toMatchObject({
      value: '1,388',
      since: 'since March',
      span: '204 days',
    });
    expect(releasesReading({ total: 1, firstDeploy: null, days: 1 }, NOW)).toMatchObject({ unit: 'release', since: 'in all', span: '1 day' });
  });

  it('is unavailable with no record or an empty one', () => {
    for (const r of [null, { total: 0, firstDeploy: null, days: 0 }]) expect(releasesReading(r, NOW)).toMatchObject({ value: '—', spoken: 'unavailable' });
  });
});

describe('the stamp', () => {
  it('sets the town and the temperature, either alone, or nothing', () => {
    expect(stampPlace('Darlington', 12.3)).toBe('Darlington · 12°');
    expect(stampPlace(undefined, -3.6)).toBe('−4°');
    expect(stampPlace('Darlington', null)).toBe('Darlington');
    expect(stampPlace(undefined, null)).toBeNull();
    // No "-0".
    expect(stampPlace(undefined, -0.2)).toBe('0°');
  });
});

describe('the wall', () => {
  it('lays forty days out a week to a line, Monday first, with nothing after today', () => {
    const weeks = wallWeeks(forty());
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const flat = weeks.flat();
    expect(flat.filter(Boolean)).toHaveLength(40);
    // 31 Aug 2026 was a Monday: the first day sits in the first slot.
    expect(flat[0]).toMatchObject({ i: 0, date: '2026-08-31' });
    // Friday 9 Oct is today, then Saturday and Sunday are left blank.
    expect(flat.at(-3)).toMatchObject({ i: 39, date: '2026-10-09' });
    expect(flat.slice(-2)).toEqual([null, null]);
  });

  it('pads the first week before the first day', () => {
    const days = shipDays([{ date: '2026-10-09', count: 1 }], '2026-10-09', 3);
    // Wed 7, Thu 8, Fri 9 Oct.
    expect(wallWeeks(days)[0].map((d) => d?.date ?? null)).toEqual([null, null, '2026-10-07', '2026-10-08', '2026-10-09', null, null]);
  });

  it('is empty without a record', () => {
    expect(wallWeeks([])).toEqual([]);
  });
});

const days = forty();
const PLATES: PlateInput = {
  pulse: FRESH,
  drawn: 52,
  now: NOW,
  facts: FACTS,
  days,
  stats: shipStats(days),
  releases: { total: 1388, days: 204 },
  dial: { kind: 'wait', f: 0.5 },
};

describe('the explanations', () => {
  it('explain all five readings, and link only to their public records', () => {
    const p = plates(PLATES);
    expect(Object.keys(p)).toEqual([...NOTES]);
    expect(p.pulse.href).toBe('/health');
    expect(p.steps.href).toBe('/health');
    expect(p.daydream.href).toBe('/projects/engine-room/daydream');
    expect(p.ship.href).toBe('/releases');
    expect(p.releases.href).toBe('/releases');
    expect(allText(p)).not.toContain('/jkai');
  });

  it('say the line is flat without a reading, and name the drawn rate when the real one is off the scale', () => {
    expect(plates({ ...PLATES, pulse: { state: 'none' }, drawn: null }).pulse.text).toContain('lies flat');
    expect(plates({ ...PLATES, pulse: { ...FRESH, bpm: 230 }, drawn: 200 }).pulse.text).toContain('it beats at 200, the nearest it can');
    expect(plates(PLATES).pulse.text).toContain('exactly that rate');
  });

  it('never put a stale reading’s age on the page', () => {
    const p = plates({ ...PLATES, pulse: { state: 'stale', at: minsAgo(3 * 1440) }, drawn: null }).pulse;
    expect(p.head).toBe('Pulse · Apple Watch · no fresh reading');
    expect(allText(p)).not.toMatch(/days? ago|hours? ago/);
  });

  it('describe only what the daydream dial actually draws', () => {
    const say = (dial: PlateInput['dial']) => plates({ ...PLATES, dial }).daydream.text;
    expect(say({ kind: 'wait', f: 0.5 })).toMatch(/The shading is the wait till the next one\.$/);
    for (const dial of [{ kind: 'wait', f: 0 }, { kind: 'late' }, { kind: 'asleep' }, { kind: 'off' }, { kind: 'idle' }] as const)
      expect(say(dial)).not.toContain('shading');
    expect(say({ kind: 'wait', f: 0 })).toContain('Nothing is shaded');
    expect(say({ kind: 'late' })).toContain('dashed');
    expect(say({ kind: 'asleep' })).toContain('outside its hours');
    expect(say({ kind: 'off' })).toContain('struck through');
    expect(say({ kind: 'idle' })).toMatch(/last 14 days\.$/);
  });

  it('count the wall in words, and say so when there is no record', () => {
    expect(plates(PLATES).ship.head).toBe('Ship · 0 today · 2 yesterday · last 40 days');
    expect(plates(PLATES).ship.text).toContain('19 in 40 days, the busiest 14 on Thu 1 Oct');
    const none = plates({ ...PLATES, days: [], stats: shipStats([]), releases: null });
    expect(none.ship.head).toBe('Ship · the record isn’t answering');
    expect(none.releases.head).toBe('Releases · the record isn’t answering');
  });
});

describe('the fair copy', () => {
  const base: FairInput = {
    date: 'Fri 9 Oct',
    place: 'Darlington · 12°',
    pulse: FRESH,
    now: NOW,
    steps: 3761,
    daydream: daydreamReading({ state: 'next', minutes: 40 }, FACTS),
    facts: FACTS,
    days,
    stats: shipStats(days),
    releases: releasesReading({ total: 1388, firstDeploy: '2026-03-20T10:00:00Z', days: 204 }, NOW),
  };

  it('types every reading up in words', () => {
    expect(fairCopy(base).map((r) => `${r.term}: ${r.value} (${r.note})`)).toEqual([
      'Pulse: 52 bpm (Apple Watch, read 11 minutes ago)',
      'Steps: 3,761 (since midnight)',
      'Daydream: next think in 40 minutes (every 45 minutes, 07:00–23:00)',
      'Deploys: 0 today (2 yesterday · 19 in the last 40 days)',
      'Releases: 1,388 (since March · 204 days)',
      'Today: Fri 9 Oct (Darlington · 12°)',
    ]);
  });

  it('keeps the honest states when nothing is in', () => {
    const rows = fairCopy({
      ...base,
      pulse: { state: 'stale', at: minsAgo(3 * 1440) },
      steps: null,
      days: [],
      stats: shipStats([]),
      releases: releasesReading(null, NOW),
      place: null,
    });
    expect(rows.map((r) => r.value)).toEqual(['no fresh reading', 'none yet', 'next think in 40 minutes', 'unavailable', 'unavailable', 'Fri 9 Oct']);
    expect(allText(rows)).not.toMatch(/days? ago|hours? ago/);
  });
});
