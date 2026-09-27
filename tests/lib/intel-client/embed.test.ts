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
import { generateEmbedding } from '$lib/intel-client/embed';

describe('generateEmbedding', () => {
  it('returns a 1536-dimension vector', async () => {
    const result = await generateEmbedding('test text');
    expect(result).toHaveLength(1536);
    expect(result[0]).toBe(0.1);
  });
});
