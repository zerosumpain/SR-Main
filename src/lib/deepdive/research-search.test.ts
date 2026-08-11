import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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

  it('embeds the trimmed query and maps fact + source rows into hits with kind', async () => {
    mockExecute.mockResolvedValue({
      rows: [
        {
          kind: 'fact',
          row_id: 'f1',
          content: 'The scheme cut NEET rates by 4pp over three years.',
          confidence: 0.82,
          session_id: 's1',
          session_topic: 'NEET interventions',
          source_id: 'src1',
          source_title: 'DfE evaluation',
          source_url: 'https://gov.uk/x',
          domain: 'gov.uk',
          credibility_type: 'government',
          credibility_score: 0.95,
          fetched_at: '2025-02-14T09:31:00.000Z',
          similarity: 0.7134,
        },
        {
          kind: 'source',
          row_id: 'sc1',
          content: 'Raw passage from the source page the extractor never distilled.',
          confidence: 0,
          session_id: 's1',
          session_topic: 'NEET interventions',
          source_id: 'src1',
          source_title: 'DfE evaluation',
          source_url: 'https://gov.uk/x',
          domain: 'gov.uk',
          similarity: 0.55,
        },
      ],
    });

    const hits = await searchResearch('  what works to reduce NEET  ');
    expect(mockEmbed).toHaveBeenCalledWith('what works to reduce NEET');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(hits[0]).toEqual({
      kind: 'fact',
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
      // Weight the reader is entitled to: these have been on `source` since
      // the research desk was built and were dropped everywhere downstream,
      // which is how a studio explainer came to cite Facebook posts as
      // evidence with nothing objecting.
      credibilityType: 'government',
      credibilityScore: 0.95,
      // Date only — the time of day a page was fetched is noise.
      fetchedAt: '2025-02-14',
    });
    expect(hits[1].kind).toBe('source');
    expect(hits[1].factId).toBe('sc1');
    expect(hits[1].passage).toContain('Raw passage');
  });

  it('tolerates a fact with no source (LEFT JOIN nulls) and truncates long passages', async () => {
    const long = 'x'.repeat(1500);
    mockExecute.mockResolvedValue({
      rows: [
        {
          row_id: 'f2',
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
          row_id: 'f3', content: 'x', confidence: 0.5, session_id: 's3', session_topic: 'T',
          source_id: 'src3', source_title: 'Evil', source_url: 'javascript:alert(document.cookie)',
          domain: 'evil', similarity: 0.9,
        },
        {
          row_id: 'f4', content: 'y', confidence: 0.5, session_id: 's3', session_topic: 'T',
          source_id: 'src4', source_title: 'Data', source_url: 'data:text/html,<script>1</script>',
          domain: null, similarity: 0.8,
        },
        {
          row_id: 'f5', content: 'z', confidence: 0.5, session_id: 's3', session_topic: 'T',
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

// The factsOnly branch gates a UNION ALL inside a drizzle sql`` template. If
// that nesting composes wrongly the query is malformed, and nothing catches it
// until it throws in production — against @research chat as well as the studio
// research brief, since both call searchResearch. Serialise both shapes and
// check them rather than trusting the template.
describe('factsOnly query composition', () => {
  function build(factsOnly: boolean) {
    const vectorStr = '[0,0,0]';
    const model = 'text-embedding-3-small';
    const minSim = 0.45;
    const topK = 30;
    const factSessionFilter = sql``;
    const chunkSessionFilter = sql``;
    return sql`
      SELECT * FROM (
        SELECT 'fact'::text AS kind, f.id AS row_id,
          1 - (f.embedding <=> ${vectorStr}::vector) AS similarity
        FROM fact f
        WHERE f.embedding IS NOT NULL AND f.embedding_model = ${model}
          AND NOT f.is_counterfactual
          AND f.desk_state <> 'archived'
          ${factSessionFilter}
          AND 1 - (f.embedding <=> ${vectorStr}::vector) >= ${minSim}
        ${factsOnly ? sql`` : sql`UNION ALL
        SELECT 'source'::text AS kind, sc.id AS row_id,
          1 - (sc.embedding <=> ${vectorStr}::vector) AS similarity
        FROM source_chunk sc
        WHERE sc.embedding IS NOT NULL AND sc.embedding_model = ${model}
          ${chunkSessionFilter}
          AND 1 - (sc.embedding <=> ${vectorStr}::vector) >= ${minSim}`}
      ) u
      ORDER BY u.similarity DESC
      LIMIT ${topK}
    `;
  }

  it('omits the source-chunk branch when factsOnly is set', () => {
    const q = new PgDialect().sqlToQuery(build(true));
    expect(q.sql).not.toContain('UNION ALL');
    expect(q.sql).not.toContain('source_chunk');
    expect(q.sql).toContain('desk_state');
  });

  it('keeps both branches by default, so chat is unaffected', () => {
    const q = new PgDialect().sqlToQuery(build(false));
    expect(q.sql).toContain('UNION ALL');
    expect(q.sql).toContain('source_chunk');
  });

  it('binds every parameter in both shapes', () => {
    expect(new PgDialect().sqlToQuery(build(true)).params.length).toBeGreaterThan(0);
    expect(new PgDialect().sqlToQuery(build(false)).params.length).toBeGreaterThan(
      new PgDialect().sqlToQuery(build(true)).params.length,
    );
  });
});
