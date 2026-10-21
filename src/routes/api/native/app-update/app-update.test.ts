import { describe, expect, it, vi } from 'vitest';

// The update check an /app copy of the iPhone app makes: answered only for a
// paired phone, because the answer carries the install link.

const h = vi.hoisted(() => ({ paired: true, build: true as boolean, touched: [] as [string, string | null][] }));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: 'app-update-secret'.padEnd(40, 'x') } }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => (h.paired ? { id: 'cred-1', ownerEmail: 'rory@example.test' } : null),
  touchDevice: async (id: string, request?: Request) => {
    h.touched.push([id, request?.headers.get('x-sr-app') ?? null]);
  },
}));
vi.mock('$lib/github/app-release', () => ({
  releasedAdhocBuild: async () =>
    h.build ? { version: '0.1.121', build: '121', commit: 'abc', builtAt: '2026-10-20T08:00:00Z', devices: [], bundleId: 'b', ipaAssetId: 1, ipaBytes: 1 } : null,
}));

const { GET } = await import('./+server');

const call = async (headers: Record<string, string> = {}) => {
  const res = await GET({ request: new Request('https://strangeramblings.com/api/native/app-update', { headers }), url: new URL('https://strangeramblings.com/api/native/app-update') } as never);
  return { status: res.status, body: await res.json() };
};

describe('/api/native/app-update', () => {
  it('refuses a phone that is not paired', async () => {
    h.paired = false;
    expect((await call()).status).toBe(401);
    h.paired = true;
  });

  it('names the newest copy and how to install it', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.build).toMatchObject({ version: '0.1.121', build: '121', commit: 'abc' });
    expect(body.build.install).toMatch(/^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2Fstrangeramblings\.com%2Finstall%2F/);
  });

  it('answers no build, not an error, when there is none', async () => {
    h.build = false;
    expect((await call()).body).toEqual({ build: null });
  });

  it('records the phone that asked, headers and all — this is the call every copy makes', async () => {
    h.touched.length = 0;
    await call({ 'X-SR-App': '0.1.136/136/68136470' });
    expect(h.touched).toEqual([['cred-1', '0.1.136/136/68136470']]);
  });
});
