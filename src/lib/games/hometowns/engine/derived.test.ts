import { describe, expect, it } from 'vitest';
import { SLOT_NAMES, newDerivedCache, readSlots } from './derived';

describe('readSlots', () => {
  it('reads every slot of the blackboard in SLOT_NAMES order', () => {
    const d = newDerivedCache() as unknown as Record<string, unknown>;
    expect(Object.keys(d)).toEqual([...SLOT_NAMES]);
    const marks = SLOT_NAMES.map((n) => ({ slot: n }));
    SLOT_NAMES.forEach((n, k) => (d[n] = marks[k]));
    const out: unknown[] = [];
    readSlots(d as never, out);
    expect(out).toHaveLength(SLOT_NAMES.length);
    SLOT_NAMES.forEach((_, k) => expect(out[k]).toBe(marks[k]));
  });
});
