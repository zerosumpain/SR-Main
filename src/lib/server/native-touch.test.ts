import { beforeEach, describe, expect, it, vi } from 'vitest';

// A phone's "last used" stamp: once a minute at most, no use lost.

const h = vi.hoisted(() => ({ writes: [] as Array<Record<string, unknown>>, fail: false }));

vi.mock('$lib/db', () => ({
  db: {
    update: () => ({
      set: (fields: Record<string, unknown>) => ({
        where: async () => {
          if (h.fail) throw new Error('db down');
          h.writes.push(fields);
        },
      }),
    }),
  },
}));

const { TOUCH_EVERY_MS, resetTouchedForTest, touchDevice, touchDue } = await import('./native-auth');

beforeEach(() => {
  resetTouchedForTest();
  h.writes.length = 0;
  h.fail = false;
});

describe('touchDue', () => {
  it('writes the first use at once, then counts until a minute has passed', () => {
    expect(touchDue('d1', 'null', 0)).toBe(1);
    expect(touchDue('d1', 'null', 5_000)).toBeNull();
    expect(touchDue('d1', 'null', 10_000)).toBeNull();
    expect(touchDue('d2', 'null', 10_000)).toBe(1);
    expect(touchDue('d1', 'null', TOUCH_EVERY_MS)).toBe(3);
    expect(touchDue('d1', 'null', TOUCH_EVERY_MS + 1)).toBeNull();
  });

  it('writes at once when the phone says something new about itself', () => {
    expect(touchDue('d1', '{"appBuild":136}', 0)).toBe(1);
    expect(touchDue('d1', '{"appBuild":137}', 1_000)).toBe(1);
  });
});

describe('touchDevice', () => {
  it('skips the write inside the minute', async () => {
    await touchDevice('d1');
    await touchDevice('d1');
    expect(h.writes).toHaveLength(1);
  });

  it('carries the uses of a failed write to the next one', async () => {
    h.fail = true;
    await expect(touchDevice('d1')).rejects.toThrow('db down');
    h.fail = false;
    await touchDevice('d1');
    expect(h.writes).toHaveLength(1);
    const count = h.writes[0].useCount as { queryChunks: unknown[] };
    // `useCount + 2`: the failed use and this one.
    expect(count.queryChunks).toContain(2);
  });
});
