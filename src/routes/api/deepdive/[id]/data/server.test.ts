import { describe, it, expect, vi, beforeEach } from 'vitest';

// Per-table fixtures keyed by the drizzle table object passed to .from(table).
let sessionRow: any = { id: 'sess-1', report: { entity_centrality: { 'e1': 0.5 } } };
const factRows = [
  { id: 'f1', content: 'fact one', confidence: 0.9, eventDate: null, isCounterfactual: false, refutesFactId: null, sourceId: 's1', tags: [] },
];
const entityRows = [{ id: 'e1', name: 'Acme', type: 'org', description: null }];
const sourceRows = [{ id: 's1', url: 'http://x', title: 'X', domain: 'x.com', category: 'news', credibilityScore: 0.8, credibilityType: 'news' }];
const relationshipRows = [{ id: 'r1', fromEntityId: 'e1', toEntityId: 'e1', relationshipType: 'rel', sentiment: 'neutral' }];
const mentionRows = [{ entityId: 'e1', factId: 'f1' }];

vi.mock('$lib/db/schema', () => ({
  researchSessions: { __t: 'researchSessions', id: {}, report: {} },
  facts: { __t: 'facts', id: {}, content: {}, confidence: {}, eventDate: {}, isCounterfactual: {}, refutesFactId: {}, sourceId: {}, tags: {} },
  entities: { __t: 'entities', sessionId: {} },
  sources: { __t: 'sources', id: {}, url: {}, title: {}, domain: {}, category: {}, credibilityScore: {}, credibilityType: {}, sessionId: {} },
  relationships: { __t: 'relationships', id: {}, fromEntityId: {}, toEntityId: {}, relationshipType: {}, sentiment: {}, sessionId: {} },
  entityMentions: { __t: 'entityMentions', entityId: {}, factId: {}, sessionId: {} },
}));

vi.mock('drizzle-orm', () => ({ eq: (..._a: any[]) => ({}) }));

vi.mock('$lib/db', () => {
  function rowsFor(table: any) {
    switch (table?.__t) {
      case 'researchSessions': return sessionRow ? [sessionRow] : [];
      case 'facts': return factRows;
      case 'entities': return entityRows;
      case 'sources': return sourceRows;
      case 'relationships': return relationshipRows;
      case 'entityMentions': return mentionRows;
      default: return [];
    }
  }
  // Builder supports both .limit() (session lookup) and .where() terminal awaits.
  const makeBuilder = (table: any) => {
    const result = rowsFor(table);
    const thenable: any = {
      where: () => ({ limit: async () => result, then: (r: any) => Promise.resolve(result).then(r) }),
      then: (r: any) => Promise.resolve(result).then(r),
    };
    // db.select(cols).from(table).where(...) returns a promise-like resolving to rows
    return { from: (_t?: any) => ({ where: () => Promise.resolve(result) }), ...thenable };
  };
  const db = {
    select: (_cols?: any) => ({
      from: (table: any) => ({
        where: () => ({ limit: async () => rowsFor(table) }),
      }),
    }),
  };
  // Override: the session lookup uses .limit(); the table queries terminate on .where().
  db.select = (_cols?: any) => ({
    from: (table: any) => {
      const result = rowsFor(table);
      const whereObj: any = (() => result);
      return {
        where: () => {
          const p: any = Promise.resolve(result);
          p.limit = async () => result;
          return p;
        },
      };
    },
  });
  return { db };
});

import { GET } from './+server';

function makeEvent(id: string) {
  return { params: { id } } as any;
}

beforeEach(() => {
  sessionRow = { id: 'sess-1', report: { entity_centrality: { 'e1': 0.5 } } };
});

describe('GET /api/deepdive/[id]/data', () => {
  it('includes entityMentions as {entityId,factId}[]', async () => {
    const res = await GET(makeEvent('sess-1'));
    const payload = await res.json();
    expect(payload.entityMentions).toEqual([{ entityId: 'e1', factId: 'f1' }]);
  });

  it('still returns facts/entities/sources/relationships', async () => {
    const res = await GET(makeEvent('sess-1'));
    const payload = await res.json();
    expect(payload.facts).toHaveLength(1);
    expect(payload.entities[0].centrality).toBe(0.5);
    expect(payload.sources).toHaveLength(1);
    expect(payload.relationships).toHaveLength(1);
  });

  it('404s when the session is missing', async () => {
    sessionRow = null;
    const res = await GET(makeEvent('nope'));
    expect(res.status).toBe(404);
  });
});
