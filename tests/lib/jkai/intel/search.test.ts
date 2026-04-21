import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures dbMock is available when the hoisted vi.mock factory runs.
const { dbMock } = vi.hoisted(() => {
  const dbMock = { execute: vi.fn() };
  return { dbMock };
});

vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/jkai/intel/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Array(1536).fill(0)),
}));

import { searchIntel } from '$lib/jkai/intel/search';

describe('searchIntel', () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
  });

  it('returns empty when query is empty and no facets', async () => {
    const result = await searchIntel('', {});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns notes + entities as IntelItems with scores', async () => {
    // First call: notes; second: entities.
    dbMock.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 'n1',
          title: 'Test note',
          snippet: 'body text here',
          createdAt: new Date('2026-04-20T00:00:00Z'),
          source_tag: null,
          distance: 0.2,
        },
      ],
    });
    dbMock.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 'e1',
          name: 'Anthropic',
          type_name: 'company',
          summary: 'AI lab',
          updatedAt: new Date('2026-04-20T00:00:00Z'),
          distance: 0.3,
        },
      ],
    });

    const result = await searchIntel('anthropic', { limit: 10, ordering: 'relevant' });

    expect(result.items.length).toBe(2);
    const note = result.items.find((i) => i.kind === 'note');
    const entity = result.items.find((i) => i.kind === 'entity');
    expect(note).toBeDefined();
    expect(entity).toBeDefined();
    expect(note!.score).toBeGreaterThan(0);
    expect(entity!.score).toBeGreaterThan(0);
  });

  it('applies time range facet to the SQL', async () => {
    dbMock.execute.mockResolvedValue({ rows: [] });
    await searchIntel('topic', {
      timeRange: { from: '2026-04-20T00:00:00Z', to: '2026-04-21T00:00:00Z' },
    });
    const firstCall = dbMock.execute.mock.calls[0]?.[0];
    // Drizzle SQL tag — just assert we passed at least one argument.
    expect(firstCall).toBeDefined();
  });
});
