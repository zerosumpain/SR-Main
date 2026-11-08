// The Hometowns release gate's judgement, with a fake fetch (no network).
import { describe, expect, it } from 'vitest';
import { checkClientLive, engineHashMarker, pageHashMarker, pageUrl } from '../../scripts/hometowns/check-client-live.mjs';

const PAGE = '1234567890abcdef';
const ENGINE = 'aaaabbbbccccdddd';
const FIRST_PARTY = "default-src 'self' https: data: blob:; worker-src 'self' blob:";

function serve(status: number, body = '', headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return new Response(body, { status, headers });
  };
  return { calls, fetchImpl };
}

const page = (p: string, e = ENGINE) =>
  `<!doctype html><head><meta name="hometowns-engine-hash" content="${e}"><meta name="hometowns-page-hash" content="${p}"></head>`;
const html = { 'content-type': 'text/html', 'content-security-policy': FIRST_PARTY };

describe('check-client-live', () => {
  it('asks for the page-versioned mobile.html', async () => {
    expect(pageUrl('https://example.test/', PAGE)).toBe(`https://example.test/projects/hometowns/${PAGE}/mobile.html`);
    const s = serve(200, page(PAGE), html);
    const r = await checkClientLive({ pageHash: PAGE, engineHash: ENGINE, site: 'https://example.test', fetchImpl: s.fetchImpl });
    expect(r).toEqual({ ok: true, url: s.calls[0] });
    expect(s.calls[0]).toContain(`/${PAGE}/`);
    expect(s.calls[0]).not.toContain(ENGINE);
  });

  it('fails when the page is not published', async () => {
    const r = await checkClientLive({ pageHash: PAGE, engineHash: ENGINE, fetchImpl: serve(404, 'Not found').fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('HTTP 404');
  });

  it('fails on the sandboxed CSP (the key is not live yet)', async () => {
    const s = serve(200, page(PAGE), { 'content-type': 'text/html', 'content-security-policy': `sandbox allow-scripts; ${FIRST_PARTY}` });
    const r = await checkClientLive({ pageHash: PAGE, engineHash: ENGINE, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('sandboxed CSP');
  });

  it("fails when the served page is another page's build", async () => {
    const s = serve(200, page('fedcba0987654321'), html);
    const r = await checkClientLive({ pageHash: PAGE, engineHash: ENGINE, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('fedcba0987654321');
  });

  it('fails when the served page runs another engine', async () => {
    const s = serve(200, page(PAGE, '0000111122223333'), html);
    const r = await checkClientLive({ pageHash: PAGE, engineHash: ENGINE, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.problem).toContain('runs engine 0000111122223333');
  });

  it('fails on the wrong content type and on a network error', async () => {
    const json = serve(200, page(PAGE), { 'content-type': 'application/json', 'content-security-policy': FIRST_PARTY });
    expect((await checkClientLive({ pageHash: PAGE, engineHash: ENGINE, fetchImpl: json.fetchImpl })).ok).toBe(false);
    const down = await checkClientLive({ pageHash: PAGE, engineHash: ENGINE, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(down).toMatchObject({ ok: false, problem: expect.stringContaining('ECONNREFUSED') });
  });

  it('reads the markers the page build writes', () => {
    expect(pageHashMarker(page(PAGE))).toBe(PAGE);
    expect(engineHashMarker(page(PAGE))).toBe(ENGINE);
    expect(pageHashMarker('<html></html>')).toBeNull();
    expect(engineHashMarker('<html></html>')).toBeNull();
  });
});
