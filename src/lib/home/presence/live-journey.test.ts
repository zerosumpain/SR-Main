import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null, setSetting: async () => {} }));
vi.mock('$lib/server/push-devices', () => ({ pushToEmails: async () => ({ reached: new Set(), sent: 0, failed: 0 }) }));

const { distanceText, endAps, endContent, modeText, movingContent, startAps, updateAps, worthPushing } = await import('./live-journey');
type JourneyContent = import('./live-journey').JourneyContent;

const HOME = { lat: 51.5, lon: -0.1 };
const NOW = new Date('2026-09-28T16:00:00Z'); // 17:00 London
// ~2.2 km north of home.
const fix = (extra: Partial<{ lat: number; lon: number; ts: Date; speedKmh: number | null; mode: string | null }> = {}) => ({
  lat: 51.52,
  lon: -0.1,
  ts: new Date(NOW.getTime() - 60_000),
  speedKmh: 5,
  mode: 'walking',
  ...extra,
});

describe('movingContent', () => {
  it('counts down toward home from elsewhere: distance, progress, a rough ETA', () => {
    const c = movingContent({ name: 'Sam', fromPlace: 'School', fromHome: false, fix: fix(), home: HOME, homeStartM: 3000, now: NOW });
    expect(c.phase).toBe('moving');
    expect(c.headline).toBe('Sam left School');
    expect(c.distanceHomeM).toBeGreaterThan(2000);
    expect(c.progress).toBeGreaterThan(0.2);
    expect(c.progress).toBeLessThan(0.3);
    // 2.2 km × 1.3 at 5 km/h ≈ 35 min.
    expect(c.etaMinutes).toBeGreaterThan(30);
    expect(c.detail).toMatch(/^2\.2 km from home · walking · ~\d+ min$/);
  });

  it('from home: how far away and how, with nothing to count down to', () => {
    const c = movingContent({ name: 'Sam', fromPlace: 'home', fromHome: true, fix: fix({ mode: 'vehicle', speedKmh: 40 }), home: HOME, homeStartM: null, now: NOW });
    expect(c.progress).toBeNull();
    expect(c.etaMinutes).toBeNull();
    expect(c.detail).toBe('2.2 km from home · by road');
  });

  it('says "nearly home" close in, with no ETA', () => {
    const c = movingContent({ name: 'Sam', fromPlace: 'School', fromHome: false, fix: fix({ lat: 51.501 }), home: HOME, homeStartM: 3000, now: NOW });
    expect(c.detail.startsWith('nearly home')).toBe(true);
    expect(c.etaMinutes).toBeNull();
  });

  it('gives no ETA to somebody standing still, and flags an old fix', () => {
    const c = movingContent({
      name: 'Sam', fromPlace: 'School', fromHome: false,
      fix: fix({ mode: 'still', speedKmh: 0, ts: new Date(NOW.getTime() - 20 * 60_000) }),
      home: HOME, homeStartM: 3000, now: NOW,
    });
    expect(c.etaMinutes).toBeNull();
    expect(c.detail).toContain('stopped');
    expect(c.detail).toContain('last seen 16:40');
  });

  it('copes with no fix at all', () => {
    const c = movingContent({ name: 'Sam', fromPlace: 'School', fromHome: false, fix: null, home: HOME, homeStartM: 3000, now: NOW });
    expect(c.detail).toBe('on the way');
    expect(c.updatedAt).toBe(Math.floor(NOW.getTime() / 1000));
  });
});

describe('endContent', () => {
  it('arrived at home fills the bar', () => {
    const c = endContent({ name: 'Sam', fromPlace: 'School', last: null }, { kind: 'arrived', place: 'Home', isHome: true, at: NOW });
    expect(c).toMatchObject({ phase: 'arrived', headline: 'Sam arrived at Home', detail: 'at 17:00', progress: 1 });
  });

  it('given up on says when they were last seen', () => {
    const c = endContent({ name: 'Sam', fromPlace: 'School', last: null }, { kind: 'ended', lastSeen: NOW });
    expect(c).toMatchObject({ phase: 'ended', detail: 'last seen 17:00' });
  });
});

describe('worthPushing', () => {
  const base = movingContent({ name: 'Sam', fromPlace: 'School', fromHome: false, fix: fix(), home: HOME, homeStartM: 3000, now: NOW });
  const at = (lat: number, extra = {}) =>
    movingContent({ name: 'Sam', fromPlace: 'School', fromHome: false, fix: fix({ lat, ...extra }), home: HOME, homeStartM: 3000, now: NOW });

  it('always pushes the first state, and never an identical one', () => {
    expect(worthPushing(null, base)).toBe(true);
    expect(worthPushing(base, { ...base })).toBe(false);
  });

  it('ignores a few metres but not a change of mode', () => {
    expect(worthPushing(base, at(51.5199))).toBe(false);
    expect(worthPushing(base, at(51.52, { mode: 'vehicle', speedKmh: 30 }))).toBe(true);
  });

  it('pushes a step of 500 m at this range', () => {
    expect(worthPushing(base, at(51.514))).toBe(true);
  });

  it('pushes the arrival', () => {
    const arrived: JourneyContent = endContent({ name: 'Sam', fromPlace: 'School', last: base }, { kind: 'arrived', place: 'Home', isHome: true, at: NOW });
    expect(worthPushing(base, arrived)).toBe(true);
  });
});

describe('the aps ActivityKit reads', () => {
  const content = movingContent({ name: 'Sam', fromPlace: 'School', fromHome: false, fix: fix(), home: HOME, homeStartM: 3000, now: NOW });
  const t = Math.floor(NOW.getTime() / 1000);

  it('start names the attributes type the app declares, and goes stale', () => {
    const aps = startAps({ journeyId: 'j1', name: 'Sam', fromPlace: 'School', startedAt: t }, content, NOW);
    expect(aps).toMatchObject({ event: 'start', 'attributes-type': 'JourneyAttributes', timestamp: t, 'stale-date': t + 20 * 60 });
    expect(aps.attributes).toEqual({ journeyId: 'j1', name: 'Sam', fromPlace: 'School', startedAt: t });
    expect(Object.keys(aps['content-state'] as object).sort()).toEqual(
      ['detail', 'distanceHomeM', 'etaMinutes', 'headline', 'mode', 'phase', 'progress', 'updatedAt'],
    );
  });

  it('update and end carry the state; end says when to leave the screen', () => {
    expect(updateAps(content, NOW)).toMatchObject({ event: 'update', timestamp: t });
    expect(endAps(content, NOW, 900)).toMatchObject({ event: 'end', 'dismissal-date': t + 900 });
  });
});

describe('words', () => {
  it('distances and modes read naturally', () => {
    expect(distanceText(640)).toBe('640 m');
    expect(distanceText(2440)).toBe('2.4 km');
    expect(distanceText(18_300)).toBe('18 km');
    expect(modeText('vehicle')).toBe('by road');
    expect(modeText('unknown')).toBeNull();
  });
});
