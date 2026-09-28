import { expect, it, vi } from 'vitest';
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async (e: { owner?: boolean }) => e.owner === true }));
const h = vi.hoisted(() => ({ read: vi.fn(async () => ({ generatedAt: '2026-09-28', people: [] })) }));
vi.mock('$lib/home/presence/insights.server', () => ({ insightMembers: async () => [{ subject: 'alex', displayName: 'Alex' }], loadPresenceInsights: h.read }));
const { load } = await import('./+page.server');
const event = (owner = false, query = '') => ({ owner, url: new URL(`https://example.test/home/people/insights${query}`), setHeaders: vi.fn(), depends: vi.fn() }) as unknown as Parameters<typeof load>[0];
it('refuses unauthorized readers before analysis', async () => {
  h.read.mockClear(); await expect(load(event())).rejects.toMatchObject({ status: 403 }); expect(h.read).not.toHaveBeenCalled();
});
it('bounds history and excludes unknown subjects from filters', async () => {
  const e = event(true, '?days=99999&person=unknown');
  await load(e); expect(h.read).toHaveBeenLastCalledWith({ kind: 'owner' }, 28, null); expect(e.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
  await load(event(true, '?days=7&person=alex')); expect(h.read).toHaveBeenLastCalledWith({ kind: 'owner' }, 7, 'alex');
});
