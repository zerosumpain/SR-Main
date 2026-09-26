import { beforeEach, describe, expect, it, vi } from 'vitest';

// The REAL actions with a faked `locals`; only the database-facing place
// helpers are faked.
vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => (email ?? '').toLowerCase() === 'owner@example.test',
}));
vi.mock('$lib/db', () => ({ db: {} }));

const h = vi.hoisted(() => ({
  places: [] as Array<Record<string, unknown>>,
  updates: [] as Array<[string, Record<string, unknown>]>,
  renames: [] as Array<[string, string, string]>,
}));

vi.mock('$lib/home/presence/places', () => ({
  RADIUS_MIN_M: 50,
  RADIUS_MAX_M: 2000,
  isPlaceKind: (v: unknown) => typeof v === 'string' && ['home', 'school', 'other', 'unknown'].includes(v),
  listPanelPlaces: async () => h.places,
  confirmPlace: async (id: string, label: string, kind: string) => {
    h.renames.push([id, label, kind]);
    return { memoryId: 'm', thoughtsResolved: 0 };
  },
  updatePlaceAlerts: async (id: string, patch: Record<string, unknown>) => {
    h.updates.push([id, patch]);
    return { id };
  },
}));

const { actions, load } = await import('./+page.server');

function eventFor(email: string | null, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return {
    locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
    getClientAddress: () => '203.0.113.9',
    request: new Request('http://x/home/people/places?/save', { method: 'POST', body: form }),
    setHeaders: () => {},
    params: {},
  } as unknown as Parameters<typeof actions.save>[0];
}

beforeEach(() => {
  h.places = [
    { id: 'home', label: null, kind: 'home', radiusM: 120, alerts: false, whatsappAlerts: false, isHome: true },
    { id: 'school', label: 'School', kind: 'school', radiusM: 150, alerts: false, whatsappAlerts: false, isHome: false },
  ];
  h.updates = [];
  h.renames = [];
});

describe('/home/people/places — owner only', () => {
  it('refuses a non-owner action and writes nothing', async () => {
    const res = (await actions.save(eventFor('sam@example.test', { placeId: 'school', label: 'X', radiusM: '100', alerts: 'on' }))) as {
      status: number;
    };
    expect(res.status).toBe(403);
    expect(h.updates).toEqual([]);
    expect(h.renames).toEqual([]);
  });

  it('refuses a non-owner load', async () => {
    await expect(load(eventFor(null) as unknown as Parameters<typeof load>[0])).rejects.toMatchObject({ status: 403 });
  });
});

describe('/home/people/places — save', () => {
  it('renames through confirmPlace, pins a changed radius and sets the toggles', async () => {
    const res = await actions.save(
      eventFor('owner@example.test', { placeId: 'school', label: 'Big School', radiusM: '300', alerts: 'on', whatsappAlerts: 'on' }),
    );
    expect(res).toEqual({ saved: 'school' });
    expect(h.renames).toEqual([['school', 'Big School', 'school']]);
    expect(h.updates).toEqual([['school', { alerts: true, whatsappAlerts: true, radiusM: 300 }]]);
  });

  it('leaves an unchanged radius and name alone', async () => {
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM: '150' }));
    expect(h.renames).toEqual([]);
    expect(h.updates).toEqual([['school', { alerts: false, whatsappAlerts: false }]]);
  });

  it('turns alerts on with WhatsApp, since WhatsApp rides on an alert', async () => {
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM: '150', whatsappAlerts: 'on' }));
    expect(h.updates[0][1]).toMatchObject({ alerts: true, whatsappAlerts: true });
  });

  it('rejects a radius outside 50–2000 m', async () => {
    for (const radiusM of ['49', '2001', '', 'wide']) {
      const res = (await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM }))) as {
        status: number;
      };
      expect(res.status).toBe(400);
    }
    expect(h.updates).toEqual([]);
  });

  it('refuses a place that is not on the panel', async () => {
    const res = (await actions.save(eventFor('owner@example.test', { placeId: 'elsewhere', label: 'X', radiusM: '100' }))) as {
      status: number;
    };
    expect(res.status).toBe(404);
  });

  it('leaves home\'s stored alert flag untouched: home is watched regardless', async () => {
    await actions.save(eventFor('owner@example.test', { placeId: 'home', label: '', radiusM: '120', whatsappAlerts: 'on' }));
    expect(h.updates).toEqual([['home', { whatsappAlerts: true }]]);
  });
});
