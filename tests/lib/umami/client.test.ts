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
});
