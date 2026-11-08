import { beforeEach, describe, expect, it, vi } from 'vitest';

// The settings cache, against a stand-in for the one query getSetting makes.
const rows: { value: unknown }[][] = [];
let pending: ((rows: { value: unknown }[]) => void) | null = null;
const limit = vi.fn(
  () =>
    new Promise<{ value: unknown }[]>((resolve) => {
      if (rows.length) resolve(rows.shift()!);
      else pending = resolve;
    }),
);
const onConflictDoUpdate = vi.fn(async () => {});
const deleteWhere = vi.fn(async () => {});
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate }) }),
    delete: () => ({ where: deleteWhere }),
  },
}));
vi.mock('$lib/llm/keys', () => ({ loadKeys: () => ({}) }));

let settings: typeof import('./settings');

beforeEach(async () => {
  rows.length = 0;
  pending = null;
  limit.mockClear();
  vi.resetModules();
  settings = await import('./settings');
});

describe('settings cache', () => {
  it('serves a second read from the cache', async () => {
    rows.push([{ value: { text: 'a' } }]);
    expect(await settings.getSetting('k')).toEqual({ text: 'a' });
    expect(await settings.getSetting('k')).toEqual({ text: 'a' });
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it('reads afresh after a write', async () => {
    rows.push([{ value: 'old' }], [{ value: 'new' }]);
    expect(await settings.getSetting('k')).toBe('old');
    await settings.setSetting('k', 'new');
    expect(await settings.getSetting('k')).toBe('new');
  });

  it.each(['setSetting', 'deleteSetting'] as const)(
    'does not cache a read that was running when %s landed',
    async (write) => {
      const late = settings.getSetting('k');
      await vi.waitFor(() => expect(pending).not.toBeNull());
      if (write === 'setSetting') await settings.setSetting('k', 'new');
      else await settings.deleteSetting('k');
      pending!([{ value: 'old' }]);
      // That request began before the write, so it may see the old row...
      expect(await late).toBe('old');
      // ...but the next one must not be served it from the cache.
      rows.push([{ value: 'new' }]);
      expect(await settings.getSetting('k')).toBe('new');
      expect(limit).toHaveBeenCalledTimes(2);
    },
  );
});
