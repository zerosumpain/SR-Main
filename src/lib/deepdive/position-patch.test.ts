import { describe, it, expect } from 'vitest';
import { sources, facts, entities } from '$lib/db/schema';
import { parsePositionPatch, tableForArtefactType, type PositionPatch } from './position-patch';

describe('tableForArtefactType', () => {
  it('maps each valid artefactType to its Drizzle table', () => {
    expect(tableForArtefactType('source')).toBe(sources);
    expect(tableForArtefactType('fact')).toBe(facts);
    expect(tableForArtefactType('entity')).toBe(entities);
  });

  it('returns null for an unknown artefactType', () => {
    expect(tableForArtefactType('relationship')).toBeNull();
    expect(tableForArtefactType('')).toBeNull();
    // @ts-expect-error deliberately wrong type
    expect(tableForArtefactType(undefined)).toBeNull();
  });
});

describe('parsePositionPatch', () => {
  it('accepts a minimal valid body (position only)', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 120, y: -40 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.artefactType).toBe('fact');
    expect(res.value.set).toEqual({ canvasX: 120, canvasY: -40 });
  });

  it('includes optional pinned/deskState/deskCategory when present', () => {
    const res = parsePositionPatch({
      artefactType: 'source',
      position: { x: 0, y: 0 },
      pinned: true,
      deskState: 'filed',
      deskCategory: 'economics',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.set).toEqual({
      canvasX: 0,
      canvasY: 0,
      pinned: true,
      deskState: 'filed',
      deskCategory: 'economics',
    });
  });

  it('allows clearing deskCategory with null', () => {
    const res = parsePositionPatch({
      artefactType: 'entity',
      position: { x: 5, y: 5 },
      deskCategory: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.set).toEqual({ canvasX: 5, canvasY: 5, deskCategory: null });
  });

  it('rejects a non-object body', () => {
    expect(parsePositionPatch(null).ok).toBe(false);
    expect(parsePositionPatch('nope').ok).toBe(false);
    expect(parsePositionPatch(42).ok).toBe(false);
  });

  it('rejects an invalid artefactType', () => {
    const res = parsePositionPatch({ artefactType: 'relationship', position: { x: 1, y: 2 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/artefactType/i);
  });

  it('rejects a missing position', () => {
    const res = parsePositionPatch({ artefactType: 'fact' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/position/i);
  });

  it('rejects non-finite position coordinates', () => {
    for (const bad of [
      { x: NaN, y: 0 },
      { x: 0, y: Infinity },
      { x: '10', y: 0 },
      { x: 0 },
      { y: 0 },
    ]) {
      const res = parsePositionPatch({ artefactType: 'fact', position: bad });
      expect(res.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('rejects a non-boolean pinned', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 1, y: 1 },
      pinned: 'yes',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/pinned/i);
  });

  it('rejects an invalid deskState value', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 1, y: 1 },
      deskState: 'banana',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/deskState/i);
  });

  it('rejects a non-string deskCategory (when not null)', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 1, y: 1 },
      deskCategory: 42,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/deskCategory/i);
  });

  it('omits absent optional fields entirely (no undefined keys in set)', () => {
    const res = parsePositionPatch({ artefactType: 'fact', position: { x: 1, y: 1 } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.value.set).sort()).toEqual(['canvasX', 'canvasY']);
  });

  it('exposes the PositionPatch type shape', () => {
    const patch: PositionPatch = { artefactType: 'fact', set: { canvasX: 1, canvasY: 2 } };
    expect(patch.set.canvasX).toBe(1);
  });
});
