import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/file-index/search', () => ({ searchFiles: vi.fn() }));
vi.mock('$lib/deepdive/research-search', () => ({ searchResearch: vi.fn() }));
vi.mock('drizzle-orm', () => ({ and: () => ({}), desc: () => ({}), ilike: () => ({}), isNull: () => ({}) }));
vi.mock('$lib/db/schema', () => ({ jkaiMemories: { content: 'c', supersededBy: 's', updatedAt: 'u' } }));

const memRows: unknown[] = [];
vi.mock('$lib/db', () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(memRows),
  };
  return { db: chain };
});

const dsCollections: Array<{ slug: string; isSystem: boolean }> = [];
const dsRecords: Record<string, Array<{ key: string; id: string; data: unknown }>> = {};
vi.mock('$lib/datastore', () => ({
  listCollections: vi.fn(async () => dsCollections),
  queryRecords: vi.fn(async (slug: string) => ({ records: dsRecords[slug] ?? [] })),
}));

import { searchFiles } from '$lib/file-index/search';
import { searchResearch } from '$lib/deepdive/research-search';
import { searchKnowledge } from './search';

beforeEach(() => {
  vi.clearAllMocks();
  memRows.length = 0;
  dsCollections.length = 0;
  for (const k of Object.keys(dsRecords)) delete dsRecords[k];
});

describe('searchKnowledge', () => {
  it('merges all stores and ranks by score descending', async () => {
    vi.mocked(searchFiles).mockResolvedValue([
      { fileId: 'f1', source: 'notes.pdf', modality: 'text', chunkOrd: 0, charStart: 0, charEnd: 9, passage: 'file bit', score: 0.9 },
    ] as never);
    vi.mocked(searchResearch).mockResolvedValue([
      { kind: 'fact', factId: 'r1', passage: 'research bit', score: 0.6, confidence: 1, sessionId: 's1', sessionTopic: 'Topic', sourceId: null, sourceTitle: null, sourceUrl: null, domain: null },
    ] as never);
    memRows.push({ id: 'm1', category: 'people', content: 'memory bit', supersededBy: null, updatedAt: new Date() });
    dsCollections.push({ slug: 'notes', isSystem: false });
    dsRecords.notes = [{ key: 'k1', id: 'k1', data: { title: 'a datastore thing' } }];

    const r = await searchKnowledge('thing');
    expect(r.hits.map((h) => h.source)).toEqual(['files', 'research', 'memory', 'datastore']); // 0.9, 0.6, 0.45, 0.45
    expect(r.counts).toMatchObject({ files: 1, research: 1, memory: 1, datastore: 1 });
    expect(r.errors).toEqual({});
  });

  it('is resilient — a failing store is recorded, others still return', async () => {
    vi.mocked(searchFiles).mockResolvedValue([
      { fileId: 'f1', source: 'x', modality: 'text', chunkOrd: 0, charStart: 0, charEnd: 1, passage: 'ok', score: 0.8 },
    ] as never);
    vi.mocked(searchResearch).mockRejectedValue(new Error('pgvector down'));

    const r = await searchKnowledge('x', { sources: ['files', 'research'] });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].source).toBe('files');
    expect(r.errors.research).toContain('pgvector down');
  });

  it('only searches the requested sources', async () => {
    memRows.push({ id: 'm1', category: 'places', content: 'london', supersededBy: null, updatedAt: new Date() });
    const r = await searchKnowledge('london', { sources: ['memory'] });
    expect(searchFiles).not.toHaveBeenCalled();
    expect(searchResearch).not.toHaveBeenCalled();
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].source).toBe('memory');
  });

  it('datastore branch keyword-matches record JSON and skips system collections', async () => {
    dsCollections.push({ slug: 'sys', isSystem: true }, { slug: 'notes', isSystem: false });
    dsRecords.notes = [
      { key: 'a', id: 'a', data: { body: 'contains WIDGET here' } },
      { key: 'b', id: 'b', data: { body: 'nothing relevant' } },
    ];
    const r = await searchKnowledge('widget', { sources: ['datastore'] });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].ref).toMatchObject({ collection: 'notes', key: 'a' });
  });
});
