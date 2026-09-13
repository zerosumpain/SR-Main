import { beforeEach, describe, expect, it, vi } from 'vitest';

// The credential store is mocked: what matters here is the GATE, not the query.
// This route is public, so the one thing it must never do is hand out a secret
// key because somebody pasted one into the wrong credential field.
const store = vi.hoisted(() => ({ list: [] as unknown[], credential: null as unknown }));

vi.mock('$lib/integrations/credentials', () => ({
  listCredentials: async () => store.list,
  getCredential: async () => store.credential,
}));

const { GET, isMapboxPublicToken, mapboxConfig } = await import('./+server');

const cred = (key: string, over: Record<string, unknown> = {}) => ({
  id: 'c1',
  integrationType: 'mapbox',
  kind: 'apikey',
  payload: { key },
  ...over,
});

beforeEach(() => {
  store.list = [{ id: 'c1', createdAt: new Date('2026-09-06') }];
  store.credential = cred('pk.eyJ1IjoiZXhhbXBsZSJ9.aaaaaaaaaaaaaaaaaaaaaa');
});

describe('isMapboxPublicToken', () => {
  it('accepts a browser token and refuses everything else', () => {
    expect(isMapboxPublicToken('pk.eyJ1IjoieCJ9.aaaaaaaa')).toBe(true);
    // A SECRET key. This is the whole reason the route can be public at all.
    expect(isMapboxPublicToken('sk.eyJ1IjoieCJ9.aaaaaaaa')).toBe(false);
    expect(isMapboxPublicToken('pk.nodothere')).toBe(false);
    expect(isMapboxPublicToken('')).toBe(false);
    expect(isMapboxPublicToken(undefined)).toBe(false);
  });
});

describe('GET /api/maps/config', () => {
  it('serves the public token and a style, and nothing else', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'style']);
    expect(body.accessToken.startsWith('pk.')).toBe(true);
    // Never cached by a shared cache: it is a credential, however public.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('refuses to serve a SECRET key, and says how to fix it', async () => {
    store.credential = cred('sk.eyJ1IjoieCJ9.aaaaaaaa');
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty('accessToken');
  });

  it('refuses a credential of the wrong kind or integration', async () => {
    store.credential = cred('pk.eyJ1IjoieCJ9.aaaaaaaa', { integrationType: 'strava' });
    expect(await mapboxConfig()).toBeNull();
    store.credential = cred('pk.eyJ1IjoieCJ9.aaaaaaaa', { kind: 'oauth' });
    expect(await mapboxConfig()).toBeNull();
  });

  it('asks for a token rather than failing when there is none', async () => {
    store.list = [];
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).message).toContain('Admin → Connections → Credentials');
  });

  it('takes the NEWEST credential, which is how the token rotates', async () => {
    const seen: string[] = [];
    store.list = [
      { id: 'old', createdAt: new Date('2026-01-01') },
      { id: 'new', createdAt: new Date('2026-09-06') },
    ];
    vi.resetModules();
    vi.doMock('$lib/integrations/credentials', () => ({
      listCredentials: async () => store.list,
      getCredential: async (id: string) => {
        seen.push(id);
        return cred('pk.eyJ1IjoieCJ9.aaaaaaaa');
      },
    }));
    const fresh = await import('./+server');
    await fresh.mapboxConfig();
    expect(seen).toEqual(['new']);
  });
});
