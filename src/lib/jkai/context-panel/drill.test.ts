import { describe, expect, it } from 'vitest';
import { drillKey, entityDrillKey, parseDrillTarget, relativeStamp, type DrillTarget } from './drill';

describe('parseDrillTarget', () => {
  it('round-trips every target through drillKey', () => {
    const targets: DrillTarget[] = [
      { kind: 'entities', filter: 'all' },
      { kind: 'entities', filter: 'known' },
      { kind: 'relations' },
      { kind: 'entity', id: '9c1f2a4e-1' },
      { kind: 'research-desk', filter: 'active' },
      { kind: 'research-run', id: 'run_1' },
      { kind: 'thoughts', filter: 'reviewed' },
      { kind: 'thought', id: 't1' },
      { kind: 'places', filter: 'named' },
      { kind: 'place', id: 'p1' },
      { kind: 'memories', filter: 'served' },
      { kind: 'memory', id: 'm1' },
      { kind: 'card', lens: 'health', cardId: 'health-today', metric: null },
      { kind: 'card', lens: 'health', cardId: 'health-today', metric: 'Sleep score' },
    ];
    for (const t of targets) expect(parseDrillTarget(drillKey(t))).toEqual(t);
  });

  it('defaults a bare list to the all filter', () => {
    expect(parseDrillTarget('entities')).toEqual({ kind: 'entities', filter: 'all' });
    expect(parseDrillTarget('thoughts')).toEqual({ kind: 'thoughts', filter: 'all' });
  });

  it('refuses malformed keys rather than guessing', () => {
    expect(parseDrillTarget('')).toBeNull();
    expect(parseDrillTarget('entity')).toBeNull();
    expect(parseDrillTarget('entity:a:b')).toBeNull();
    expect(parseDrillTarget('entity:has space')).toBeNull();
    expect(parseDrillTarget('thoughts:bogus')).toBeNull();
    expect(parseDrillTarget('memories')).toBeNull();
    expect(parseDrillTarget('card:health')).toBeNull();
    expect(parseDrillTarget('card:health:x:%E0%A4%A')).toBeNull();
    expect(parseDrillTarget('dossier:1')).toBeNull();
  });

  it('accepts a graph node id as an entity drill', () => {
    expect(entityDrillKey('entity:abc')).toBe('entity:abc');
    expect(entityDrillKey('model:gpt')).toBeNull();
    expect(entityDrillKey('entity:')).toBeNull();
  });
});

describe('relativeStamp', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  it('reads as a clock, not a date, for recent events', () => {
    expect(relativeStamp('2026-09-06T11:59:40Z', now)).toBe('just now');
    expect(relativeStamp('2026-09-06T11:15:00Z', now)).toBe('45m ago');
    expect(relativeStamp('2026-09-05T20:00:00Z', now)).toBe('16h ago');
    expect(relativeStamp('2026-09-01T12:00:00Z', now)).toBe('5d ago');
  });
  it('is empty for nothing and for garbage', () => {
    expect(relativeStamp(null, now)).toBe('');
    expect(relativeStamp('not a date', now)).toBe('');
  });
});
