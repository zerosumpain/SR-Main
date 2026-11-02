import { describe, expect, it } from 'vitest';
import { keepsOwnNativeCache } from './native-preview-cache';

// The hook stamps every phone API answer no-store. Only a Drive preview keeps
// its own headers, and only when they are private.
describe('keepsOwnNativeCache', () => {
  const route = '/api/native/drive/files/[id]/preview';

  it('keeps a private preview, served or a 304', () => {
    expect(keepsOwnNativeCache(route, 200, 'private, max-age=31536000, immutable')).toBe(true);
    expect(keepsOwnNativeCache(route, 304, 'private, max-age=86400')).toBe(true);
  });

  it('stamps a refusal, a public header, a missing one, and every other route', () => {
    expect(keepsOwnNativeCache(route, 404, 'private, max-age=60')).toBe(false);
    expect(keepsOwnNativeCache(route, 200, 'public, max-age=60')).toBe(false);
    expect(keepsOwnNativeCache(route, 200, null)).toBe(false);
    expect(keepsOwnNativeCache('/api/native/drive/files/[id]', 200, 'private, max-age=300')).toBe(false);
    expect(keepsOwnNativeCache(null, 200, 'private, max-age=300')).toBe(false);
  });
});
