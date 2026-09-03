import { describe, it, expect } from 'vitest';
import { mapSessionGraph, type SessionGraphRows } from './graph-commit';

const SESSION = 'sess-1';

function rows(partial: Partial<SessionGraphRows> = {}): SessionGraphRows {
  return {
    entities: [],
    relationships: [],
    mentions: [],
    datedFacts: [],
    ...partial,
  };
}

describe('mapSessionGraph — entities', () => {
  it('carries a session entity across with its research type recorded', () => {
    const { extraction } = mapSessionGraph(
      rows({
        entities: [
          { id: 'e1', name: 'Ofsted', type: 'organisation', description: 'The inspectorate' },
        ],
      }),
      SESSION,
    );

    expect(extraction.entities).toHaveLength(1);
    expect(extraction.entities[0]).toMatchObject({
      name: 'Ofsted',
      type: 'organisation',
      possibleMatchId: null,
    });
    expect(extraction.entities[0].properties).toMatchObject({
      description: 'The inspectorate',
      researchType: 'organisation',
      researchSessionId: SESSION,
    });
  });

  it("maps research's `other` onto a type intel actually has", () => {
    // Left unmapped, upsertEntity parks it under `concept` and logs a warning
    // for every entity in the dive.
    const { extraction } = mapSessionGraph(
      rows({ entities: [{ id: 'e1', name: 'X-Road', type: 'other', description: null }] }),
      SESSION,
    );
    expect(extraction.entities[0].type).toBe('concept');
    expect(extraction.entities[0].properties.researchType).toBe('other');
  });

  it('normalises the American spelling of organisation', () => {
    const { extraction } = mapSessionGraph(
      rows({ entities: [{ id: 'e1', name: 'Acme', type: 'organization', description: null }] }),
      SESSION,
    );
    expect(extraction.entities[0].type).toBe('organisation');
  });

  it('derives confidence from how many facts mention the entity', () => {
    const { extraction } = mapSessionGraph(
      rows({
        entities: [
          { id: 'e1', name: 'Well evidenced', type: 'concept', description: null },
          { id: 'e2', name: 'Mentioned once', type: 'concept', description: null },
          { id: 'e3', name: 'Never mentioned', type: 'concept', description: null },
        ],
        mentions: [
          { entityId: 'e1', n: 5 },
          { entityId: 'e2', n: 1 },
        ],
      }),
      SESSION,
    );

    const byName = new Map(extraction.entities.map((e) => [e.name, e.confidence]));
    expect(byName.get('Well evidenced')).toBe('high');
    expect(byName.get('Mentioned once')).toBe('medium');
    expect(byName.get('Never mentioned')).toBe('low');
  });

  it('collapses two rows with the same name, keeping the better-evidenced one', () => {
    // persistExtraction keys its id map by NAME. Two entities called the same
    // thing — which the check-then-insert race in phase 2 produces — would mean
    // the second silently overwrote the first and took its edges with it.
    const { extraction, summary } = mapSessionGraph(
      rows({
        entities: [
          { id: 'e1', name: 'Ofsted', type: 'organisation', description: 'thin' },
          { id: 'e2', name: 'ofsted', type: 'organisation', description: 'rich' },
        ],
        mentions: [{ entityId: 'e2', n: 4 }],
      }),
      SESSION,
    );

    expect(summary.entities).toBe(1);
    expect(extraction.entities[0].properties.description).toBe('rich');
    expect(extraction.entities[0].confidence).toBe('high');
  });
});

describe('mapSessionGraph — relationships', () => {
  const twoEntities = [
    { id: 'e1', name: 'Brett Murphy', type: 'person', description: null },
    { id: 'e2', name: 'Free Church of England', type: 'organisation', description: null },
  ];

  it('names both endpoints so persistExtraction can resolve them', () => {
    const { extraction } = mapSessionGraph(
      rows({
        entities: twoEntities,
        relationships: [
          {
            fromEntityId: 'e1',
            toEntityId: 'e2',
            relationshipType: 'licensed_by',
            sentiment: 'neutral',
            strength: 0.9,
          },
        ],
      }),
      SESSION,
    );

    expect(extraction.relationships).toEqual([
      {
        source: 'Brett Murphy',
        target: 'Free Church of England',
        type: 'licensed_by',
        label: 'licensed by',
        confidence: 'high',
      },
    ]);
  });

  it('folds a non-neutral sentiment into the readable label', () => {
    const { extraction } = mapSessionGraph(
      rows({
        entities: twoEntities,
        relationships: [
          {
            fromEntityId: 'e1',
            toEntityId: 'e2',
            relationshipType: 'opposed_to',
            sentiment: 'contested',
            strength: 0.5,
          },
        ],
      }),
      SESSION,
    );
    expect(extraction.relationships[0].label).toBe('opposed to (contested)');
    expect(extraction.relationships[0].confidence).toBe('medium');
  });

  it('buckets confidence from strength', () => {
    const build = (strength: number | null) =>
      mapSessionGraph(
        rows({
          entities: twoEntities,
          relationships: [
            {
              fromEntityId: 'e1',
              toEntityId: 'e2',
              relationshipType: 'linked_to',
              sentiment: 'neutral',
              strength,
            },
          ],
        }),
        SESSION,
      ).extraction.relationships[0].confidence;

    expect(build(0.9)).toBe('high');
    expect(build(0.5)).toBe('medium');
    expect(build(0.1)).toBe('low');
    expect(build(null)).toBe('medium');
  });

  it('drops an edge whose endpoint is missing', () => {
    const { extraction, summary } = mapSessionGraph(
      rows({
        entities: twoEntities,
        relationships: [
          {
            fromEntityId: 'e1',
            toEntityId: 'gone',
            relationshipType: 'linked_to',
            sentiment: 'neutral',
            strength: 0.5,
          },
          {
            fromEntityId: null,
            toEntityId: 'e2',
            relationshipType: 'linked_to',
            sentiment: 'neutral',
            strength: 0.5,
          },
        ],
      }),
      SESSION,
    );
    expect(extraction.relationships).toHaveLength(0);
    expect(summary.relationships).toBe(0);
  });

  it('drops a self-loop, which breaks the force layout downstream', () => {
    const { extraction } = mapSessionGraph(
      rows({
        entities: twoEntities,
        relationships: [
          {
            fromEntityId: 'e1',
            toEntityId: 'e1',
            relationshipType: 'is',
            sentiment: 'neutral',
            strength: 1,
          },
        ],
      }),
      SESSION,
    );
    expect(extraction.relationships).toHaveLength(0);
  });

  it('re-points an edge onto the surviving row when a duplicate name collapsed', () => {
    const { extraction } = mapSessionGraph(
      rows({
        entities: [
          { id: 'e1', name: 'Ofsted', type: 'organisation', description: null },
          { id: 'e1dup', name: 'ofsted', type: 'organisation', description: null },
          { id: 'e2', name: 'DfE', type: 'organisation', description: null },
        ],
        mentions: [{ entityId: 'e1', n: 3 }],
        relationships: [
          {
            fromEntityId: 'e1dup',
            toEntityId: 'e2',
            relationshipType: 'reports_to',
            sentiment: 'neutral',
            strength: 0.8,
          },
        ],
      }),
      SESSION,
    );

    // The edge hung off the duplicate; it must survive on the winner's name.
    expect(extraction.relationships).toHaveLength(1);
    expect(extraction.relationships[0].source).toBe('Ofsted');
  });

  it('deduplicates an edge asserted twice by different sources', () => {
    const edge = {
      fromEntityId: 'e1',
      toEntityId: 'e2',
      relationshipType: 'licensed_by',
      sentiment: 'neutral',
      strength: 0.6,
    };
    const { extraction } = mapSessionGraph(
      rows({ entities: twoEntities, relationships: [edge, { ...edge, strength: 0.9 }] }),
      SESSION,
    );
    expect(extraction.relationships).toHaveLength(1);
  });
});

describe('mapSessionGraph — timeline and types', () => {
  it('turns dated facts into timeline events', () => {
    const { extraction } = mapSessionGraph(
      rows({
        datedFacts: [
          { id: 'f1', content: 'The Act received royal assent.', eventDate: new Date('2024-05-24T00:00:00Z') },
        ],
      }),
      SESSION,
    );
    expect(extraction.timelineEvents).toEqual([
      { date: '2024-05-24', type: 'event', title: 'The Act received royal assent.', description: undefined },
    ]);
  });

  it('never proposes a new entity type from a bulk commit', () => {
    // Proposing a type is a reviewed decision about evidence somebody looked
    // at. Importing a thousand research entities is not that.
    const { extraction } = mapSessionGraph(
      rows({ entities: [{ id: 'e1', name: 'Thing', type: 'nonsense_type', description: null }] }),
      SESSION,
    );
    expect(extraction.proposedNewTypes).toEqual([]);
  });

  it('reports an empty session honestly rather than as a successful commit', () => {
    const { summary } = mapSessionGraph(rows(), SESSION);
    expect(summary).toEqual({ entities: 0, relationships: 0 });
  });
});
