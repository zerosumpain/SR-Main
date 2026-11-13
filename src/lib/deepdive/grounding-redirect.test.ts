import { beforeEach, describe, expect, it, vi } from 'vitest';

// resolveCitationUrl follows a grounding redirect through the SSRF guard, so a
// citation cannot steer this server at its own network, and never reads the
// destination's body.
const h = vi.hoisted(() => ({ calls: [] as Array<{ url: string; opts: Record<string, unknown> }>, result: null as unknown }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/safe-fetch', () => ({
  guardedPublicFetch: async (url: string, opts: Record<string, unknown>) => {
    h.calls.push({ url, opts });
    if (h.result instanceof Error) throw h.result;
    return h.result;
  },
}));

const { resolveCitationUrl } = await import('./grounding.server');
const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';

beforeEach(() => {
  h.calls = [];
  h.result = null;
});

describe('resolveCitationUrl', () => {
  it('follows the redirect through the guard without reading the body', async () => {
    h.result = { finalUrl: 'https://nodejs.org/en/blog' };
    expect(await resolveCitationUrl(REDIRECT)).toBe('https://nodejs.org/en/blog');
    expect(h.calls[0].opts).toMatchObject({ maxBytes: 0 });
    expect((h.calls[0].opts.readBody as () => boolean)()).toBe(false);
  });

  it('keeps the original URL when the guard refuses a hop', async () => {
    h.result = new Error('ssrf_blocked: private address');
    expect(await resolveCitationUrl(REDIRECT)).toBe(REDIRECT);
  });

  it('does not touch the network for an ordinary citation', async () => {
    expect(await resolveCitationUrl('https://nodejs.org/')).toBe('https://nodejs.org/');
    expect(h.calls).toHaveLength(0);
  });
});
