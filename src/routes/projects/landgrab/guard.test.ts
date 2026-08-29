// The gate, asserted.
//
// /projects is a public PREFIX in PUBLIC_PATHS, so this page's load function is
// the ENTIRE gate on five people's movement history — three of them children.
// A browser cannot prove it on this box: `isOwnerRequest` grants owner to any
// private address in a dev build (Google refuses private-network redirect URIs,
// so no session can exist on homeserv), which is exactly the branch a curl from
// 127.0.0.1 takes. So the load function is called directly, with a session that
// is not the owner's and a client address that is not private.

import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

describe('/projects/landgrab guard', () => {
  const callLoad = async (event: Record<string, unknown>) => {
    const mod = await import('./+page.server');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod.load as any)(event);
  };

  it('404s an anonymous request and never touches the database', async () => {
    const setHeaders = vi.fn();
    await expect(
      callLoad({
        locals: { auth: async () => null },
        getClientAddress: () => '203.0.113.7',
        url: new URL('http://localhost/projects/landgrab'),
        setHeaders,
      }),
    ).rejects.toMatchObject({ status: 404 });
    // The guard runs BEFORE the cache header and before any query, so an
    // anonymous request leaves no trace and gets no cacheable response.
    expect(setHeaders).not.toHaveBeenCalled();
  });

  it('404s a signed-in non-owner', async () => {
    await expect(
      callLoad({
        locals: { auth: async () => ({ user: { email: 'someone-else@example.com' } }) },
        getClientAddress: () => '203.0.113.7',
        url: new URL('http://localhost/projects/landgrab'),
        setHeaders: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('sets private, no-store for the owner', async () => {
    const setHeaders = vi.fn();
    // The owner path is allowed to fail LATER (the mocked db has no query
    // builder); what matters is that the header was set before anything else
    // happened, so a proxy or a browser can never keep a copy of this page.
    await callLoad({
      locals: { auth: async () => null },
      getClientAddress: () => '127.0.0.1',
      url: new URL('http://localhost/projects/landgrab'),
      setHeaders,
    }).catch(() => undefined);
    expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
  });
});
