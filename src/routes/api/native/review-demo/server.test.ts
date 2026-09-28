import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));

import { POST } from './+server';

let n = 0;
/** A fresh client address per test unless one is given, so buckets never leak between cases. */
function call(body: unknown, addr = `203.0.113.${++n}`) {
  const request = new Request('https://example.test/api/native/review-demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST({ request, getClientAddress: () => addr } as never) as Promise<Response>;
}

describe('POST /api/native/review-demo', () => {
  beforeEach(() => {
    h.env.APP_REVIEW_DEMO_CODE = 'REVIEW-7Q2K-TEST';
  });

  it('does not exist while APP_REVIEW_DEMO_CODE is unset', async () => {
    delete h.env.APP_REVIEW_DEMO_CODE;
    const res = await call({ code: 'REVIEW-7Q2K-TEST' });
    expect(res.status).toBe(404);
  });

  it('does not exist while APP_REVIEW_DEMO_CODE is blank', async () => {
    h.env.APP_REVIEW_DEMO_CODE = '   ';
    // A blank secret must never match a blank code.
    expect((await call({ code: '' })).status).toBe(404);
    expect((await call({ code: '   ' })).status).toBe(404);
  });

  it('refuses a wrong code with 401 and never says demo', async () => {
    const res = await call({ code: 'REVIEW-7Q2K-TESX' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.demo).toBeUndefined();
    expect(body.error).toBe('That pairing code is not valid.');
  });

  it('refuses a prefix of the right code', async () => {
    expect((await call({ code: 'REVIEW-7Q2K' })).status).toBe(401);
  });

  it('answers { demo: true } to the right code, and nothing else', async () => {
    const res = await call({ code: 'REVIEW-7Q2K-TEST' });
    expect(res.status).toBe(200);
    // Never a credential: the whole answer is the one flag.
    expect(await res.json()).toEqual({ demo: true });
  });

  it('tolerates surrounding whitespace from a pasted code', async () => {
    expect((await call({ code: '  REVIEW-7Q2K-TEST\n' })).status).toBe(200);
  });

  it('rejects a missing, non-string or oversized code with 400', async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ code: 42 })).status).toBe(400);
    expect((await call({ code: 'x'.repeat(201) })).status).toBe(400);
    expect((await call('not json')).status).toBe(400);
  });

  it('is rate limited per address, like /api/native/pair', async () => {
    const addr = '198.51.100.9';
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call({ code: 'wrong' }, addr)).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Even the right code is refused once the bucket is empty.
    const capped = await call({ code: 'REVIEW-7Q2K-TEST' }, addr);
    expect(capped.status).toBe(429);
    expect(capped.headers.get('Retry-After')).toBeTruthy();
    // Another address is unaffected.
    expect((await call({ code: 'REVIEW-7Q2K-TEST' }, '198.51.100.10')).status).toBe(200);
  });
});
