import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUmamiClient } from '$lib/umami/client';

const mkResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response);

describe('umami client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('getStatsForPath calls the right URL with bearer token', async () => {
    fetchMock.mockResolvedValue(mkResponse({ pageviews: { value: 5 }, visitors: { value: 3 } }));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid', apiKey: 'k', fetchFn: fetchMock,
    });
    const stats = await c.getStatsForPath('/blog/foo', 7);
    expect(stats).toEqual({ pageviews: 5, visitors: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/websites/wid/stats');
    expect(url).toContain('url=%2Fblog%2Ffoo');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer k' });
  });

  it('returns zeros when umami is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid', apiKey: 'k', fetchFn: fetchMock,
    });
    expect(await c.getStatsForPath('/blog/foo', 7)).toEqual({ pageviews: 0, visitors: 0 });
  });

  it('getStatsBatch fans out and dedupes via cache', async () => {
    fetchMock.mockResolvedValue(mkResponse({ pageviews: { value: 1 }, visitors: { value: 1 } }));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid', apiKey: 'k', fetchFn: fetchMock,
    });
    const a = await c.getStatsBatch(['/blog/a', '/blog/b'], 7);
    expect(Object.keys(a)).toEqual(['/blog/a', '/blog/b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    await c.getStatsBatch(['/blog/a', '/blog/b'], 7);
    expect(fetchMock).not.toHaveBeenCalled(); // both cached
  });

  it('username/password mode: logs in once and reuses the JWT', async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse({ token: 'jwt-1' }))
      .mockResolvedValue(mkResponse({ pageviews: { value: 7 }, visitors: { value: 2 } }));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid',
      username: 'u', password: 'p', fetchFn: fetchMock,
    });
    await c.getStatsForPath('/blog/x', 7);
    await c.getStatsForPath('/blog/y', 7);
    // 1 login + 2 stats calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe('https://x/api/auth/login');
    expect((loginInit as RequestInit).method).toBe('POST');
    const [, statsInit] = fetchMock.mock.calls[1];
    expect((statsInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-1' });
  });

  it('username/password mode: re-logs in once on 401, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse({ token: 'jwt-1' }))
      // first stats call: 401
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as unknown as Response)
      // re-login
      .mockResolvedValueOnce(mkResponse({ token: 'jwt-2' }))
      // retry stats: 200
      .mockResolvedValueOnce(mkResponse({ pageviews: { value: 4 }, visitors: { value: 1 } }));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid',
      username: 'u', password: 'p', fetchFn: fetchMock,
    });
    const stats = await c.getStatsForPath('/blog/x', 7);
    expect(stats).toEqual({ pageviews: 4, visitors: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, retryInit] = fetchMock.mock.calls[3];
    expect((retryInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-2' });
  });

  it('username/password mode: returns zeros if login fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid',
      username: 'u', password: 'p', fetchFn: fetchMock,
    });
    expect(await c.getStatsForPath('/blog/x', 7)).toEqual({ pageviews: 0, visitors: 0 });
  });
});
