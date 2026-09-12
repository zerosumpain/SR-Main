// The gate, asserted — the endpoint's copy.
//
// /projects is a public PREFIX in PUBLIC_PATHS, so this handler's own first
// statement is the ENTIRE gate on five people's movement history — three of
// them children. Same posture as the page beside it, and the same reason the
// test calls the handler directly: `isOwnerRequest` grants owner to any private
// address in a dev build (Google refuses private-network redirect URIs, so no
// session can exist on homeserv), which is exactly the branch a curl from
// 127.0.0.1 takes. So a browser cannot prove the negative case on this box.

import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

describe('/projects/landgrab/geo guard', () => {
  const callGet = async (event: Record<string, unknown>) => {
    const mod = await import('./+server');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod.GET as any)(event);
  };

  it('404s an anonymous request and never touches the database', async () => {
    const setHeaders = vi.fn();
    await expect(
      callGet({
        locals: { auth: async () => null },
        getClientAddress: () => '203.0.113.7',
        url: new URL('http://localhost/projects/landgrab/geo?x=1&y=2'),
        setHeaders,
      }),
    ).rejects.toMatchObject({ status: 404 });
    // The guard runs BEFORE the cache header and before any query, so an
    // anonymous request leaves no trace and gets no cacheable response.
    expect(setHeaders).not.toHaveBeenCalled();
  });

  it('404s a signed-in non-owner', async () => {
    const setHeaders = vi.fn();
    await expect(
      callGet({
        locals: { auth: async () => ({ user: { email: 'someone-else@example.com' } }) },
        getClientAddress: () => '203.0.113.7',
        url: new URL('http://localhost/projects/landgrab/geo?x=1&y=2'),
        setHeaders,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(setHeaders).not.toHaveBeenCalled();
  });

  it('sets private, no-store for the owner', async () => {
    const setHeaders = vi.fn();
    // The owner path is allowed to fail LATER (the mocked db has no query
    // builder); what matters is that the header was set before anything else
    // happened, so a proxy or a browser can never keep a copy of this answer.
    await callGet({
      locals: { auth: async () => null },
      getClientAddress: () => '127.0.0.1',
      url: new URL('http://localhost/projects/landgrab/geo?x=1&y=2'),
      setHeaders,
    }).catch(() => undefined);
    expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'private, no-store' });
  });

  it('400s the owner when x or y is missing', async () => {
    const setHeaders = vi.fn();
    // A bad request from the owner is a 400, not a 404: the 404 on this route
    // means "not for you", and spending it on a typo would make the gate's own
    // signal ambiguous. It is still refused before any query runs.
    await expect(
      callGet({
        locals: { auth: async () => null },
        getClientAddress: () => '127.0.0.1',
        url: new URL('http://localhost/projects/landgrab/geo'),
        setHeaders,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400s a tile index outside the z19 grid', async () => {
    // 2 ** 19 is one past the last column at z19. `tileKeyOf` would happily
    // build a key for it and `ownedNow` would happily miss, which reads to the
    // caller as "no ground here" — an answer about the ledger, when the truth
    // is that the question was not about a cell on this planet.
    await expect(
      callGet({
        locals: { auth: async () => null },
        getClientAddress: () => '127.0.0.1',
        url: new URL('http://localhost/projects/landgrab/geo?x=524288&y=2'),
        setHeaders: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(['1e3', '0x1f', '1.0', '-4', '+7', ' '])(
    '400s the non-digit tile index %j',
    async (raw) => {
      // Digits only — every one of these survives `Number.isInteger` (or, for
      // `1.0`, reads as a whole number) and none of them is the spelling the
      // page's `?geo=x:y` deep link produces. One legal form, not six.
      await expect(
        callGet({
          locals: { auth: async () => null },
          getClientAddress: () => '127.0.0.1',
          url: new URL(
            `http://localhost/projects/landgrab/geo?x=${encodeURIComponent(raw)}&y=2`,
          ),
          setHeaders: vi.fn(),
        }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
});
