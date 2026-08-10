// Cross-session semantic search over the MATERIALS of every deep-dive research
// session — the extracted `fact` rows, embedded at discovery time with
// text-embedding-3-small (1536-dim). Powers the `@research` mention in jkai chat
// (research_search tool), the research analogue of $lib/file-index/search.ts's
// searchFiles(). Ranking is pgvector cosine distance (`<=>`) exactly as the
// per-session deepdive chat retrieval (src/routes/api/deepdive/[id]/chat), just
// without the single-session filter and joined to session topic + source meta so
// each hit can be cited across sessions.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { generateEmbedding } from './ai';
import { getEmbeddingModel } from './keys';
import { toVectorLiteral } from './vector';

export type ResearchSearchHit = {
  /** 'fact' = a distilled claim; 'source' = a raw passage from the source material. */
  kind: 'fact' | 'source';
  /** Id of the matched row — a fact id or a source_chunk id per `kind`. Opaque; used for dedup/keys. */
  factId: string;
  passage: string;
  score: number; // cosine similarity in [-1, 1]; higher = more relevant
  confidence: number;
  sessionId: string;
  sessionTopic: string;
  sourceId: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  domain: string | null;
};

export type ResearchSearchOptions = {
  topK?: number;
  minSim?: number;
  /** Restrict to a single research session (optional; default = all sessions). */
  sessionId?: string;
  /**
   * Restrict to distilled facts and skip raw source chunks.
   *
   * Chat wants both — a raw passage is often the better answer for a human who
   * can judge it. A consumer that renders hits AS SOURCED CLAIMS must not:
   * chunk rows are unreviewed page text, truncated mid-sentence, and carry a
   * hardcoded confidence of 0. The studio research brief passes this.
   */
  factsOnly?: boolean;
};

/**
 * A research source's `url` is populated by the research worker from web
 * search/scrape output — attacker-influenceable. It is surfaced to the chat UI
 * and rendered into an <a href>, so only allow http(s) through; anything else
 * (javascript:, data:, mailto:, malformed) becomes null and the UI falls back to
 * the internal /deepdive route. Sanitising here keeps every consumer safe, not
 * just the current chip component.
 */
function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

const DEFAULT_TOP_K = 8;
// Cross-session default. The per-session deepdive chat uses 0.5 (everything in a
// session is already on-topic, so it can be strict); @files uses 0.2. 0.3 is a
// middle ground: enough recall to reach the right session's facts, tight enough
// to keep unrelated sessions out of the top-K.
const DEFAULT_MIN_SIM = 0.3;
const MAX_PASSAGE_CHARS = 1200;

/**
 * Semantic search over all embedded research facts. Returns ranked passages,
 * each carrying its session topic and (when known) its web source so the caller
 * can cite it. Non-counterfactual, embedded facts only.
 */
export async function searchResearch(
  query: string,
  options: ResearchSearchOptions = {},
): Promise<ResearchSearchHit[]> {
  const q = (query || '').trim();
  if (!q) return [];

  // Guard NaN (the tool coerces a non-numeric `limit` via Number(...)); `??` only
  // catches null/undefined, so a NaN would reach LIMIT NaN and fail the query.
  // floor to an integer — a fractional limit (the tool coerces `limit` via
  // Number(...)) would reach SQL `LIMIT 8.5` and throw.
  const topK = Number.isFinite(options.topK)
    ? Math.floor(Math.min(Math.max(options.topK as number, 1), 30))
    : DEFAULT_TOP_K;
  const minSim = Number.isFinite(options.minSim) ? (options.minSim as number) : DEFAULT_MIN_SIM;

  const embedding = await generateEmbedding(q);
  const vectorStr = toVectorLiteral(embedding); // validates finite numbers before string-building

  // Only compare rows embedded in the CURRENT model's space. The query vector is
  // in getEmbeddingModel()'s space, so a fact/chunk embedded under an older model
  // would rank on a meaningless cross-space cosine. Gating here keeps retrieval
  // correct at every instant of a corpus re-embed (un-migrated rows just don't
  // appear yet) rather than only after it completes.
  const model = getEmbeddingModel();
  const factSessionFilter = options.sessionId ? sql`AND f.session_id = ${options.sessionId}` : sql``;
  const chunkSessionFilter = options.sessionId ? sql`AND sc.session_id = ${options.sessionId}` : sql``;

  // Search BOTH the distilled facts and the raw source-material chunks in one
  // ranked pass. Both were embedded with the same model, so their cosine
  // similarities to the query are directly comparable. `kind` distinguishes them
  // for the caller. similarity = 1 - `<=>` (cosine distance; normalization-
  // invariant, so no unit-normalization of the query is needed).
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT
        'fact'::text   AS kind,
        f.id           AS row_id,
        f.content      AS content,
        f.confidence   AS confidence,
        f.session_id   AS session_id,
        rs.topic       AS session_topic,
        s.id           AS source_id,
        s.title        AS source_title,
        s.url          AS source_url,
        s.domain       AS domain,
        1 - (f.embedding <=> ${vectorStr}::vector) AS similarity
      FROM fact f
      JOIN research_session rs ON rs.id = f.session_id
      LEFT JOIN source s ON s.id = f.source_id
      WHERE f.embedding IS NOT NULL
        AND f.embedding_model = ${model}
        AND NOT f.is_counterfactual
        -- 'archived' is Research Desk's "discarded" state. A fact the
        -- researcher filed away as wrong or unwanted should not be cited back
        -- anywhere — not in chat, and certainly not as evidence in a published
        -- explainer. The studio brief's own DB path has always filtered it.
        AND f.desk_state <> 'archived'
        ${factSessionFilter}
        AND 1 - (f.embedding <=> ${vectorStr}::vector) >= ${minSim}

      ${options.factsOnly ? sql`` : sql`UNION ALL

      SELECT
        'source'::text AS kind,
        sc.id          AS row_id,
        sc.text        AS content,
        0::double precision AS confidence,
        sc.session_id  AS session_id,
        rs2.topic      AS session_topic,
        s2.id          AS source_id,
        s2.title       AS source_title,
        s2.url         AS source_url,
        s2.domain      AS domain,
        1 - (sc.embedding <=> ${vectorStr}::vector) AS similarity
      FROM source_chunk sc
      JOIN research_session rs2 ON rs2.id = sc.session_id
      JOIN source s2 ON s2.id = sc.source_id
      WHERE sc.embedding IS NOT NULL
        AND sc.embedding_model = ${model}
        ${chunkSessionFilter}
        AND 1 - (sc.embedding <=> ${vectorStr}::vector) >= ${minSim}`}
    ) u
    ORDER BY u.similarity DESC
    LIMIT ${topK}
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => {
    const content = String(r.content ?? '');
    return {
      kind: r.kind === 'source' ? ('source' as const) : ('fact' as const),
      factId: String(r.row_id),
      passage: content.length > MAX_PASSAGE_CHARS ? content.slice(0, MAX_PASSAGE_CHARS) + '…' : content,
      score: Math.round(Number(r.similarity ?? 0) * 1000) / 1000,
      confidence: Number(r.confidence ?? 0),
      sessionId: String(r.session_id),
      sessionTopic: String(r.session_topic ?? ''),
      sourceId: r.source_id != null ? String(r.source_id) : null,
      sourceTitle: r.source_title != null ? String(r.source_title) : null,
      sourceUrl: safeHttpUrl(r.source_url), // http(s) only — see safeHttpUrl
      domain: r.domain != null ? String(r.domain) : null,
    };
  });
}
