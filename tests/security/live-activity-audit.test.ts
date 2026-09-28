// Regression: a known journey ID does not create a viewer relationship.
import { describe, it, expect, vi } from 'vitest';
const h = vi.hoisted(() => ({ inserted: [] as unknown[] }));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.test' } }));
vi.mock('$lib/db', () => ({ db: {
  select: () => { const c: Record<string, unknown> = {}; for (const k of ['from','innerJoin','where']) c[k]=()=>c; c.limit=async()=>[]; return c; },
  insert: () => ({ values: (value: unknown) => { h.inserted.push(value); return { onConflictDoUpdate: async () => {} }; } }),
} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => ({ id: 'friend-device', ownerEmail: 'friend@example.test', label: 'Synthetic', expiresAt: new Date(Date.now()+60000) }),
  touchDevice: async () => {},
}));
vi.mock('$lib/server/grants', () => ({ loadMember: async () => ({ principalId: 'u_friend', grants: new Set(['news:self']) }) }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null, setSetting: async () => {} }));
vi.mock('$lib/server/push-devices', () => ({
  pushToEmails: async () => ({ reached: new Set(), sent: 0, failed: 0 }),
  clearPushToken: async () => {}, registerPushToken: async () => {}, pushTestTo: async () => null,
}));
const { POST } = await import('../../src/routes/api/native/push/+server');
describe('Live Activity authorisation boundary', () => {
  it('rejects a news-only member trying to subscribe to a known family journey', async () => {
    const url = new URL('https://example.test/api/native/push');
    const request = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic' },
      body: JSON.stringify({ journeyId: 'known-family-journey', activityToken: 'a'.repeat(64) }) });
    const response = await POST({ request, url, locals: { auth: async () => null } } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false });
    expect(h.inserted).toEqual([]);
  });
});
