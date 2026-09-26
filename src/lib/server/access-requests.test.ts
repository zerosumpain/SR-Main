import { describe, expect, it } from 'vitest';
import { submitRequest, validateRequest, type SubmitDeps, type RequestInput } from './access-requests';
import { rateLimit } from './public-request-rate-limit';

const GOOD = { name: ' Jane  Doe ', email: ' Jane@Example.com ', message: 'For the family map', app: 'on' };

function deps(opts: { allowed?: string[]; pending?: string[]; limit?: boolean } = {}) {
  const log = { inserted: [] as (RequestInput & { ipHash: string })[], notified: [] as RequestInput[] };
  const d: SubmitDeps = {
    rateLimit: () => opts.limit !== true,
    isAllowed: async (e) => (opts.allowed ?? []).includes(e),
    hasPending: async (e) => (opts.pending ?? []).includes(e),
    insert: async (row) => {
      log.inserted.push(row);
    },
    notify: async (row) => {
      log.notified.push(row);
    },
  };
  return { d, log };
}

describe('validateRequest', () => {
  it('trims, lower-cases and reads the checkbox', () => {
    const v = validateRequest(GOOD);
    expect(v).toEqual({
      ok: true,
      value: { name: 'Jane Doe', email: 'jane@example.com', message: 'For the family map', wantsApp: true },
    });
  });

  it('makes the message optional', () => {
    const v = validateRequest({ ...GOOD, message: '   ', app: null });
    expect(v.ok && v.value.message).toBe(null);
    expect(v.ok && v.value.wantsApp).toBe(false);
  });

  it('names the field that is wrong', () => {
    expect(validateRequest({ ...GOOD, name: '' })).toMatchObject({ ok: false, field: 'name' });
    expect(validateRequest({ ...GOOD, name: 'x'.repeat(81) })).toMatchObject({ ok: false, field: 'name' });
    expect(validateRequest({ ...GOOD, email: 'not-an-email' })).toMatchObject({ ok: false, field: 'email' });
    expect(validateRequest({ ...GOOD, email: `${'a'.repeat(250)}@x.co` })).toMatchObject({ ok: false, field: 'email' });
    expect(validateRequest({ ...GOOD, message: 'x'.repeat(1001) })).toMatchObject({ ok: false, field: 'message' });
    expect(validateRequest({ ...GOOD, name: 42 })).toMatchObject({ ok: false, field: 'name' });
  });
});

describe('submitRequest', () => {
  it('stores and raises a new request', async () => {
    const { d, log } = deps();
    expect(await submitRequest(GOOD, 'ip1', d)).toEqual({ status: 'accepted' });
    expect(log.inserted).toHaveLength(1);
    expect(log.inserted[0]).toMatchObject({ email: 'jane@example.com', ipHash: 'ip1', wantsApp: true });
    expect(log.notified).toHaveLength(1);
  });

  it('never reveals whether an address is known', async () => {
    const fresh = deps();
    const allowed = deps({ allowed: ['jane@example.com'] });
    const pending = deps({ pending: ['jane@example.com'] });
    const answers = await Promise.all([
      submitRequest(GOOD, 'ip', fresh.d),
      submitRequest(GOOD, 'ip', allowed.d),
      submitRequest(GOOD, 'ip', pending.d),
    ]);
    // One answer, whatever the address.
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    // …but only the new one costs a row or a notification.
    expect(allowed.log.inserted).toEqual([]);
    expect(allowed.log.notified).toEqual([]);
    expect(pending.log.inserted).toEqual([]);
    expect(pending.log.notified).toEqual([]);
  });

  it('thanks a bot that fills the honeypot and does nothing', async () => {
    const { d, log } = deps();
    expect(await submitRequest({ ...GOOD, website: 'http://spam' }, 'ip', d)).toEqual({ status: 'accepted' });
    expect(log.inserted).toEqual([]);
    expect(log.notified).toEqual([]);
  });

  it('refuses a caller over the limit before reading anything', async () => {
    const { d, log } = deps({ limit: true });
    expect(await submitRequest(GOOD, 'ip', d)).toEqual({ status: 'limited' });
    expect(log.inserted).toEqual([]);
  });

  it('reports an invalid form without storing it', async () => {
    const { d, log } = deps();
    expect(await submitRequest({ ...GOOD, email: 'nope' }, 'ip', d)).toMatchObject({ status: 'invalid', field: 'email' });
    expect(log.inserted).toEqual([]);
  });
});

describe('the public rate limiter the form uses', () => {
  it('allows three an hour per address and then refuses', () => {
    const ip = `test-${Math.random()}`;
    const hour = 60 * 60_000;
    expect(rateLimit('access-request-test', ip, 3, hour)).toBe(true);
    expect(rateLimit('access-request-test', ip, 3, hour)).toBe(true);
    expect(rateLimit('access-request-test', ip, 3, hour)).toBe(true);
    expect(rateLimit('access-request-test', ip, 3, hour)).toBe(false);
    // Another address is unaffected.
    expect(rateLimit('access-request-test', `${ip}-other`, 3, hour)).toBe(true);
  });
});
