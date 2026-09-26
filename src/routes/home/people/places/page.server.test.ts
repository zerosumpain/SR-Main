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
  named: [] as Array<[string, string, string]>,
  log: [] as string[],
  moves: [] as Array<[string, Record<string, unknown>]>,
  creates: [] as Array<Record<string, unknown>>,
  ignored: [] as string[],
  placeTimeCalls: [] as unknown[],
  failRename: false,
}));

vi.mock('$lib/home/presence/members', () => ({
  listMembers: async () => [
    { subject: 'alex', displayName: 'Alex' },
    { subject: 'sam', displayName: 'Sam' },
  ],
}));
vi.mock('$lib/home/presence/movement', () => ({
  placeTimeByPerson: async (people: unknown, opts: unknown) => {
    h.placeTimeCalls.push([people, opts]);
    return { school: [{ subject: 'sam', displayName: 'Sam', minutes: 90, share: 0.002, visits: 2, usualArrival: '08:40' }] };
  },
}));

vi.mock('$lib/home/presence/places', () => ({
  RADIUS_MIN_M: 50,
  RADIUS_MAX_M: 2000,
  PLACE_LABEL_MAX: 60,
  PLACE_KINDS: ['home', 'school', 'gym', 'other', 'unknown'],
  isPlaceKind: (v: unknown) => typeof v === 'string' && ['home', 'school', 'gym', 'other', 'unknown'].includes(v),
  listPanelPlaces: async () => h.places,
  namePlace: async (id: string, label: string, kind: string) => {
    h.log.push('name');
    h.named.push([id, label, kind]);
    return { id };
  },
  confirmPlace: async (id: string, label: string, kind: string) => {
    h.log.push('memory');
    if (h.failRename) throw new Error('Cannot replace a memory in another scope');
    h.renames.push([id, label, kind]);
    return { memoryId: 'm', thoughtsResolved: 0 };
  },
  updatePlaceAlerts: async (id: string, patch: Record<string, unknown>) => {
    h.log.push('row');
    h.updates.push([id, patch]);
    return { id };
  },
  updatePlaceGeometry: async (id: string, geo: Record<string, unknown>) => {
    h.log.push('row');
    h.moves.push([id, geo]);
    return { id };
  },
  ignorePlace: async (id: string) => {
    h.ignored.push(id);
  },
  createPlace: async (input: Record<string, unknown>) => {
    h.creates.push(input);
    return { id: 'new-place' };
  },
}));

const { actions, load } = await import('./+page.server');
const { DEFAULT_WINDOW_DAYS } = await import('$lib/home/presence/stats');

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
  h.named = [];
  h.log = [];
  h.moves = [];
  h.creates = [];
  h.ignored = [];
  h.placeTimeCalls = [];
  h.failRename = false;
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

  it('refuses a non-owner move, create or notify and writes nothing', async () => {
    const geo = { placeId: 'school', lat: '51.5', lon: '-0.1', radiusM: '200' };
    for (const [name, fields] of [
      ['move', geo],
      ['create', { label: 'Club', kind: 'gym', lat: '51.5', lon: '-0.1', radiusM: '150' }],
      ['notify', { placeId: 'school', alerts: 'on', alertArrive: 'on' }],
      ['remove', { placeId: 'school' }],
    ] as const) {
      const res = (await actions[name](eventFor('sam@example.test', fields))) as { status: number };
      expect(res.status).toBe(403);
    }
    expect([h.updates, h.moves, h.creates, h.renames, h.ignored]).toEqual([[], [], [], [], []]);
  });

  it('refuses a non-owner load, and never reads anyone’s place time for it', async () => {
    await expect(load(eventFor(null) as unknown as Parameters<typeof load>[0])).rejects.toMatchObject({ status: 403 });
    await expect(load(eventFor('sam@example.test') as unknown as Parameters<typeof load>[0])).rejects.toMatchObject({ status: 403 });
    expect(h.placeTimeCalls).toEqual([]);
  });

  it('streams the owner the time per place for every member', async () => {
    const data = (await load(eventFor('owner@example.test') as unknown as Parameters<typeof load>[0])) as {
      placeTime: Promise<unknown>;
    };
    expect(data.placeTime).toBeInstanceOf(Promise);
    expect(await data.placeTime).toMatchObject({ school: [{ subject: 'sam', minutes: 90 }] });
    expect(h.placeTimeCalls).toEqual([
      [
        [
          { subject: 'alex', displayName: 'Alex' },
          { subject: 'sam', displayName: 'Sam' },
        ],
        { days: DEFAULT_WINDOW_DAYS },
      ],
    ]);
  });
});

describe('/home/people/places — remove', () => {
  it('ignores the place (no hard delete) and says which', async () => {
    const res = await actions.remove(eventFor('owner@example.test', { placeId: 'school' }));
    expect(res).toEqual({ removed: 'school', removedLabel: 'School' });
    expect(h.ignored).toEqual(['school']);
  });

  it('refuses home with a 400', async () => {
    const res = (await actions.remove(eventFor('owner@example.test', { placeId: 'home' }))) as { status: number };
    expect(res.status).toBe(400);
    expect(h.ignored).toEqual([]);
  });

  it('refuses a place that is not on the panel', async () => {
    const res = (await actions.remove(eventFor('owner@example.test', { placeId: 'elsewhere' }))) as { status: number };
    expect(res.status).toBe(404);
    expect(h.ignored).toEqual([]);
  });
});

describe('/home/people/places — save (name and edge)', () => {
  it('renames through confirmPlace and pins a changed radius', async () => {
    const res = await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'Big School', radiusM: '300' }));
    expect(res).toEqual({ saved: 'school' });
    expect(h.renames).toEqual([['school', 'Big School', 'school']]);
    expect(h.updates).toEqual([['school', { radiusM: 300 }]]);
  });

  it('saves the row BEFORE touching memory', async () => {
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'Big School', radiusM: '300' }));
    expect(h.log).toEqual(['row', 'name', 'memory']);
    expect(h.named).toEqual([['school', 'Big School', 'school']]);
  });

  it('never touches memory for a radius-only or centre-only save', async () => {
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM: '300' }));
    await actions.save(
      eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM: '150', lat: '51.501', lon: '-0.1' }),
    );
    expect(h.renames).toEqual([]);
    expect(h.named).toEqual([]);
    expect(h.log).toEqual(['row', 'row']);
  });

  it('renames through confirmPlace when only the kind changed', async () => {
    const res = await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', kind: 'gym', radiusM: '150' }));
    expect(res).toEqual({ saved: 'school' });
    expect(h.renames).toEqual([['school', 'School', 'gym']]);
  });

  it('is not a rename when a stored kind outside the picker meets a radius-only save', async () => {
    h.places[1] = { ...h.places[1], kind: 'unknown' };
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', kind: 'unknown', radiusM: '300' }));
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM: '300' }));
    expect(h.renames).toEqual([]);
  });

  it('keeps the kind when the form sends none, or sends "unknown"', async () => {
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'New', radiusM: '150' }));
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'Newer', kind: 'unknown', radiusM: '150' }));
    expect(h.renames.map((r) => r[2])).toEqual(['school', 'school']);
  });

  it('still saves when the memory write fails, with a soft note (not "try again")', async () => {
    h.failRename = true;
    const res = await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'Big School', radiusM: '300' }));
    expect(res).toEqual({ saved: 'school', note: "Saved; couldn't update jkai's memory of this place." });
    expect(h.updates).toEqual([['school', { radiusM: 300 }]]);
    expect(h.named).toEqual([['school', 'Big School', 'school']]);
  });

  it('writes nothing when neither name nor radius changed', async () => {
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM: '150' }));
    expect([h.renames, h.updates, h.moves]).toEqual([[], [], []]);
  });

  it('saves a moved centre as geometry, which pins the place', async () => {
    await actions.save(
      eventFor('owner@example.test', { placeId: 'school', label: 'School', radiusM: '150', lat: '51.501', lon: '-0.1' }),
    );
    expect(h.moves).toEqual([['school', { lat: 51.501, lon: -0.1, radiusM: 150 }]]);
    expect(h.updates).toEqual([]);
  });

  it('holds a rename to the same 60-character limit as a new place', async () => {
    const res = (await actions.save(
      eventFor('owner@example.test', { placeId: 'school', label: 'x'.repeat(61), radiusM: '150' }),
    )) as { status: number };
    expect(res.status).toBe(400);
    await actions.save(eventFor('owner@example.test', { placeId: 'school', label: 'y'.repeat(60), radiusM: '150' }));
    expect(h.renames).toEqual([['school', 'y'.repeat(60), 'school']]);
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
});

describe('/home/people/places — move (the map)', () => {
  it('writes the dragged centre and radius', async () => {
    const res = await actions.move(eventFor('owner@example.test', { placeId: 'school', lat: '51.5', lon: '-0.1', radiusM: '420' }));
    expect(res).toEqual({ moved: 'school' });
    expect(h.moves).toEqual([['school', { lat: 51.5, lon: -0.1, radiusM: 420 }]]);
  });

  it('refuses a point off the globe or a radius out of range', async () => {
    for (const bad of [
      { lat: '91', lon: '-0.1', radiusM: '200' },
      { lat: '51.5', lon: '-181', radiusM: '200' },
      { lat: '', lon: '-0.1', radiusM: '200' },
      { lat: '51.5', lon: '-0.1', radiusM: '2001' },
      { lat: '51.5', lon: '-0.1', radiusM: '49' },
    ]) {
      const res = (await actions.move(eventFor('owner@example.test', { placeId: 'school', ...bad }))) as { status: number };
      expect(res.status).toBe(400);
    }
    expect(h.moves).toEqual([]);
  });

  it('refuses a place that is not on the panel', async () => {
    const res = (await actions.move(eventFor('owner@example.test', { placeId: 'elsewhere', lat: '51.5', lon: '-0.1', radiusM: '200' }))) as {
      status: number;
    };
    expect(res.status).toBe(404);
  });
});

describe('/home/people/places — create (the map)', () => {
  const fields = { label: 'Club', kind: 'gym', lat: '51.5', lon: '-0.1', radiusM: '150' };

  it('creates a named place and writes the name to memory', async () => {
    const res = await actions.create(eventFor('owner@example.test', fields));
    expect(res).toEqual({ created: 'new-place' });
    expect(h.creates).toEqual([{ label: 'Club', kind: 'gym', lat: 51.5, lon: -0.1, radiusM: 150 }]);
    expect(h.renames).toEqual([['new-place', 'Club', 'gym']]);
  });

  it('defaults an unknown kind to other', async () => {
    await actions.create(eventFor('owner@example.test', { ...fields, kind: 'castle' }));
    expect(h.creates[0].kind).toBe('other');
  });

  it('needs a name of 1–60 characters and valid geometry', async () => {
    for (const bad of [{ label: '  ' }, { label: 'x'.repeat(61) }, { lat: '-91' }, { lon: '200' }, { radiusM: '10' }]) {
      const res = (await actions.create(eventFor('owner@example.test', { ...fields, ...bad }))) as { status: number };
      expect(res.status).toBe(400);
    }
    expect(h.creates).toEqual([]);
  });

  it('keeps the place if only the memory write fails', async () => {
    h.failRename = true;
    expect(await actions.create(eventFor('owner@example.test', fields))).toEqual({ created: 'new-place' });
    expect(h.creates).toHaveLength(1);
  });
});

describe('/home/people/places — notify', () => {
  it('sets the master switch, both directions and WhatsApp', async () => {
    const res = await actions.notify(
      eventFor('owner@example.test', { placeId: 'school', alerts: 'on', alertArrive: 'on', whatsappAlerts: 'on' }),
    );
    expect(res).toEqual({ notified: 'school' });
    expect(h.updates).toEqual([['school', { alerts: true, alertArrive: true, alertLeave: false, whatsappAlerts: true }]]);
  });

  it('never turns alerts on for WhatsApp: WhatsApp without the master switch is dropped', async () => {
    await actions.notify(eventFor('owner@example.test', { placeId: 'school', whatsappAlerts: 'on', alertArrive: 'on', alertLeave: 'on' }));
    expect(h.updates[0][1]).toMatchObject({ alerts: false, whatsappAlerts: false });
  });

  it('treats home like any place: off unless its switch is on', async () => {
    await actions.notify(eventFor('owner@example.test', { placeId: 'home', alertLeave: 'on' }));
    await actions.notify(eventFor('owner@example.test', { placeId: 'home', alerts: 'on', alertArrive: 'on', alertLeave: 'on' }));
    expect(h.updates).toEqual([
      ['home', { alerts: false, alertArrive: false, alertLeave: true, whatsappAlerts: false }],
      ['home', { alerts: true, alertArrive: true, alertLeave: true, whatsappAlerts: false }],
    ]);
  });

  it('refuses a place that is not on the panel', async () => {
    const res = (await actions.notify(eventFor('owner@example.test', { placeId: 'elsewhere', alerts: 'on' }))) as { status: number };
    expect(res.status).toBe(404);
  });
});
