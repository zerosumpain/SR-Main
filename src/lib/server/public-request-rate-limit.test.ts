import { afterEach, describe, expect, it, vi } from 'vitest';

const NAMES = ['REQUEST_HASH_SALT', 'PUBLIC_REQUEST_SALT'] as const;
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));

async function hashWith(env: Partial<Record<(typeof NAMES)[number], string>>): Promise<string> {
  for (const n of NAMES) delete process.env[n];
  Object.assign(process.env, env);
  vi.resetModules();
  const { hashIp } = await import('./public-request-rate-limit');
  return hashIp('203.0.113.8');
}

afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe('the request-hash salt', () => {
  it('reads REQUEST_HASH_SALT first', async () => {
    const preferred = await hashWith({ REQUEST_HASH_SALT: 'a'.repeat(32), PUBLIC_REQUEST_SALT: 'b'.repeat(32) });
    expect(preferred).toBe(await hashWith({ REQUEST_HASH_SALT: 'a'.repeat(32) }));
  });

  it('falls back to the old name, then the constant', async () => {
    const old = await hashWith({ PUBLIC_REQUEST_SALT: 'b'.repeat(32) });
    const constant = await hashWith({});
    expect(old).not.toBe(constant);
    expect(await hashWith({ REQUEST_HASH_SALT: 'a'.repeat(32) })).not.toBe(constant);
  });
});
