import { describe, expect, it } from 'vitest';
import { canonical, fnv64, hashOf } from './hash';

describe('state hash', () => {
  it('is FNV-1a 64 (published test vectors)', () => {
    expect(fnv64('')).toBe('cbf29ce484222325');
    expect(fnv64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv64('foobar')).toBe('85944171f73967e8');
  });

  it('hashes UTF-8 bytes (against a BigInt reference over TextEncoder)', () => {
    const ref = (str: string) => {
      let h = 0xcbf29ce484222325n;
      for (const b of new TextEncoder().encode(str)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
      return h.toString(16).padStart(16, '0');
    };
    for (const str of ['£12,345', 'Sunnyvale ★4.1', '😀 emoji', 'naïve café', JSON.stringify({ a: [1, -2.5e-7] })]) expect(fnv64(str)).toBe(ref(str));
  });

  it('serialises canonically: sorted keys, −0 as 0, undefined dropped', () => {
    expect(canonical({ b: 1, a: [2, -0, 'x'], c: undefined })).toBe('{"a":[2,0,"x"],"b":1}');
    expect(hashOf({ x: 1, y: 2 })).toBe(hashOf({ y: 2, x: 1 }));
    expect(hashOf({ x: -0 })).toBe(hashOf({ x: 0 }));
    expect(() => canonical({ x: NaN })).toThrow();
    expect(canonical(0.1 + 0.2)).toBe('0.30000000000000004');
  });
});
