import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ allowed: true, sharing: true, usersAvailable: true, following: true, removed: false }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/family-access', () => ({ familyRole: async () => h.allowed ? { parent: false } : null }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (email: string) => email === 'owner@example.test' }));
vi.mock('$lib/home/presence/members', async original => ({ ...await original<typeof import('$lib/home/presence/members')>(), listMembers: async () => h.removed ? [] : [
  { subject: 'mover', email: 'mover@example.test', source: 'companion', alerts: {} },
  { subject: 'viewer', email: 'viewer@example.test', source: 'companion', alerts: { follow: h.following ? ['mover'] : [] } },
] }));
vi.mock('$lib/home/presence/companion', async original => ({
  ...await original<typeof import('$lib/home/presence/companion')>(),
  loadCompanionUsers: async () => h.usersAvailable ? [{ email: 'mover@example.test', sharing: h.sharing }] : null,
}));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null, setSetting: async () => {} }));
const { journeyAccess, TEST_SUBJECT } = await import('$lib/home/presence/live-journey');
beforeEach(() => Object.assign(h, { allowed: true, sharing: true, usersAvailable: true, following: true, removed: false }));
describe('Live Activity delivery rechecks current permission and consent', () => {
  it('allows an eligible follower', async () => expect(await journeyAccess('mover','viewer@example.test')).toBe(true));
  for (const field of ['allowed','sharing','usersAvailable','following'] as const) {
    it(`suppresses state when ${field} is false`, async () => {
      h[field] = false;
      expect(await journeyAccess('mover','viewer@example.test')).toBe(false);
    });
  }
  it('suppresses a removed mover', async () => { h.removed=true; expect(await journeyAccess('mover','viewer@example.test')).toBe(false); });
  it('keeps synthetic test journeys owner-only', async () => {
    expect(await journeyAccess(TEST_SUBJECT,'viewer@example.test')).toBe(false);
    expect(await journeyAccess(TEST_SUBJECT,'owner@example.test')).toBe(true);
  });
});
