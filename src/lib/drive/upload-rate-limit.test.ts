import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rateLimit } from '$lib/server/rate-limit';

// A 4 GiB video is 512 sequential 8 MiB chunk PUTs, and several files may
// upload at once. This runs hooks.server.ts's own RATE_LIMITS table (read from
// source: the hook module boots the whole site on import) through the real
// limiter, the way `rateLimited` keys it.

type Limit = { pattern: RegExp; capacity: number; refillPerSecond: number; methods?: string[]; bucket?: string };

function table(): Limit[] {
  const hook = readFileSync(join(process.cwd(), 'src/hooks.server.ts'), 'utf8');
  const start = hook.indexOf('= [', hook.indexOf('const RATE_LIMITS'));
  const end = hook.indexOf('\n];', start);
  return new Function(`return ${hook.slice(start + 2, end + 2)}`)() as Limit[];
}

const LIMITS = table();
let n = 0;

/** What `rateLimited` in hooks.server.ts decides for one request. */
function allowed(device: string, pathname: string, method: string): boolean {
  const limit = LIMITS.find((r) => r.pattern.test(pathname) && (!r.methods || r.methods.includes(method)));
  if (!limit || method === 'GET') return true;
  return rateLimit(`${device}:${limit.bucket ?? pathname}`, limit).allowed;
}

beforeEach(() => {
  vi.useFakeTimers();
  n += 1;
});
afterEach(() => vi.useRealTimers());

const id = (i: number) => i.toString(16).padStart(32, '0');

describe('chunk PUTs are not starved', () => {
  it('lets three parallel uploads through at 10 PUTs a second in total for two minutes', () => {
    const device = `device:t${n}`;
    // Three files in parallel sharing ~10 PUTs a second for 2 minutes (1200 PUTs, 9.4 GiB).
    for (let i = 0; i < 1200; i++) {
      expect(allowed(device, `/api/native/drive/uploads/${id(i % 3)}`, 'PUT')).toBe(true);
      vi.advanceTimersByTime(100);
    }
  });

  it('one 4 GiB video sent as fast as 15/s still gets through', () => {
    const device = `device:f${n}`;
    for (let i = 0; i < 512; i++) {
      expect(allowed(device, `/api/native/drive/uploads/${id(1)}`, 'PUT')).toBe(true);
      vi.advanceTimersByTime(66);
    }
  });

  it('still caps a runaway loop on one device', () => {
    const device = `device:r${n}`;
    let refused = 0;
    for (let i = 0; i < 2000; i++) if (!allowed(device, `/api/native/drive/uploads/${id(i % 6)}`, 'PUT')) refused++;
    expect(refused).toBeGreaterThan(1000);
  });

  it('keeps complete, cancel and start on the upload bucket, not the chunk one', () => {
    const put = LIMITS.find((r) => r.pattern.test(`/api/native/drive/uploads/${id(1)}`) && r.methods?.includes('PUT'));
    const of = (p: string, m: string) => LIMITS.find((r) => r.pattern.test(p) && (!r.methods || r.methods.includes(m)));
    expect(of(`/api/native/drive/uploads/${id(1)}`, 'DELETE')).not.toBe(put);
    expect(of(`/api/native/drive/uploads/${id(1)}/complete`, 'POST')).not.toBe(put);
    expect(of('/api/native/drive/uploads', 'POST')).toMatchObject({ capacity: 300, refillPerSecond: 5 });
    expect(of('/api/native/drive/files', 'POST')).toMatchObject({ capacity: 300, refillPerSecond: 5 });
  });
});
