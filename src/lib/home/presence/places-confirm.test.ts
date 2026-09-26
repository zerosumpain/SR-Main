import { beforeEach, describe, expect, it, vi } from 'vitest';

// confirmPlace writes the replacement memory in the SAME scope as the one it
// replaces. writeMemory refuses to supersede across scopes, and most places'
// names are personal memories while this used to write 'daydream', so every
// rename of those failed. The database is a fake; nothing reaches Postgres.

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/db', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'returning']) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return c;
  };
  const tx = {
    execute: async () => [],
    select: () => chain(h.selects.shift() ?? []),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        h.updates.push(s);
        return chain([]);
      },
    }),
  };
  return { db: { ...tx, transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock('$lib/jkai/memory/service.server', () => ({
  writeMemory: async (input: Record<string, unknown>) => {
    h.writes.push(input);
    return { id: 'new-mem' };
  },
}));

const { confirmPlace, memoryScope } = await import('./places');

const PLACE = {
  id: 'p1',
  label: 'School',
  kind: 'school',
  memoryId: 'old-mem',
  visitCount: 4,
  medianDwellMins: 20,
  dayHistogram: [0, 0, 0, 0, 0, 0, 0],
  hourHistogram: new Array(24).fill(0),
};

beforeEach(() => {
  h.selects = [];
  h.updates = [];
  h.writes = [];
});

describe('memoryScope', () => {
  it('reads scope the way writeMemory does', () => {
    expect(memoryScope({ daydreamOrigin: null, provenance: null })).toBe('personal');
    expect(memoryScope({ daydreamOrigin: 'place', provenance: {} })).toBe('daydream');
    expect(memoryScope({ daydreamOrigin: null, provenance: { scope: 'personal' } })).toBe('personal');
    expect(memoryScope({ daydreamOrigin: 'place', provenance: { scope: 'personal' } })).toBe('personal');
  });
});

describe('confirmPlace — same scope as the memory it replaces', () => {
  it('replaces a PERSONAL memory with a personal one', async () => {
    h.selects = [[PLACE], [{ id: 'old-mem', daydreamOrigin: null, provenance: { origin: 'user' } }]];
    const res = await confirmPlace('p1', 'Big School', 'school');
    expect(res.memoryId).toBe('new-mem');
    expect(h.writes).toHaveLength(1);
    const w = h.writes[0] as { daydreamOrigin?: string; replacesId: string; provenance: { scope?: string } };
    expect(w.daydreamOrigin).toBeUndefined();
    expect(w.replacesId).toBe('old-mem');
    expect(w.provenance.scope).toBe('personal');
    expect(h.updates[0]).toMatchObject({ label: 'Big School', memoryId: 'new-mem' });
  });

  it('replaces a DAYDREAM memory with a daydream one', async () => {
    h.selects = [[PLACE], [{ id: 'old-mem', daydreamOrigin: 'place', provenance: { origin: 'daydream-place' } }]];
    await confirmPlace('p1', 'Big School', 'school');
    const w = h.writes[0] as { daydreamOrigin?: string; replacesId: string; provenance: { scope?: string } };
    expect(w.daydreamOrigin).toBe('place');
    expect(w.replacesId).toBe('old-mem');
    expect(w.provenance.scope).toBeUndefined();
  });

  it('writes a fresh personal memory when there is none, or it is no longer current', async () => {
    h.selects = [[{ ...PLACE, memoryId: null }]];
    await confirmPlace('p1', 'Club', 'gym');
    h.selects = [[PLACE], []];
    await confirmPlace('p1', 'Club', 'gym');
    for (const w of h.writes as Array<{ daydreamOrigin?: string; replacesId: string | null; provenance: { scope?: string } }>) {
      expect(w.daydreamOrigin).toBeUndefined();
      expect(w.replacesId).toBeNull();
      expect(w.provenance.scope).toBe('personal');
    }
  });
});
