import { describe, it, expect } from 'vitest';
import {
  diffAgainstGraph,
  MAX_NEW_TYPES_PER_EXTRACTION,
  type GraphEdgeRef,
  type GraphEntityRef,
  type GraphLookup,
  type GraphTypeRef,
} from './ingest-preview';
import type { ExtractionResult } from './extract';

// ---------------------------------------------------------------------------
// A GraphLookup backed by plain Maps — the whole point of the injected lookup.
// ---------------------------------------------------------------------------

interface FakeGraph {
  entities?: GraphEntityRef[];
  /** Extra names (aliases) resolving to an entity id. */
  aliases?: Record<string, string>;
  edges?: Array<GraphEdgeRef & { sourceId: string; targetId: string }>;
  types?: GraphTypeRef[];
  events?: Array<{ date: string; title: string }>;
}

function lookupFor(graph: FakeGraph = {}): GraphLookup {
  const byId = new Map((graph.entities ?? []).map((e) => [e.id, e]));
  const byName = new Map((graph.entities ?? []).map((e) => [e.name.toLowerCase(), e]));
  for (const [alias, id] of Object.entries(graph.aliases ?? {})) {
    const target = byId.get(id);
    if (target) byName.set(alias.toLowerCase(), target);
  }
  const edges = new Map(
    (graph.edges ?? []).map((e) => [`${e.sourceId}|${e.targetId}|${e.type.toLowerCase()}`, e as GraphEdgeRef]),
  );
  const types = new Map((graph.types ?? []).map((t) => [t.name.toLowerCase(), t]));
  const events = new Set((graph.events ?? []).map((e) => `${e.date}|${e.title.toLowerCase()}`));

  return {
    findEntity: (name) => byName.get(name.trim().toLowerCase()) ?? null,
    findEntityById: (id) => byId.get(id) ?? null,
    findRelationship: (s, t, type) => edges.get(`${s}|${t}|${type.toLowerCase()}`) ?? null,
    findType: (name) => types.get(name.trim().toLowerCase()) ?? null,
    findTimelineEvent: (date, title) => (events.has(`${date}|${title.toLowerCase()}`) ? { id: 'e1' } : null),
  };
}

function extraction(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    summary: 'A summary.',
    entities: [],
    relationships: [],
    timelineEvents: [],
    proposedNewTypes: [],
    ...over,
  };
}

const entity = (name: string, type: string, possibleMatchId: string | null = null) => ({
  name,
  type,
  confidence: 'high' as const,
  properties: {},
  possibleMatchId,
});

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

describe('diffAgainstGraph — entities', () => {
  it('classifies an unknown name as new', () => {
    const diff = diffAgainstGraph(extraction({ entities: [entity('Alice Braun', 'person')] }), lookupFor());
    expect(diff.entities[0]).toMatchObject({ status: 'new', matchedId: null });
    expect(diff.totals.newEntities).toBe(1);
  });

  it('classifies a name already in the graph, at the same type, as existing', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('Alice Braun', 'person')] }),
      lookupFor({ entities: [{ id: 'e1', name: 'Alice Braun', typeName: 'person' }] }),
    );
    expect(diff.entities[0]).toMatchObject({ status: 'existing', matchedId: 'e1', matchedType: 'person' });
    expect(diff.totals.existingEntities).toBe(1);
    expect(diff.totals.newEntities).toBe(0);
  });

  it('matches case-insensitively', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('alice braun', 'PERSON')] }),
      lookupFor({ entities: [{ id: 'e1', name: 'Alice Braun', typeName: 'person' }] }),
    );
    expect(diff.entities[0].status).toBe('existing');
  });

  it('calls a type disagreement a conflict and says the existing type wins', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('Responsible AI Strategy', 'policy')] }),
      lookupFor({ entities: [{ id: 'e1', name: 'Responsible AI Strategy', typeName: 'project' }] }),
    );
    expect(diff.entities[0]).toMatchObject({ status: 'conflict', matchedId: 'e1', matchedType: 'project' });
    expect(diff.entities[0].reason).toMatch(/existing type is kept/i);
    expect(diff.totals.conflicts).toBe(1);
  });

  it('resolves the extractor possibleMatchId ahead of the name', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('IBCA', 'organisation', 'e1')] }),
      lookupFor({ entities: [{ id: 'e1', name: 'Infected Blood Compensation Authority', typeName: 'organisation' }] }),
    );
    expect(diff.entities[0]).toMatchObject({ status: 'existing', matchedId: 'e1' });
    expect(diff.entities[0].reason).toMatch(/different surface form/i);
  });

  it('treats a stale possibleMatchId as a new entity, and says so', () => {
    const diff = diffAgainstGraph(extraction({ entities: [entity('IBCA', 'organisation', 'gone')] }), lookupFor());
    expect(diff.entities[0].status).toBe('new');
    expect(diff.entities[0].reason).toMatch(/no longer exists/i);
  });

  it('resolves through an alias', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('IBCA', 'organisation')] }),
      lookupFor({
        entities: [{ id: 'e1', name: 'Infected Blood Compensation Authority', typeName: 'organisation' }],
        aliases: { IBCA: 'e1' },
      }),
    );
    expect(diff.entities[0]).toMatchObject({ status: 'existing', matchedId: 'e1' });
  });

  it('flags an entity the extraction names twice with two different types', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('Keystone', 'project'), entity('Keystone', 'system')] }),
      lookupFor(),
    );
    expect(diff.entities[0].status).toBe('new');
    expect(diff.entities[1].status).toBe('conflict');
    expect(diff.entities[1].reason).toMatch(/twice/i);
  });

  it('does not flag a harmless duplicate of the same type', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('Keystone', 'project'), entity('Keystone', 'project')] }),
      lookupFor(),
    );
    expect(diff.entities[1].status).toBe('existing');
    expect(diff.totals.conflicts).toBe(0);
  });

  it('flags an unnamed entity rather than silently dropping it', () => {
    const diff = diffAgainstGraph(extraction({ entities: [entity('  ', 'person')] }), lookupFor());
    expect(diff.entities[0].status).toBe('conflict');
  });
});

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

describe('diffAgainstGraph — relationships', () => {
  const rel = (source: string, target: string, type = 'works_on', label = 'works on') => ({
    source,
    target,
    type,
    label,
    confidence: 'high' as const,
  });

  it('classifies an edge between two known entities that has never been seen as new', () => {
    const diff = diffAgainstGraph(
      extraction({
        entities: [entity('Alice Braun', 'person'), entity('Keystone', 'project')],
        relationships: [rel('Alice Braun', 'Keystone')],
      }),
      lookupFor({
        entities: [
          { id: 'e1', name: 'Alice Braun', typeName: 'person' },
          { id: 'e2', name: 'Keystone', typeName: 'project' },
        ],
      }),
    );
    expect(diff.relationships[0]).toMatchObject({ status: 'new', willApply: true });
    expect(diff.totals.newRelationships).toBe(1);
  });

  it('classifies an edge already in the graph as existing', () => {
    const diff = diffAgainstGraph(
      extraction({
        entities: [entity('Alice Braun', 'person'), entity('Keystone', 'project')],
        relationships: [rel('Alice Braun', 'Keystone')],
      }),
      lookupFor({
        entities: [
          { id: 'e1', name: 'Alice Braun', typeName: 'person' },
          { id: 'e2', name: 'Keystone', typeName: 'project' },
        ],
        edges: [{ id: 'r1', sourceId: 'e1', targetId: 'e2', type: 'works_on' }],
      }),
    );
    expect(diff.relationships[0]).toMatchObject({ status: 'existing', willApply: true });
    expect(diff.totals.existingRelationships).toBe(1);
  });

  it('calls a suppressed edge a conflict that will not be re-created', () => {
    const diff = diffAgainstGraph(
      extraction({
        entities: [entity('Alice Braun', 'person'), entity('Keystone', 'project')],
        relationships: [rel('Alice Braun', 'Keystone')],
      }),
      lookupFor({
        entities: [
          { id: 'e1', name: 'Alice Braun', typeName: 'person' },
          { id: 'e2', name: 'Keystone', typeName: 'project' },
        ],
        edges: [
          { id: 'r1', sourceId: 'e1', targetId: 'e2', type: 'works_on', suppressed: true, suppressedReason: 'she left' },
        ],
      }),
    );
    expect(diff.relationships[0]).toMatchObject({ status: 'conflict', willApply: false });
    expect(diff.relationships[0].reason).toContain('she left');
    expect(diff.totals.conflicts).toBe(1);
    expect(diff.totals.dropped).toBe(1);
  });

  it('warns that a manual label survives a relabel', () => {
    const diff = diffAgainstGraph(
      extraction({
        entities: [entity('Alice Braun', 'person'), entity('Keystone', 'project')],
        relationships: [rel('Alice Braun', 'Keystone', 'works_on', 'leads')],
      }),
      lookupFor({
        entities: [
          { id: 'e1', name: 'Alice Braun', typeName: 'person' },
          { id: 'e2', name: 'Keystone', typeName: 'project' },
        ],
        edges: [{ id: 'r1', sourceId: 'e1', targetId: 'e2', type: 'works_on', label: 'sponsors', manual: true }],
      }),
    );
    expect(diff.relationships[0]).toMatchObject({ status: 'existing', willApply: true });
    expect(diff.relationships[0].reason).toContain('sponsors');
  });

  it('reports an edge whose endpoint was not extracted as a silent drop', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('Alice Braun', 'person')], relationships: [rel('Alice Braun', 'Keystone')] }),
      lookupFor(),
    );
    expect(diff.relationships[0]).toMatchObject({ status: 'new', willApply: false });
    expect(diff.relationships[0].reason).toMatch(/Keystone is not among the extracted entities/);
    expect(diff.totals.newRelationships).toBe(0);
    expect(diff.totals.dropped).toBe(1);
  });

  it('drops a self-loop by name', () => {
    const diff = diffAgainstGraph(
      extraction({ entities: [entity('Keystone', 'project')], relationships: [rel('Keystone', 'Keystone')] }),
      lookupFor(),
    );
    expect(diff.relationships[0]).toMatchObject({ status: 'new', willApply: false });
    expect(diff.relationships[0].reason).toMatch(/self-loop/i);
  });

  it('drops a self-loop that only becomes one after resolution', () => {
    const diff = diffAgainstGraph(
      extraction({
        entities: [entity('IBCA', 'organisation', 'e1'), entity('Infected Blood Compensation Authority', 'organisation', 'e1')],
        relationships: [rel('IBCA', 'Infected Blood Compensation Authority', 'part_of')],
      }),
      lookupFor({ entities: [{ id: 'e1', name: 'Infected Blood Compensation Authority', typeName: 'organisation' }] }),
    );
    expect(diff.relationships[0].willApply).toBe(false);
    expect(diff.relationships[0].reason).toMatch(/self-loop/i);
  });

  it('counts a duplicate edge in the same extraction only once', () => {
    const diff = diffAgainstGraph(
      extraction({
        entities: [entity('Alice Braun', 'person'), entity('Keystone', 'project')],
        relationships: [rel('Alice Braun', 'Keystone'), rel('Alice Braun', 'Keystone')],
      }),
      lookupFor({
        entities: [
          { id: 'e1', name: 'Alice Braun', typeName: 'person' },
          { id: 'e2', name: 'Keystone', typeName: 'project' },
        ],
      }),
    );
    expect(diff.totals.newRelationships).toBe(1);
    expect(diff.relationships[1].reason).toMatch(/duplicated/i);
  });

  it('treats an edge between two brand-new entities as new', () => {
    const diff = diffAgainstGraph(
      extraction({
        entities: [entity('Alice Braun', 'person'), entity('Keystone', 'project')],
        relationships: [rel('Alice Braun', 'Keystone')],
      }),
      lookupFor(),
    );
    expect(diff.relationships[0]).toMatchObject({ status: 'new', willApply: true });
  });
});

// ---------------------------------------------------------------------------
// Timeline + type proposals
// ---------------------------------------------------------------------------

describe('diffAgainstGraph — timeline events', () => {
  const event = (date: string, title: string) => ({ date, title, type: 'deadline' as const });

  it('classifies an unseen event as new', () => {
    const diff = diffAgainstGraph(extraction({ timelineEvents: [event('2026-08-01', 'Go live')] }), lookupFor());
    expect(diff.timelineEvents[0].status).toBe('new');
    expect(diff.totals.newTimelineEvents).toBe(1);
  });

  it('classifies a repeat of an existing event as existing', () => {
    const diff = diffAgainstGraph(
      extraction({ timelineEvents: [event('2026-08-01', 'Go live')] }),
      lookupFor({ events: [{ date: '2026-08-01', title: 'Go live' }] }),
    );
    expect(diff.timelineEvents[0].status).toBe('existing');
    expect(diff.totals.newTimelineEvents).toBe(0);
  });

  it('flags an event missing a date or title', () => {
    const diff = diffAgainstGraph(extraction({ timelineEvents: [event('', 'Go live')] }), lookupFor());
    expect(diff.timelineEvents[0].status).toBe('conflict');
  });
});

describe('diffAgainstGraph — proposed types', () => {
  const type = (name: string) => ({ name, description: 'd', icon: '🔷' });

  it('says a genuinely new type would be held for review, not admitted', () => {
    const diff = diffAgainstGraph(extraction({ proposedNewTypes: [type('dataset')] }), lookupFor());
    expect(diff.proposedTypes[0]).toMatchObject({ status: 'new', willApply: true });
    expect(diff.proposedTypes[0].reason).toMatch(/held for review/i);
    expect(diff.totals.newTypes).toBe(1);
  });

  it('recognises a type that already exists', () => {
    const diff = diffAgainstGraph(
      extraction({ proposedNewTypes: [type('person')] }),
      lookupFor({ types: [{ name: 'person', status: 'active' }] }),
    );
    expect(diff.proposedTypes[0]).toMatchObject({ status: 'existing', willApply: false });
  });

  it('recognises a type already awaiting review', () => {
    const diff = diffAgainstGraph(
      extraction({ proposedNewTypes: [type('dataset')] }),
      lookupFor({ types: [{ name: 'dataset', status: 'proposed' }] }),
    );
    expect(diff.proposedTypes[0].reason).toMatch(/awaiting review/i);
    expect(diff.totals.newTypes).toBe(0);
  });

  it('calls re-proposing a retired type a conflict', () => {
    const diff = diffAgainstGraph(
      extraction({ proposedNewTypes: [type('font')] }),
      lookupFor({ types: [{ name: 'font', status: 'retired' }] }),
    );
    expect(diff.proposedTypes[0].status).toBe('conflict');
    expect(diff.totals.conflicts).toBe(1);
  });

  it('honours the per-extraction proposal cap the writer enforces', () => {
    const proposals = ['a_type', 'b_type', 'c_type', 'd_type'].map(type);
    const diff = diffAgainstGraph(extraction({ proposedNewTypes: proposals }), lookupFor());
    expect(diff.totals.newTypes).toBe(MAX_NEW_TYPES_PER_EXTRACTION);
    expect(diff.proposedTypes.slice(MAX_NEW_TYPES_PER_EXTRACTION).every((t) => !t.willApply)).toBe(true);
    expect(diff.proposedTypes[MAX_NEW_TYPES_PER_EXTRACTION].reason).toMatch(/cap/i);
  });
});

describe('diffAgainstGraph — shape', () => {
  it('carries the extraction summary through and handles an empty extraction', () => {
    const diff = diffAgainstGraph(extraction(), lookupFor());
    expect(diff.summary).toBe('A summary.');
    expect(diff.entities).toEqual([]);
    expect(diff.totals).toEqual({
      newEntities: 0,
      existingEntities: 0,
      newRelationships: 0,
      existingRelationships: 0,
      newTimelineEvents: 0,
      newTypes: 0,
      conflicts: 0,
      dropped: 0,
    });
  });

  it('survives an extraction with missing arrays', () => {
    const diff = diffAgainstGraph({ summary: '' } as unknown as ExtractionResult, lookupFor());
    expect(diff.totals.conflicts).toBe(0);
    expect(diff.relationships).toEqual([]);
  });

  it('works without the optional timeline lookup', () => {
    const partial: GraphLookup = {
      findEntity: () => null,
      findEntityById: () => null,
      findRelationship: () => null,
      findType: () => null,
    };
    const diff = diffAgainstGraph(
      extraction({ timelineEvents: [{ date: '2026-08-01', title: 'Go live', type: 'deadline' }] }),
      partial,
    );
    expect(diff.timelineEvents[0].status).toBe('new');
  });
});
