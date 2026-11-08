import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('$lib/server/extracted-app', () => ({ getFromExtracted: (...a: unknown[]) => get(...a) }));
const { getJkaiIdentity, clearJkaiIdentityCache } = await import('./identity-client');

beforeEach(() => {
  get.mockReset();
  clearJkaiIdentityCache();
});

describe('getJkaiIdentity', () => {
  it('asks Core for the surface, on the jkai-core lane, and caches five minutes', async () => {
    get.mockResolvedValue({ surface: 'daydream', identityVersion: 'v1:abc', text: 'soul\n\noverlay' });
    expect(await getJkaiIdentity('daydream', 0)).toEqual({ text: 'soul\n\noverlay', identityVersion: 'v1:abc' });
    expect(get).toHaveBeenCalledWith('jkai-core', '/api/jkai/service/identity?surface=daydream', { timeoutMs: 3000 });
    await getJkaiIdentity('daydream', 4 * 60_000);
    expect(get).toHaveBeenCalledTimes(1);
    await getJkaiIdentity('daydream', 6 * 60_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('returns nothing, never throws, when Core is down, and retries after a minute', async () => {
    get.mockRejectedValue(new Error('connect ECONNREFUSED'));
    expect(await getJkaiIdentity('daydream', 0)).toEqual({ text: '', identityVersion: null });
    await getJkaiIdentity('daydream', 30_000);
    expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValue({ identityVersion: 'v1', text: 'soul' });
    expect((await getJkaiIdentity('daydream', 61_000)).text).toBe('soul');
  });

  it('treats an answer with no text as no identity', async () => {
    get.mockResolvedValue({ error: 'nope' });
    expect((await getJkaiIdentity('canvas', 0)).text).toBe('');
  });
});
