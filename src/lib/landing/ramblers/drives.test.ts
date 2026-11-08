import { describe, expect, it } from 'vitest';
import { movingBand, NO_DAY, recoveryBand, sleepBand } from './day';
import { contextFor, episodeReason, pick, reasonFor, rebase, relieve, score, startDrives, states, torn, type DriveInput, type Scored } from './drives';

const base: DriveInput = { hour: 11, weekday: true, sky: 'cloudy', temp: 13, pulse: 72, day: NO_DAY, sleep: null, recovery: null };
const odds = (i: Partial<DriveInput>) => Object.fromEntries(score(startDrives({ ...base, ...i })).map((o) => [o.a, o.p]));

describe('drives', () => {
  it('sleeps most of the time at three in the morning', () => {
    expect(odds({ hour: 3 }).sleep).toBeGreaterThan(0.5);
  });

  it('builds sleep pressure through the day, faster after a short night', () => {
    const at = (hour: number, sleep: DriveInput['sleep'] = null) => startDrives({ ...base, hour, sleep }).d.sleep;
    expect(at(22)).toBeGreaterThan(at(9));
    expect(at(14, 'low')).toBeGreaterThan(at(14));
    // The post-lunch dip: 14:30 is sleepier than 12:00 or 17:30.
    expect(at(14.5)).toBeGreaterThan(at(12));
    expect(at(14.5)).toBeGreaterThan(at(17.5));
  });

  it('wants tea at eleven and lunch at one', () => {
    const eleven = score(startDrives({ ...base, hour: 10.75 }));
    expect(eleven.slice(0, 3).map((o) => o.a)).toContain('tea');
    expect(odds({ hour: 13 }).eat).toBeGreaterThan(0.3);
  });

  it('gardens on a sunny day and stays in when it pours', () => {
    expect(odds({ hour: 15, sky: 'clear', temp: 20, weekday: false }).garden).toBeGreaterThan(odds({ hour: 15, sky: 'rain', weekday: false }).garden ?? 0);
    expect(odds({ hour: 15, sky: 'rain' }).puddle).toBeGreaterThan(0);
    expect(odds({ hour: 15, sky: 'clear' }).puddle).toBeUndefined();
  });

  it('stargazes only on clear dark nights', () => {
    expect(odds({ hour: 21.5, sky: 'clear' }).stargaze).toBeGreaterThan(0);
    expect(odds({ hour: 21.5, sky: 'cloudy' }).stargaze).toBeUndefined();
  });

  it('does not want another workout straight after one', () => {
    const s = startDrives({ ...base, hour: 17, day: { ...NO_DAY, steps: 'low' } });
    const before = Object.fromEntries(score(s).map((o) => [o.a, o.p]));
    relieve(s, 'workout', 12);
    const after = Object.fromEntries(score(s, { workout: 0.3 }).map((o) => [o.a, o.p]));
    expect(after.workout).toBeLessThan(before.workout / 3);
  });

  it('gets restless sitting about, and moving fixes it', () => {
    const s = startDrives(base);
    const r0 = s.d.restless;
    relieve(s, 'tv', 15);
    expect(s.d.restless).toBeGreaterThan(r0);
    relieve(s, 'run', 10);
    expect(s.d.restless).toBeLessThan(r0);
  });

  it('shows stress when the pulse is high without exercise, not after a workout', () => {
    expect(states(startDrives({ ...base, pulse: 110 })).stressed).toBe(true);
    expect(states(startDrives({ ...base, pulse: 110, day: { ...NO_DAY, exercised: true } })).stressed).toBe(false);
  });

  it('dithers only when two real needs are nearly tied', () => {
    const tie: Scored[] = [
      { a: 'tea', u: 0.4, p: 0.5, top: 'appetite' },
      { a: 'garden', u: 0.39, p: 0.5, top: 'attention' },
    ];
    expect(torn(tie)).toBe(true);
    expect(torn([tie[0], { ...tie[1], u: 0.2 }])).toBe(false);
  });

  it('keeps what play has done when the readings move on', () => {
    const s = startDrives(base);
    relieve(s, 'eat', 20);
    const next = rebase(s, { ...base, hour: 11.25 });
    expect(next.d.appetite).toBeLessThan(startDrives({ ...base, hour: 11.25 }).d.appetite);
  });

  it('gives a reason in the voice card\'s terms', () => {
    const s = startDrives({ ...base, hour: 14.5, sleep: 'low' });
    expect(reasonFor(s, { a: 'nap', u: 1, p: 1, top: 'sleep' })).toBe('shortNight');
    expect(reasonFor(startDrives({ ...base, hour: 21.5, sky: 'clear' }), { a: 'stargaze', u: 1, p: 1, top: 'curious' })).toBe('clearNight');
  });

  it('picks in proportion to the odds', () => {
    const list: Scored[] = [
      { a: 'tea', u: 1, p: 0.25, top: null },
      { a: 'tv', u: 1, p: 0.75, top: null },
    ];
    expect(pick(list, () => 0.2)?.a).toBe('tea');
    expect(pick(list, () => 0.3)?.a).toBe('tv');
  });
});

describe('combinations', () => {
  const at = (pulse: number, moving: 'still' | 'some' | 'active', extra: Partial<DriveInput> = {}) => ({ ...base, pulse, ...extra, day: { ...NO_DAY, moving, ...(extra.day ?? {}) } });

  it('reads a raised pulse while sat still in working hours as work stress', () => {
    const i = at(98, 'still', { hour: 14 });
    expect(contextFor(i)).toBe('workStress');
    const s = startDrives(i);
    expect(states(s).stressed).toBe(true);
    expect(episodeReason(s)).toBe('deskStress');
  });

  it('boils over when the pulse races with no movement at all', () => {
    const s = startDrives(at(115, 'still', { hour: 11 }));
    expect(s.context).toBe('fuming');
    expect(states(s).mad).toBe(true);
  });

  it('calls the same pulse outside working hours being on edge, not work', () => {
    const s = startDrives(at(98, 'still', { hour: 20 }));
    expect(s.context).toBe('onEdge');
    expect(states(s).anxious).toBe(true);
    expect(states(s).stressed).toBe(false);
  });

  it('does not mistake exercise for stress', () => {
    const s = startDrives(at(130, 'active', { hour: 7 }));
    expect(s.context).toBe('exerting');
    expect(states(s).stressed).toBe(false);
    const o = Object.fromEntries(score(s).map((x) => [x.a, x.p]));
    expect((o.run ?? 0) + (o.workout ?? 0)).toBeGreaterThan(0.2);
  });

  it('sees calm and still in working hours as focus, and leans to the desk', () => {
    const s = startDrives(at(62, 'still', { hour: 10 }));
    expect(s.context).toBe('focused');
    const o = Object.fromEntries(score(s).map((x) => [x.a, x.p]));
    expect(o.study).toBeGreaterThan(odds({ hour: 10 }).study);
  });

  it('gets him up after a long, low-step sit at work', () => {
    const i = { ...base, pulse: 75, hour: 15, day: { ...NO_DAY, moving: 'still' as const, steps: 'low' as const } };
    expect(contextFor(i)).toBe('deskBound');
    expect(startDrives(i).d.restless).toBeGreaterThan(startDrives({ ...i, day: { ...i.day, moving: null } }).d.restless);
  });

  it('says nothing when the movement data is stale', () => {
    expect(contextFor({ ...base, pulse: 115, day: { ...NO_DAY, moving: null } })).toBeNull();
  });
});

describe('bands', () => {
  it('turns recent steps into still, some or active, and stale data into nothing', () => {
    expect(movingBand(40, true)).toBe('still');
    expect(movingBand(600, true)).toBe('some');
    expect(movingBand(2000, true)).toBe('active');
    expect(movingBand(0, false)).toBeNull();
  });

  it('turns hours slept and recovery scores into three steps', () => {
    expect(sleepBand(5.2)).toBe('low');
    expect(sleepBand(7)).toBe('mid');
    expect(sleepBand(8.6)).toBe('high');
    expect(sleepBand(null)).toBeNull();
    expect(recoveryBand(20)).toBe('low');
    expect(recoveryBand(50)).toBe('mid');
    expect(recoveryBand(80)).toBe('high');
  });
});
