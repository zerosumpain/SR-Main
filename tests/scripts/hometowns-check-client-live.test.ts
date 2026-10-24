// The Hometowns release gate's judgement, with a fake fetch (no network).
import { describe, expect, it } from 'vitest';
import { checkClientLive, pageHashMarker, pageUrl } from '../../scripts/hometowns/check-client-live.mjs';

const HASH = '1234567890abcdef';
const FIRST_PARTY = "default-src 'self' https: data: blob:; worker-src 'self' blob:";

function serve(status: number, body = '', headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return new Response(body, { status, headers });
  };
  return { calls, fetchImpl };
}

const page = (h: string) => `<!doctype html><head><meta name="hometowns-engine-hash" content="${h}"></head>`;

describe('check-client-live', () => {
  it('asks for the hash-versioned mobile.html', async () => {
    expect(pageUrl('https://example.test/', HASH)).toBe(`https://example.test/projects/hometowns/${HASH}/mobile.html`);
    const s = serve(200, page(HASH), { 'content-type': 'text/html', 'content-security-policy': FIRST_PARTY });
    const r = await checkClientLive({ hash: HASH, site: 'https://example.test', fetchImpl: s.fetchImpl });
    expect(r).toEqual({ ok: true, url: s.calls[0] });
  });

  it('fails when the page is not published', async () => {
    const r = await checkClientLive({ hash: HASH, fetchImpl: serve(404, 'Not found').fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('HTTP 404');
  });

  it('fails on the sandboxed CSP (the key is not live yet)', async () => {
    const s = serve(200, page(HASH), { 'content-type': 'text/html', 'content-security-policy': `sandbox allow-scripts; ${FIRST_PARTY}` });
    const r = await checkClientLive({ hash: HASH, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('sandboxed CSP');
  });

  it("fails when the served page is another hash's build", async () => {
    const s = serve(200, page('fedcba0987654321'), { 'content-type': 'text/html', 'content-security-policy': FIRST_PARTY });
    const r = await checkClientLive({ hash: HASH, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('fedcba0987654321');
  });

  it('fails on the wrong content type and on a network error', async () => {
    const json = serve(200, page(HASH), { 'content-type': 'application/json', 'content-security-policy': FIRST_PARTY });
    expect((await checkClientLive({ hash: HASH, fetchImpl: json.fetchImpl })).ok).toBe(false);
    const down = await checkClientLive({ hash: HASH, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(down).toMatchObject({ ok: false, problem: expect.stringContaining('ECONNREFUSED') });
  });

  it('reads the marker the page build writes', () => {
    expect(pageHashMarker(page(HASH))).toBe(HASH);
    expect(pageHashMarker('<html></html>')).toBeNull();
  });
});
