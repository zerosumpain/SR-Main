import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ env: { POLICY_LAB_ENABLED: '1' } }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (email: string) => email === 'owner@example.test' }));
import { requireLabOwner } from '$lib/policy-incentives-lab/server/access';
const locals = (email?: string) => ({ auth: async () => email ? { user: { email } } : null }) as App.Locals;
beforeEach(() => { state.env.POLICY_LAB_ENABLED = '1'; });
it('refuses anonymous and guest requests even in development', async () => {
  await expect(requireLabOwner(locals())).rejects.toMatchObject({ status: 403 });
  await expect(requireLabOwner(locals('guest@example.test'))).rejects.toMatchObject({ status: 403 });
});
it('accepts only the configured owner and honours the kill switch', async () => {
  expect(await requireLabOwner(locals('owner@example.test'))).toBe('owner@example.test');
  state.env.POLICY_LAB_ENABLED = '0';
  await expect(requireLabOwner(locals('owner@example.test'))).rejects.toMatchObject({ status: 404 });
});
