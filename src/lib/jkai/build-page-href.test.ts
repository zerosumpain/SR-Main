import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rows: [] as unknown[], fail: false }));

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (h.fail) throw new Error('db down');
          return h.rows;
        },
      }),
    }),
  },
}));

import { buildPageHref } from './development-state.server';

describe('buildPageHref', () => {
  it('sends a development delivery to its workspace', async () => {
    h.rows = [{ buildId: 'b1', state: {} }];
    expect(await buildPageHref('b1')).toBe('/jkai/develop/b1');
  });

  it('keeps the archive console for a build with no delivery, or when the lookup fails', async () => {
    h.rows = [];
    expect(await buildPageHref('b2')).toBe('/jkai/builds/b2');
    h.fail = true;
    expect(await buildPageHref('b3')).toBe('/jkai/builds/b3');
  });
});
