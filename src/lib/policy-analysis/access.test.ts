import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/server/access', () => ({ getOwnerEmails: () => ['one@example.test', 'two@example.test'], isOwnerEmail: (email: string) => ['one@example.test', 'two@example.test'].includes(email) }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));
import { checkMutation, requirePolicyOwner, failure } from './server/access';
import { PolicyError } from './validation';
const event = (email: string | null) => ({ locals: { auth: vi.fn(async () => email ? { user: { email } } : null) }, getClientAddress: () => '203.0.113.1', setHeaders: vi.fn() }) as unknown as Parameters<typeof requirePolicyOwner>[0];
describe('private policy access', () => {
  it('requires a signed-in site owner', async () => {
    await expect(requirePolicyOwner(event(null))).rejects.toMatchObject({ status: 401 });
    await expect(requirePolicyOwner(event('guest@example.test'))).rejects.toMatchObject({ status: 403 });
    const owner = event('ONE@example.test');
    expect(await requirePolicyOwner(owner)).toBe('one@example.test');
    expect(owner.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
  });
  it('rejects cross-origin mutations and never exposes raw errors', async () => {
    expect(() => checkMutation({ request: new Request('https://strangeramblings.com/api/policy-analysis', { method: 'POST', headers: { origin: 'https://attacker.test' } }), url: new URL('https://strangeramblings.com') }, 'one@example.test')).toThrow();
    expect(await failure(new Error('secret provider credential')).text()).not.toContain('secret');
    expect(failure(new PolicyError('missing', 'Analysis not found.')).status).toBe(404);
  });
});
