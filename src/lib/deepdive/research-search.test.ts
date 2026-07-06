import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.execute and generateEmbedding are the only external touch-points; mock both
// so the retrieval logic (guards, query short-circuit, row → hit mapping,
// passage truncation) is unit-testable without a live DB or embedding API.
const mockExecute = vi.fn();
vi.mock('$lib/db', () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));

const mockEmbed = vi.fn();
vi.mock('./ai', () => ({ generateEmbedding: (...a: unknown[]) => mockEmbed(...a) }));

import { searchResearch } from './research-search';

beforeEach(() => {
  mockExecute.mockReset();
  mockEmbed.mockReset();
  mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
});

describe('searchResearch', () => {
  it('short-circuits on an empty/whitespace query without embedding or querying', async () => {
    expect(await searchResearch('')).toEqual([]);
    expect(await searchResearch('   ')).toEqual([]);
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('embeds the trimmed query and maps rows into hits', async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          fact_id: 'f1',
          content: 'The scheme cut NEET rates by 4pp over three years.',
          confidence: 0.82,
          session_id: 's1',
          session_topic: 'NEET interventions',
          source_id: 'src1',
          source_title: 'DfE evaluation',
          source_url: 'https://gov.uk/x',
          domain: 'gov.uk',
          similarity: 0.7134,
        },
      ],
    });

    const hits = await searchResearch('  what works to reduce NEET  ');
    expect(mockEmbed).toHaveBeenCalledWith('what works to reduce NEET');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([
      {
        factId: 'f1',
        passage: 'The scheme cut NEET rates by 4pp over three years.',
        score: 0.713,
        confidence: 0.82,
        sessionId: 's1',
        sessionTopic: 'NEET interventions',
        sourceId: 'src1',
        sourceTitle: 'DfE evaluation',
        sourceUrl: 'https://gov.uk/x',
        domain: 'gov.uk',
      },
    ]);
  });

  it('tolerates a fact with no source (LEFT JOIN nulls) and truncates long passages', async () => {
    const long = 'x'.repeat(1500);
    mockExecute.mockResolvedValue({
      rows: [
        {
          fact_id: 'f2',
          content: long,
          confidence: 0.5,
          session_id: 's2',
          session_topic: 'Topic',
          source_id: null,
          source_title: null,
          source_url: null,
          domain: null,
          similarity: 0.42,
        },
      ],
    });

    const [hit] = await searchResearch('anything');
    expect(hit.sourceId).toBeNull();
    expect(hit.sourceUrl).toBeNull();
    expect(hit.passage.endsWith('…')).toBe(true);
    expect(hit.passage.length).toBe(1201); // 1200 chars + ellipsis
  });

  it('nulls out a non-http(s) source url so it can never reach an href sink (XSS guard)', async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          fact_id: 'f3', content: 'x', confidence: 0.5, session_id: 's3', session_topic: 'T',
          source_id: 'src3', source_title: 'Evil', source_url: 'javascript:alert(document.cookie)',
          domain: 'evil', similarity: 0.9,
        },
        {
          fact_id: 'f4', content: 'y', confidence: 0.5, session_id: 's3', session_topic: 'T',
          source_id: 'src4', source_title: 'Data', source_url: 'data:text/html,<script>1</script>',
          domain: null, similarity: 0.8,
        },
        {
          fact_id: 'f5', content: 'z', confidence: 0.5, session_id: 's3', session_topic: 'T',
          source_id: 'src5', source_title: 'Good', source_url: 'https://gov.uk/ok',
          domain: 'gov.uk', similarity: 0.7,
        },
      ],
    });
    const hits = await searchResearch('q');
    expect(hits[0].sourceUrl).toBeNull(); // javascript:
    expect(hits[1].sourceUrl).toBeNull(); // data:
    expect(hits[2].sourceUrl).toBe('https://gov.uk/ok'); // http(s) allowed
  });

  it('does not throw on a non-finite limit (NaN clamps to the default)', async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    await expect(searchResearch('q', { topK: Number('abc') })).resolves.toEqual([]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
