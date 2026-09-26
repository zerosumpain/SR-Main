import { beforeEach, describe, expect, it, vi } from 'vitest';

// The REAL actions with a faked `locals`; the owner check is real too, only
// the modules that would reach a database are faked. Numbers are fake.
vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (email: string | null | undefined) => (email ?? '').toLowerCase() === 'owner@example.test',
}));
vi.mock('$lib/db', () => ({ db: {} }));

const h = vi.hoisted(() => ({
  members: [] as Array<Record<string, unknown>>,
  updates: [] as Array<[string, Record<string, unknown>]>,
  settings: [] as Array<[string, unknown]>,
}));

vi.mock('$lib/server/models/settings', () => ({
  getSetting: async () => null,
  setSetting: async (k: string, v: unknown) => {
    h.settings.push([k, v]);
  },
}));
vi.mock('$lib/home/presence/members', () => ({
  MEMBER_SOURCES: ['life360', 'companion', 'none'],
  listMembers: async () => h.members,
  updateMember: async (subject: string, patch: Record<string, unknown>) => {
    h.updates.push([subject, patch]);
    return { subject, ...patch };
  },
}));

const { actions, load } = await import('./+page.server');

function member(subject: string, source: string) {
  return { subject, email: `${subject}@example.test`, displayName: subject, source, haPersonEntity: null, whatsapp: null, alerts: {} };
}

function eventFor(email: string | null, fields: Record<string, string | string[]> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) form.append(k, one);
  }
  return {
    locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
    getClientAddress: () => '203.0.113.9',
    request: new Request('http://x/home/people/settings?/save', { method: 'POST', body: form }),
    setHeaders: () => {},
    params: {},
  } as unknown as Parameters<typeof actions.save>[0];
}

const base = {
  subject: 'sam',
  displayName: 'Sam',
  email: 'sam@example.test',
  source: 'life360',
  whatsapp: '',
};

beforeEach(() => {
  h.members = [member('sam', 'life360'), member('alex', 'companion'), member('robin', 'life360')];
  h.updates = [];
  h.settings = [];
});

describe('/home/people/settings — owner only', () => {
  it('refuses a non-owner action and writes nothing', async () => {
    const res = (await actions.save(eventFor('sam@example.test', base))) as { status: number };
    expect(res.status).toBe(403);
    expect(h.updates).toEqual([]);
    expect(h.settings).toEqual([]);
  });

  it('refuses a signed-out action', async () => {
    const res = (await actions.save(eventFor(null, base))) as { status: number };
    expect(res.status).toBe(403);
    expect(h.updates).toEqual([]);
  });

  it('refuses a non-owner load', async () => {
    await expect(load(eventFor('sam@example.test') as unknown as Parameters<typeof load>[0])).rejects.toMatchObject({ status: 403 });
  });
});

describe('/home/people/settings — save', () => {
  it('saves the owner edit: follow list, WhatsApp number and switch', async () => {
    const res = await actions.save(
      eventFor('owner@example.test', { ...base, whatsapp: '+44 0000 000000', whatsappOn: 'on', follow: ['alex', 'nobody'] }),
    );
    expect(res).toEqual({ saved: 'sam' });
    expect(h.updates).toEqual([
      [
        'sam',
        {
          displayName: 'Sam',
          email: 'sam@example.test',
          source: 'life360',
          whatsapp: '+440000000000',
          alerts: { follow: ['alex'], whatsapp: true },
        },
      ],
    ]);
  });

  it('stores no follow list for "everyone"', async () => {
    await actions.save(eventFor('owner@example.test', { ...base, followAll: 'on', follow: ['alex'] }));
    expect(h.updates[0][1].alerts).toEqual({ whatsapp: false });
  });

  it('resets the companion cursor when someone moves onto the app', async () => {
    await actions.save(eventFor('owner@example.test', { ...base, source: 'companion' }));
    expect(h.settings).toEqual([['home.presence.companionCursor', '']]);
  });

  it('leaves the cursor alone for any other edit', async () => {
    await actions.save(eventFor('owner@example.test', { ...base, displayName: 'Samuel' }));
    await actions.save(eventFor('owner@example.test', { ...base, subject: 'alex', source: 'companion', email: 'alex@example.test' }));
    await actions.save(eventFor('owner@example.test', { ...base, source: 'none' }));
    expect(h.updates).toHaveLength(3);
    expect(h.settings).toEqual([]);
  });

  it('rejects a bad number, source or missing app email', async () => {
    const bad = [
      { ...base, whatsapp: '12' },
      { ...base, source: 'carrier-pigeon' },
      { ...base, source: 'companion', email: '' },
    ];
    for (const fields of bad) {
      const res = (await actions.save(eventFor('owner@example.test', fields))) as { status: number };
      expect(res.status).toBe(400);
    }
    expect(h.updates).toEqual([]);
  });
});
