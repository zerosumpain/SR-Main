import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock('$lib/health/tokens', () => ({ getValidToken: mocks.token }));
import { getWhoopUser } from '$lib/health/whoop';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('WHOOP requests during token rotation', () => {
  it('retries an invalidated token once with the newly stored token', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ user_id: 123 }));
    vi.stubGlobal('fetch', fetcher);
    mocks.token.mockResolvedValue('rotated');
    expect(await getWhoopUser('previous')).toEqual({ user_id: 123 });
    expect(fetcher.mock.calls.map(c => c[1].headers.Authorization)).toEqual(['Bearer previous', 'Bearer rotated']);
  });
  it('surfaces a rejected current token without retrying it', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('revoked', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    mocks.token.mockResolvedValue('current');
    await expect(getWhoopUser('current')).rejects.toThrow('401');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not keep retrying if the replacement token is rejected', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('revoked', { status: 401 })));
    vi.stubGlobal('fetch', fetcher);
    mocks.token.mockResolvedValue('replacement');
    await expect(getWhoopUser('previous')).rejects.toThrow('401');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not refresh credentials for a forbidden request', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getWhoopUser('current')).rejects.toThrow('403');
    expect(mocks.token).not.toHaveBeenCalled();
  });
});
