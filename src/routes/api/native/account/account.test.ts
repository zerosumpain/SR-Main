import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string },
  outcome: { ok: true, email: 'member@example.test', rows: {}, pilot: {}, warnings: [] } as Record<string, unknown>,
  erased: [] as string[],
}));

vi.mock('$lib/server/native-auth', () => ({ identifyDevice: async () => h.identity }));
vi.mock('$lib/server/native-handler', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/native-gate', () => ({ VIEW_AS_HEADER: 'x-sr-view-as' }));
vi.mock('$lib/people/erase', () => ({
  OWNER_REFUSAL: 'The owner account is managed on the website, not from the app.',
  eraseAccount: async (email: string) => {
    h.erased.push(email);
    return h.outcome;
  },
}));

const { DELETE } = await import('./+server');

function call(headers: Record<string, string> = {}) {
  const request = new Request('https://strangeramblings.com/api/native/account', { method: 'DELETE', headers });
  return (DELETE as unknown as (e: unknown) => Promise<Response>)({ request });
}

beforeEach(() => {
  h.identity = { id: 'd1', ownerEmail: 'member@example.test' };
  h.outcome = { ok: true, email: 'member@example.test', rows: {}, pilot: {}, warnings: [] };
  h.erased = [];
});

describe('DELETE /api/native/account', () => {
  it('deletes the phone’s own person', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, warnings: [] });
    expect(h.erased).toEqual(['member@example.test']);
  });

  it('refuses the owner’s phone', async () => {
    h.identity = { id: 'd0', ownerEmail: 'owner@example.test' };
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/managed on the website/);
    expect(h.erased).toEqual([]);
  });

  it('refuses while viewing as someone, whoever the phone is', async () => {
    for (const ownerEmail of ['owner@example.test', 'member@example.test']) {
      h.identity = { id: 'd', ownerEmail };
      const res = await call({ 'x-sr-view-as': 'member@example.test' });
      expect(res.status).toBe(403);
    }
    expect(h.erased).toEqual([]);
  });

  it('is a 404 for a phone whose person has no account', async () => {
    h.outcome = { ok: false, status: 404, error: 'There is no account here to delete.' };
    const res = await call();
    expect(res.status).toBe(404);
  });

  it('passes a companion-server failure through', async () => {
    h.outcome = { ok: false, status: 502, error: 'Nothing was deleted.' };
    expect((await call()).status).toBe(502);
  });

  it('is a 401 for an unpaired phone', async () => {
    h.identity = null;
    expect((await call()).status).toBe(401);
    expect(h.erased).toEqual([]);
  });
});
