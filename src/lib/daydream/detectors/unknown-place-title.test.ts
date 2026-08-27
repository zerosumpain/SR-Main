import { describe, it, expect } from 'vitest';
import { unknownPlace } from './unknown-place';
import type { DaydreamSnapshot, PlaceSummary } from '../snapshot-types';

function place(over: Partial<PlaceSummary>): PlaceSummary {
  return {
    id: 'p1', lat: 0, lon: 0, radiusM: 200, label: null,
    suggestedLabel: null, suggestedAddress: null,
    kind: 'unknown', source: 'inferred', visitCount: 5, medianDwellMins: 40,
    dayHistogram: [2, 1, 1, 0, 1, 0, 0], hourHistogram: new Array(24).fill(1),
    firstSeenAt: null, lastSeenAt: null, status: 'active',
    ...over,
  };
}

function snap(places: PlaceSummary[]): DaydreamSnapshot {
  return {
    now: new Date('2026-08-26T12:00:00Z'),
    localDate: '2026-08-26', localDay: 2, localHour: 13, isWeekday: true,
    current: null, trail: [], trailDays: 30, trailSpanDays: 30,
    places, coverage: { last24h: 1, last7d: 1 },
    health: { lastNightSleep: null, sleepBaseline: null, readiness: null, daysSinceWorkout: null, trainingLoad: null },
    calendar: { events: [], partial: false, available: true },
    interests: [], offers: { available: false, items: [] }, memories: [], family: { available: false, members: [] }, sources: [],
  };
}

describe('unknown_place asks about somewhere recognisable', () => {
  // The bug this fixes: ten rows in production read "What is this place you
  // keep going to?" and named nothing. That question is unanswerable on a
  // phone and unanswerable on the ledger.
  it('asks by name when the geocoder has one', () => {
    const [c] = unknownPlace.detect(snap([place({ suggestedLabel: 'Hush Digital' })]));
    expect(c.title).toBe('Is this Hush Digital?');
  });

  it('includes the address in the explanation so it can be placed', () => {
    const [c] = unknownPlace.detect(
      snap([place({ suggestedLabel: 'Cockerton Fisheries', suggestedAddress: '311, Woodland Road' })]),
    );
    expect(c.explanation).toContain('Cockerton Fisheries');
    expect(c.explanation).toContain('311, Woodland Road');
  });

  it('falls back to the street when there is no name', () => {
    const [c] = unknownPlace.detect(snap([place({ suggestedAddress: 'Coniscliffe Road, Darlington' })]));
    expect(c.title).toContain('Coniscliffe Road');
  });

  // Only when it genuinely knows nothing does it ask the old question.
  it('asks the bare question only when it knows nothing at all', () => {
    const [c] = unknownPlace.detect(snap([place({})]));
    expect(c.title).toBe('What is this place you keep going to?');
  });

  // A suggestion identifies a place in a question. It is not a label, and
  // nothing downstream may read it as one.
  it('never treats a suggestion as an answer', () => {
    const c = unknownPlace.detect(snap([place({ suggestedLabel: 'Hush Digital' })]));
    expect(c).toHaveLength(1);
    expect(c[0].proposedActions.some((a) => a.kind === 'name_place')).toBe(true);
  });

  it('stops asking once the place actually has a name', () => {
    expect(unknownPlace.detect(snap([place({ label: 'Hush Digital' })]))).toHaveLength(0);
  });
});
