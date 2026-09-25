import { describe, expect, it, vi, beforeEach } from 'vitest';

// The seam's decision table, with the session and the member lookup faked:
// which scope each kind of request gets. The database half — that a real member
// row resolves to its principal — is members.integration.test.ts.
const memberPrincipalFor = vi.fn<(email: string | null | undefined) => Promise<string | null>>();
vi.mock('$lib/server/members', () => ({ memberPrincipalFor: (e: string) => memberPrincipalFor(e) }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => e === 'owner@example.com' }));
vi.mock('$lib/db', () => ({ db: {} }));

const { resolveRequestScope, scopeForPrincipal } = await import('./scope.server');
const { OWNER_INTEL_SCOPE } = await import('./scope');

function event(email: string | null) {
  return { locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals };
}

describe('resolveRequestScope', () => {
  beforeEach(() => {
    memberPrincipalFor.mockReset();
    memberPrincipalFor.mockResolvedValue(null);
  });

  it("gives the owner the owner's scope without asking the database", async () => {
    expect(await resolveRequestScope(event('owner@example.com'))).toBe(OWNER_INTEL_SCOPE);
    expect(memberPrincipalFor).not.toHaveBeenCalled();
  });

  it('gives a member their own space then household', async () => {
    memberPrincipalFor.mockResolvedValue('u_abc');
    expect([...(await resolveRequestScope(event('kid@example.com')))]).toEqual(['u_abc', 'household']);
  });

  it('treats a sessionless request as an owner-grade lane (maintenance secret, service token)', async () => {
    expect(await resolveRequestScope(event(null))).toBe(OWNER_INTEL_SCOPE);
  });

  it('refuses a signed-in guest outright, whatever the hook decided', async () => {
    await expect(resolveRequestScope(event('guest@example.com'))).rejects.toMatchObject({ status: 403 });
  });

  it('asks once per request', async () => {
    memberPrincipalFor.mockResolvedValue('u_abc');
    const e = event('kid@example.com');
    await resolveRequestScope(e);
    await resolveRequestScope(e);
    expect(memberPrincipalFor).toHaveBeenCalledTimes(1);
  });

  it("puts the member's own space first, so writeSpace is theirs", () => {
    expect(scopeForPrincipal('u_x')[0]).toBe('u_x');
  });
});
