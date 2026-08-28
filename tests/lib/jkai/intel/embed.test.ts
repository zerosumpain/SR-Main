import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn().mockResolvedValue({
    client: {
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      },
    },
    model: 'test',
  }),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'test' }),
}));
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: '1', processedContent: 'test content', rawContent: 'test' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({
  intelNotes: { id: 'id', processedContent: 'processed_content', rawContent: 'raw_content', embedding: 'embedding' },
  intelEntities: { id: 'id', embedding: 'embedding' },
}));

import { generateEmbedding } from '$lib/jkai/intel/embed';

describe('generateEmbedding', () => {
  it('returns a 1536-dimension vector', async () => {
    const result = await generateEmbedding('test text');
    expect(result).toHaveLength(1536);
    expect(result[0]).toBe(0.1);
  });
});
