import { beforeEach, describe, expect, it, vi } from 'vitest';

// A place's geometry, once the owner has set it on the map, is the owner's:
// the refresh keeps it and never retires the place. The database is a fake
// that hands back queued select results and records every write; nothing here
// reaches Postgres. Made-up coordinates only.

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/db', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'returning']) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return c;
  };
  return {
    db: {
      select: () => chain(h.selects.shift() ?? []),
      update: () => ({
        set: (s: Record<string, unknown>) => {
          h.updates.push(s);
          return chain([{ id: 'p1' }]);
        },
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          h.inserts.push(v);
          return chain([{ id: 'new-place' }]);
        },
      }),
    },
  };
});
vi.mock('$lib/jkai/memory/service.server', () => ({ writeMemory: async () => ({ id: 'm' }) }));

const { createPlace, quietPlaceOutcome, refreshPlaces, refreshedGeometry, updatePlaceAlerts, updatePlaceGeometry } =
  await import('./places');

const LAT = 51.5;
const LON = -0.1;
const M_PER_DEG_LAT = 111_195;

function place(extra: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    lat: LAT,
    lon: LON,
    radiusM: 400,
    radiusPinned: false,
    source: 'inferred',
    status: 'active',
    label: null,
    ...extra,
  };
}

/** Fixes `northM` metres north of the place, every five minutes. */
function fixes(northM: number, count: number) {
  const t0 = Date.now() - 60 * 60_000;
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    ts: new Date(t0 + i * 5 * 60_000),
    lat: LAT + northM / M_PER_DEG_LAT,
    lon: LON,
    accuracyM: 10,
    placeId: null,
    subject: 'sam',
  }));
}

const placeWrites = () => h.updates.filter((u) => !('placeId' in u));

beforeEach(() => {
  h.selects = [];
  h.updates = [];
  h.inserts = [];
});

describe('refreshedGeometry', () => {
  const stats = { lat: 51.501, lon: -0.101, radiusM: 210, visitCount: 3 };

  it('takes the derived geometry for a place the owner has not set', () => {
    expect(refreshedGeometry(place(), stats)).toEqual(stats);
  });

  it('keeps the centre AND the radius of a pinned place, refreshing only the stats', () => {
    expect(refreshedGeometry(place({ radiusPinned: true }), stats)).toEqual({ lat: LAT, lon: LON, radiusM: 400, visitCount: 3 });
  });
});

describe('quietPlaceOutcome — a cluster that did not qualify this pass', () => {
  it('keeps a confirmed or pinned place, retires an inferred active one', () => {
    expect(quietPlaceOutcome(place({ source: 'confirmed' }))).toBe('keep');
    expect(quietPlaceOutcome(place({ radiusPinned: true }))).toBe('keep');
    expect(quietPlaceOutcome(place())).toBe('retire');
    expect(quietPlaceOutcome(place({ status: 'transit' }))).toBe('reject');
    expect(quietPlaceOutcome(undefined)).toBe('reject');
  });
});

describe('refreshPlaces with a pinned place', () => {
  it('re-derives an unpinned place from the trail', async () => {
    h.selects = [fixes(60, 4), [place()]];
    const r = await refreshPlaces();
    expect(r.updated).toBe(1);
    const [write] = placeWrites();
    expect(write.lat).toBeCloseTo(LAT + 60 / M_PER_DEG_LAT, 6);
    expect(write.radiusM).not.toBe(400);
  });

  it('keeps a pinned place where the owner put it, at the owner\'s radius', async () => {
    h.selects = [fixes(60, 4), [place({ radiusPinned: true })]];
    await refreshPlaces();
    const [write] = placeWrites();
    expect(write).toMatchObject({ lat: LAT, lon: LON, radiusM: 400, visitCount: 1 });
  });

  it('does not retire a pinned place to transit when the trail goes quiet there', async () => {
    h.selects = [fixes(60, 1), [place({ radiusPinned: true })]];
    const r = await refreshPlaces();
    expect(r.retired).toBe(0);
    expect(placeWrites()).toEqual([]);
  });

  it('still retires an unpinned, unnamed one', async () => {
    h.selects = [fixes(60, 1), [place()]];
    const r = await refreshPlaces();
    expect(r.retired).toBe(1);
    expect(placeWrites()[0]).toMatchObject({ status: 'transit' });
  });
});

describe('writing geometry from the map', () => {
  it('updatePlaceGeometry moves and resizes a place and pins it', async () => {
    expect(await updatePlaceGeometry('p1', { lat: LAT, lon: LON, radiusM: 250 })).toEqual({ id: 'p1' });
    expect(h.updates[0]).toMatchObject({ lat: LAT, lon: LON, radiusM: 250, radiusPinned: true });
  });

  it('refuses geometry off the globe or outside 50–2000 m', async () => {
    await expect(updatePlaceGeometry('p1', { lat: 95, lon: LON, radiusM: 250 })).rejects.toThrow(/latitude/i);
    await expect(updatePlaceGeometry('p1', { lat: LAT, lon: LON, radiusM: 20 })).rejects.toThrow(/radius/i);
    expect(h.updates).toEqual([]);
  });

  it('createPlace inserts an active, named, pinned place with no visits', async () => {
    expect(await createPlace({ label: ' Club ', kind: 'gym', lat: LAT, lon: LON, radiusM: 150 })).toEqual({ id: 'new-place' });
    expect(h.inserts[0]).toMatchObject({
      label: 'Club',
      kind: 'gym',
      lat: LAT,
      lon: LON,
      radiusM: 150,
      radiusPinned: true,
      status: 'active',
      source: 'confirmed',
      visitCount: 0,
      distinctDays: 0,
      medianDwellMins: 0,
    });
    expect(h.inserts[0].dayHistogram).toHaveLength(7);
    expect(h.inserts[0].hourHistogram).toHaveLength(24);
  });

  it('createPlace refuses an empty name', async () => {
    await expect(createPlace({ label: '  ', kind: 'other', lat: LAT, lon: LON, radiusM: 150 })).rejects.toThrow(/name/i);
    expect(h.inserts).toEqual([]);
  });
});

describe('updatePlaceAlerts — directions', () => {
  it('writes the arrive and leave switches when given', async () => {
    await updatePlaceAlerts('p1', { alerts: true, alertArrive: false, alertLeave: true });
    expect(h.updates[0]).toMatchObject({ alerts: true, alertArrive: false, alertLeave: true });
  });
});
