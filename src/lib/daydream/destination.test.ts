import { describe, expect, it } from 'vitest';
import { hasMap, refOf, tabFor, thoughtDestination } from './destination';

describe('refOf', () => {
  it('finds the first ref of a kind', () => {
    expect(refOf([{ kind: 'email', id: 'a' }, { kind: 'email', id: 'b' }], 'email')).toBe('a');
  });

  it('is null for a missing kind, an empty list and a blank id', () => {
    expect(refOf([{ kind: 'place', id: 'p1' }], 'email')).toBeNull();
    expect(refOf([], 'email')).toBeNull();
    expect(refOf(null, 'email')).toBeNull();
    expect(refOf([{ kind: 'email', id: '   ' }], 'email')).toBeNull();
  });
});

describe('tabFor', () => {
  it('routes by prefix, so a new detector in a family needs no edit here', () => {
    expect(tabFor('spend_duplicate')?.tab).toBe('money');
    expect(tabFor('spend_anything_at_all')?.tab).toBe('money');
    expect(tabFor('offer_expiring')?.tab).toBe('money');
    expect(tabFor('free_window')?.tab).toBe('calendar');
    expect(tabFor('correlation_probe')?.tab).toBe('discoveries');
    expect(tabFor('musing_health')?.tab).toBe('discoveries');
    expect(tabFor('family_apart')?.tab).toBe('family');
    expect(tabFor('rule_proposed')?.tab).toBe('engine');
  });

  it('returns null rather than guessing at an unknown kind', () => {
    expect(tabFor('something_nobody_has_written_yet')).toBeNull();
  });
});

describe('thoughtDestination', () => {
  it('prefers the place, and names it when it has a name', () => {
    const d = thoughtDestination({ kind: 'unknown_place', placeId: 'p1', placeLabel: 'Costa Coffee' });
    expect(d).toEqual({
      href: '/jkai/daydreams?tab=places#place-p1',
      label: 'Costa Coffee in Places',
      external: false,
    });
  });

  it('still links an unnamed place — the map is the point', () => {
    const d = thoughtDestination({ kind: 'unknown_place', placeId: 'p9', placeLabel: null });
    expect(d?.href).toBe('/jkai/daydreams?tab=places#place-p9');
    expect(d?.label).toBe('this place in Places');
  });

  it('beats the tab lookup with a named entity', () => {
    const d = thoughtDestination({
      kind: 'intel_broker',
      evidence: [{ kind: 'intel', id: 'i1' }, { kind: 'intel-entity', id: 'e7' }],
    });
    expect(d?.href).toBe('/jkai/intel/entities/e7');
    expect(d?.external).toBe(true);
  });

  it('falls back to the graph index when only the finding is named', () => {
    const d = thoughtDestination({ kind: 'intel_hub', evidence: [{ kind: 'intel', id: 'i1' }] });
    expect(d?.href).toBe('/jkai/intel');
  });

  it('reaches the woven note once the owner has endorsed it', () => {
    const d = thoughtDestination({ kind: 'musing_money', intelNoteId: 'n4' });
    expect(d?.href).toBe('/jkai/intel/notes/n4');
  });

  it('links the message a mail thought was read out of', () => {
    const d = thoughtDestination({ kind: 'mail_security', evidence: [{ kind: 'email', id: 'm2' }] });
    expect(d?.href).toBe('/jkai/intel/notes/m2');
  });

  it('falls through to the tab that answers the kind', () => {
    expect(thoughtDestination({ kind: 'spend_duplicate' })?.href).toBe('/jkai/daydreams?tab=money');
  });

  it('is null when nothing behind the card is reachable', () => {
    expect(thoughtDestination({ kind: 'brand_new_detector', evidence: [] })).toBeNull();
  });

  it('never returns an entity link for an evidence list of the wrong kind', () => {
    // A trail ref is not an entity id; linking it would 404.
    expect(thoughtDestination({ kind: 'zzz', evidence: [{ kind: 'trail', id: 't1' }] })).toBeNull();
  });
});

describe('hasMap', () => {
  it('is true only for a thought pinned to a place cluster', () => {
    expect(hasMap({ kind: 'unknown_place', placeId: 'p1' })).toBe(true);
    expect(hasMap({ kind: 'unknown_place', placeId: null })).toBe(false);
    expect(hasMap({ kind: 'spend_duplicate' })).toBe(false);
  });
});
