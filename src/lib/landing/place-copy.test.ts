import { describe, expect, it } from 'vitest';
import { daydreamTag, lampCaption, placePlates, placeTags, pulseTag, releasesTag, shipTag, stepsTag, tagLine } from './place-copy';
import { shipDays, shipStats } from './rhythm';

const NOW = Date.parse('2026-10-09T14:40:00+01:00');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe('the labels', () => {
  it('reads a fresh pulse with the watch and its age', () => {
    expect(pulseTag({ state: 'fresh', bpm: 52, at: ago(11) }, NOW)).toEqual({ kicker: 'Pulse', value: '52', unit: 'bpm', sub: 'Apple Watch · 11 minutes ago' });
  });

  it('dashes a missing or stale pulse, and never says how long the watch has been quiet', () => {
    const stale = pulseTag({ state: 'stale', at: ago(3 * 1440) }, NOW);
    expect(stale.value).toBe('—');
    expect(stale.spoken).toBe('no fresh reading');
    expect(JSON.stringify(stale)).not.toMatch(/day|hour|minute|\d/);
    expect(pulseTag({ state: 'none' }, NOW).sub).toBe('waiting on the watch');
  });

  it('tells no steps yet from a recorded zero', () => {
    expect(stepsTag(null)).toMatchObject({ value: '—', spoken: 'none', unit: 'not in yet' });
    expect(stepsTag(0)).toMatchObject({ value: '0', unit: 'today' });
    expect(stepsTag(12345).value).toBe('12,345');
  });

  it('has a word for every daydream state', () => {
    expect(daydreamTag({ state: 'next', minutes: 40 })).toMatchObject({ value: '40 minutes', sub: 'till the site next thinks' });
    expect(daydreamTag({ state: 'now' }).value).toBe('thinking');
    expect(daydreamTag({ state: 'late', minutes: 180 }).sub).toBe('it was due 3 hours ago');
    expect(daydreamTag({ state: 'asleep', wakes: '07:00' })).toMatchObject({ value: 'asleep', sub: 'till 07:00 · the loop, not me' });
    expect(daydreamTag({ state: 'off' }).value).toBe('switched off');
    expect(daydreamTag({ state: 'unknown', cadence: 45 }).value).toBe('every 45 minutes');
  });

  it('counts deploys none, one and many', () => {
    expect(shipTag({ today: 0, yesterday: 2 })).toMatchObject({ value: '0', unit: 'deploys today', sub: 'after 2 yesterday' });
    expect(shipTag({ today: 1, yesterday: 0 })).toMatchObject({ value: '1', unit: 'deploy today', sub: 'after a quiet yesterday' });
    expect(shipTag({ today: 7, yesterday: 1 }).unit).toBe('deploys today');
    expect(shipTag(null)).toMatchObject({ value: '—', unit: 'the record isn’t answering' });
  });

  it('says releases since the first, or that the record is away', () => {
    expect(releasesTag({ total: 1388, since: '2026-03-20T10:00:00Z' }, NOW)).toMatchObject({ value: '1,388', unit: 'since March' });
    expect(releasesTag({ total: 4, since: null }, NOW).unit).toBe('in all');
    expect(releasesTag(null, NOW).value).toBe('—');
  });

  it('keeps the sentence’s reading order', () => {
    const t = placeTags({ now: NOW, pulse: { state: 'none' }, steps: null, daydream: { state: 'off' }, cadenceMinutes: 45, deploys: null, releases: null });
    expect(Object.keys(t)).toEqual(['pulse', 'steps', 'daydream', 'ship', 'releases']);
  });
});

describe('the plate', () => {
  const facts = { cadenceMinutes: 45, activeHours: { start: 7, end: 23 }, hitRate: 0.62, windowDays: 14 };
  const days = shipDays([{ date: '2026-10-07', count: 3 }, { date: '2026-10-08', count: 2 }], '2026-10-09');
  const base = { now: NOW, facts, days, stats: shipStats(days), releases: { total: 753, days: 204 }, ridge: { from: '2026-03-20', to: '2026-08-30' } };

  it('explains each reading and links where the sentence links', () => {
    const p = placePlates({ ...base, pulse: { state: 'fresh', bpm: 52, at: ago(11) } });
    expect(p.pulse.text).toMatch(/Apple Watch/);
    expect(p.pulse.text).toMatch(/exactly that rate/);
    expect(p.pulse.href).toBe('/health');
    expect(p.steps.href).toBe('/health');
    expect(p.daydream.href).toBe('/projects/engine-room/daydream');
    expect(p.ship.href).toBe('/releases');
    expect(p.releases.href).toBe('/releases');
    expect(JSON.stringify(p)).not.toMatch(/jkai/i);
    expect(p.daydream.text).toMatch(/62% of rated notes/);
    expect(p.ship.head).toBe('Ship · 0 today · 2 yesterday · last 40 days');
    expect(p.ship.text).toMatch(/busiest 3 on Wed 7 Oct/);
    expect(p.releases.text).toMatch(/Fri 20 Mar to Sun 30 Aug/);
  });

  it('says the beacon is dark rather than make a pulse up', () => {
    const p = placePlates({ ...base, pulse: { state: 'stale', at: ago(600) } });
    expect(p.pulse.head).toBe('Pulse · Apple Watch · no fresh reading');
    expect(p.pulse.text).toMatch(/beacon stays dark/);
  });

  it('owns up when a rate is past what the beacon keeps', () => {
    const p = placePlates({ ...base, pulse: { state: 'fresh', bpm: 22, at: ago(2) } });
    expect(p.pulse.text).toMatch(/flashes at 30, the nearest it can/);
  });

  it('says the beacon holds steady rather than flash more than three times a second', () => {
    expect(placePlates({ ...base, pulse: { state: 'fresh', bpm: 189, at: ago(2) } }).pulse.text).toMatch(/holds steady/);
    expect(placePlates({ ...base, pulse: { state: 'fresh', bpm: 230, at: ago(2) } }).pulse.text).toMatch(/holds steady/);
    expect(placePlates({ ...base, pulse: { state: 'fresh', bpm: 120, at: ago(2) } }).pulse.text).toMatch(/once a beat/);
    expect(placePlates({ ...base, pulse: { state: 'fresh', bpm: 60, at: ago(2) } }).pulse.text).toMatch(/twice a beat/);
  });

  it('states no counts when the release record is unavailable', () => {
    const p = placePlates({ ...base, pulse: { state: 'none' }, days: [], stats: shipStats([]), releases: null, ridge: null });
    for (const id of ['ship', 'releases'] as const) {
      expect(p[id].head).toMatch(/the record isn’t answering/);
      expect(p[id].text).toMatch(/isn’t answering just now/);
      expect(`${p[id].head} ${p[id].text}`).not.toMatch(/\d/);
      expect(p[id].href).toBe('/releases');
    }
    // A record with no releases in it is no record either.
    expect(placePlates({ ...base, pulse: { state: 'none' }, releases: { total: 0, days: 0 } }).releases.text).toMatch(/isn’t answering/);
  });
});

describe('the caption', () => {
  it('shows the real rate, and qualifies a rate the lamp can only approach', () => {
    expect(lampCaption(null, false)).toBe('the beacon is dark: no fresh pulse to keep');
    expect(lampCaption(52, false)).toBe('the beacon keeps time at 52 bpm');
    expect(lampCaption(22, false)).toBe('the beacon keeps time at 30 bpm, as near as it draws');
    expect(lampCaption(250, false)).toBe('at 250 bpm the beacon holds steady, too quick to flash');
    expect(lampCaption(189, false)).toMatch(/^at 189 bpm/);
    expect(lampCaption(250, true)).toBe('the beacon is lit for 250 bpm, and keeps still');
  });
});

describe('print', () => {
  it('prints a dashed reading as its reason, not as a dash and a unit', () => {
    expect(tagLine(pulseTag({ state: 'stale', at: ago(600) }, NOW))).toBe('Pulse · nothing fresh from the watch');
    expect(tagLine(stepsTag(null))).toBe('Steps · not in yet');
    expect(tagLine(shipTag(null))).toBe('Ship · the record isn’t answering');
    expect(tagLine(pulseTag({ state: 'fresh', bpm: 52, at: ago(11) }, NOW))).toBe('Pulse · 52 bpm (Apple Watch · 11 minutes ago)');
    expect(tagLine(daydreamTag({ state: 'off' }))).toBe('Daydream · switched off (for now)');
  });
});
