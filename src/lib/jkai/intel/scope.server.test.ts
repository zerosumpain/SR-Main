import { describe, expect, it, vi, beforeEach } from 'vitest';

// The seam's decision table, with the session and the member lookup faked:
// which scope each kind of request gets. The database half — that a real member
// row resolves to its principal — is members.integration.test.ts.
type Member = { principalId: string; grants: Set<string> } | null;
const loadMember = vi.fn<(email: string | null | undefined) => Promise<Member>>();
vi.mock('$lib/server/grants', () => ({ loadMember: (e: string) => loadMember(e) }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => e === 'owner@example.com' }));
// The other members' spaces, for an `all` reader.
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ id: 'u_other' }] }) }),
  },
}));
const member = (...grants: string[]): Member => ({ principalId: 'u_abc', grants: new Set(grants) });

const { resolveRequestScope, scopeForPrincipal } = await import('./scope.server');
const { OWNER_INTEL_SCOPE } = await import('./scope');

function event(email: string | null) {
  return { locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals };
}

describe('resolveRequestScope', () => {
  beforeEach(() => {
    loadMember.mockReset();
    loadMember.mockResolvedValue(null);
  });

  it("gives the owner the owner's scope without asking the database", async () => {
    expect(await resolveRequestScope(event('owner@example.com'))).toBe(OWNER_INTEL_SCOPE);
    expect(loadMember).not.toHaveBeenCalled();
  });

  it('gives a member their own space then household', async () => {
    loadMember.mockResolvedValue(member('jkai.intel:self'));
    expect([...(await resolveRequestScope(event('kid@example.com')))]).toEqual(['u_abc', 'household']);
  });

  it("gives an `all` reader every member's space, never the owner's, and writes only their own", async () => {
    loadMember.mockResolvedValue(member('jkai.intel:all'));
    expect([...(await resolveRequestScope(event('kid@example.com')))]).toEqual(['u_abc', 'household', 'u_other']);
    expect([...(await resolveRequestScope(event('kid2@example.com'), 'write'))]).toEqual(['u_abc', 'household']);
  });

  it('lets an `admin` act across every member space', async () => {
    loadMember.mockResolvedValue(member('jkai.intel:admin'));
    expect([...(await resolveRequestScope(event('kid@example.com'), 'write'))]).toEqual(['u_abc', 'household', 'u_other']);
  });

  it('refuses a member who holds no intel level', async () => {
    loadMember.mockResolvedValue(member('family:circle'));
    await expect(resolveRequestScope(event('kid@example.com'))).rejects.toMatchObject({ status: 403 });
  });

  it('treats a sessionless request as an owner-grade lane (maintenance secret, service token)', async () => {
    expect(await resolveRequestScope(event(null))).toBe(OWNER_INTEL_SCOPE);
  });

  it('refuses a signed-in guest outright, whatever the hook decided', async () => {
    await expect(resolveRequestScope(event('guest@example.com'))).rejects.toMatchObject({ status: 403 });
  });

  it('asks once per request', async () => {
    loadMember.mockResolvedValue(member('jkai.intel:self'));
    const e = event('kid@example.com');
    await resolveRequestScope(e);
    await resolveRequestScope(e);
    expect(loadMember).toHaveBeenCalledTimes(1);
  });

  it("puts the member's own space first, so writeSpace is theirs", () => {
    expect(scopeForPrincipal('u_x')[0]).toBe('u_x');
  });
});
