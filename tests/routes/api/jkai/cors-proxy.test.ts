import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/jkai/cors/<url> relays an allow-listed public API onto this origin.
 * Whatever the upstream says it is, the reply must never render as a document
 * here, and a failure must not echo internal error text to the caller.
 */

let upstream: () => Promise<Response>;
vi.mock('$lib/server/safe-fetch', () => ({ guardedPublicFetch: () => upstream() }));
vi.mock('$lib/server/public-request-guard', () => ({ assertPublicRequestBudget: () => {} }));

async function get(target: string) {
  const mod = await import('../../../../src/routes/api/jkai/cors/[...url]/+server');
  const url = new URL(`http://x/api/jkai/cors/${target}`);
  return (mod.GET as (e: unknown) => Promise<Response>)({ params: { url: target }, url, request: new Request(url) });
}

beforeEach(() => {
  upstream = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
});

describe('GET /api/jkai/cors', () => {
  it('keeps JSON as JSON, inside a sandbox', async () => {
    const res = await get('https://api.open-meteo.com/v1/forecast');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('turns an upstream HTML or SVG reply into a plain-text download', async () => {
    for (const type of ['text/html', 'image/svg+xml', null]) {
      upstream = async () => new Response('<script>1</script>', type ? { headers: { 'content-type': type } } : {});
      const res = await get('https://en.wikipedia.org/wiki/Test');
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('content-disposition')).toBe('attachment');
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
    }
  });

  it('accepts vendor JSON types as JSON', async () => {
    upstream = async () => new Response('{}', { headers: { 'content-type': 'application/geo+json' } });
    const res = await get('https://earthquake.usgs.gov/feed.geojson');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('answers a failed fetch with fixed text', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    upstream = async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443 internal-detail'); };
    const res = await get('https://api.open-meteo.com/v1/forecast');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Proxy fetch failed' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('no longer relays the retired API hosts', async () => {
    for (const host of ['api.publicapis.org', 'api.coindesk.com', 'api.quotable.io']) {
      expect((await get(`https://${host}/x`)).status).toBe(403);
    }
  });
});
