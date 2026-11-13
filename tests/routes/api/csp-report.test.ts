import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * POST /api/csp-report — the report-only policy's sink. Public and write-only:
 * it logs one line naming the directive and the blocked ORIGIN, never a full
 * URL, and refuses oversized bodies.
 */

vi.mock('$lib/server/public-request-guard', () => ({ assertPublicRequestBudget: () => {} }));

async function post(body: string, headers: Record<string, string> = {}) {
  const mod = await import('../../../src/routes/api/csp-report/+server');
  const request = new Request('http://x/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report', ...headers },
    body,
  });
  return (mod.POST as (e: unknown) => Promise<Response>)({ request, getClientAddress: () => '203.0.113.1' });
}

afterEach(() => vi.restoreAllMocks());

describe('POST /api/csp-report', () => {
  it('logs the directive and blocked origin only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(JSON.stringify({
      'csp-report': {
        'document-uri': 'https://strangeramblings.com/home?t=secret-token',
        'effective-directive': 'connect-src',
        'blocked-uri': 'https://tiles.example.com/v4/1/2/3.pbf?access_token=pk.secret',
      },
    }));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe('[csp-report] connect-src blocked=https://tiles.example.com page=/home');
    expect(line).not.toContain('secret');
  });

  it('accepts junk silently and logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await post('not json')).status).toBe(204);
    expect((await post('{"other":1}')).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses an oversized body', async () => {
    await expect(post('x'.repeat(9 * 1024))).rejects.toMatchObject({ status: 413 });
  });
});
