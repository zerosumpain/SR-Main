import { describe, expect, it, vi } from 'vitest';

// Release to the family from the owner's phone: the same record and copies as
// /admin/access/app#releases. The owner-only gate is `withDevice`'s own
// (native-auth.test.ts checks every route has one); here, what it answers.

const h = vi.hoisted(() => ({ released: [] as [number, string | null][], refuse: false }));

vi.mock('$lib/server/native-handler', () => ({
  withDevice: (handler: (event: unknown, identity: unknown) => unknown) => async (event: unknown) => {
    const result = await handler(event, { id: 'cred-1', ownerEmail: 'Owner@Example.test' });
    return result instanceof Response ? result : Response.json(result);
  },
}));
vi.mock('$lib/github/adhoc-builds', () => ({
  listAdhocDrafts: async () => [
    { run: 175, commit: 'c175', createdAt: '2026-10-27T18:00:00Z' },
    { run: 173, commit: 'c173', createdAt: '2026-10-27T10:16:03Z' },
  ],
  adhocBuildOf: async (d: { run: number }) => ({ version: `0.1.${d.run}`, builtAt: '2026-10-27T18:00:00Z' }),
  latestTestFlightRun: async () => ({ build: 176, commit: 'c176', at: '2026-10-27T19:00:00Z', branch: 'feat/x' }),
}));
vi.mock('$lib/github/app-release', () => ({
  currentRelease: async () => ({ build: 173, commit: 'c173', at: '2026-10-27T11:00:00Z', by: 'owner@example.test', history: [] }),
  chooseReleased: (drafts: { run: number }[]) => drafts.find((d) => d.run === 173) ?? null,
  buildState: (d: { run: number }) => (d.run === 173 ? 'released' : d.run > 173 ? 'waiting' : 'older'),
  releaseBuild: async (run: number, by: string | null) => {
    if (h.refuse) return { ok: false, error: 'GitHub no longer holds build 99.' };
    h.released.push([run, by]);
    return { ok: true, release: { build: run, commit: `c${run}`, at: '2026-10-27T20:00:00Z', by, history: [] } };
  },
}));

const { GET, POST } = await import('./+server');

const post = async (body: unknown) => {
  const res = await POST({ request: new Request('https://x.test/api/native/app-release', { method: 'POST', body: JSON.stringify(body) }) } as never);
  return { status: res.status, body: await res.json() };
};

describe('/api/native/app-release', () => {
  it('lists what the family are offered and every copy, with its state', async () => {
    const res = await GET({ request: new Request('https://x.test/api/native/app-release') } as never);
    const body = await res.json();
    expect(body.release).toEqual({ build: 173, commit: 'c173', at: '2026-10-27T11:00:00Z', by: 'owner@example.test' });
    expect(body.offered).toBe(173);
    expect(body.builds.map((b: { run: number; state: string }) => [b.run, b.state])).toEqual([[175, 'waiting'], [173, 'released']]);
    expect(body.builds[0].version).toBe('0.1.175');
    expect(body.testflight.build).toBe(176);
  });

  it('releases a build as the owner, as the page does', async () => {
    const { status, body } = await post({ build: 175 });
    expect(status).toBe(200);
    expect(body.released).toBe(175);
    expect(h.released.at(-1)).toEqual([175, 'owner@example.test']);
  });

  it('refuses a build that is not a number', async () => {
    expect((await post({ build: 'latest' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it('says why a release could not be made', async () => {
    h.refuse = true;
    const { status, body } = await post({ build: 99 });
    h.refuse = false;
    expect(status).toBe(400);
    expect(body.error).toMatch(/no longer holds/);
  });
});
