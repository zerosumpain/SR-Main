/**
 * The `brief` tier — real research, bounded to under two minutes.
 *
 * This exists because the phase chain cannot be made to fit inside a clock by
 * configuration alone. `phase1` spends one LLM call categorising EVERY source
 * it stores (15 sources = 15 serial round-trips before any analysis begins),
 * and both phase loops stop on saturation heuristics rather than on time. Tuning
 * their knobs down produced a fast run with no answer, not a fast answer.
 *
 * So the shape here is deliberately flat, and every step is either parallel or
 * skippable:
 *
 *   1. one query-generation call, capped, with the raw topic already in flight
 *   2. all searches at once
 *   3. rank, apply scope, cap
 *   4. extract facts + entities from the best sources, in parallel, one call each
 *   5. one streamed synthesis, on time reserved up front
 *
 * Steps 1, 2 and 4 all degrade rather than fail: a dead query generator falls
 * back to the topic, a failed search is dropped, and extraction that runs out of
 * budget simply contributes fewer facts. Only step 5 is guaranteed, because an
 * answer is the thing the user actually asked for.
 */
import { db } from '$lib/db';
import { researchSessions, sources as sourcesTable, facts, entities } from '$lib/db/schema';
import type { ResearchSession, Source } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { jsonCompletion, streamCompletion, generateEmbedding } from './ai';
import { search } from './tavily';
import { classifyDomain } from './credibility';
import {
  GRAPH_EXTRACTION_PROMPT,
  SessionEntityIndex,
  storeRelationships,
  type ExtractedEntity,
  type ExtractedRelationship,
} from './extract-graph';
import { getEmbeddingModel } from '$lib/llm/keys';
import { emit, emitLog, emitStats, throwIfStopped, beat } from './worker';
import { emitArtefact } from './desk-events';
import { pLimit } from './concurrency';
import { coerceScope, scopeToSearchOptions, scopeAdmits, credibilityBonus, describeScope } from './scope';
import { depthPreset, SYNTHESIS_MAX_TOKENS } from './depth';
import { resolveResearchFastModel } from '$lib/server/models/workload-settings';
import type { ResearchBudget } from './budget';
import type { SessionStats, ResearchReport } from './types';

/** Queries asked in the one search round. */
const MAX_QUERIES = 8;
/** Sources whose full text is analysed. Below the source cap on purpose. */
const MAX_ANALYSED = 8;
/** Parallel extraction calls. One LLM call each, so this is the burst width. */
const EXTRACT_CONCURRENCY = 8;
/** Ceiling on the query-generation call — the topic itself is a fine fallback. */
const QUERY_GEN_CEILING_MS = 12_000;
/** Ceiling on a single search. */
const SEARCH_CEILING_MS = 15_000;
/** Ceiling on one source's extraction call. */
const EXTRACT_CEILING_MS = 25_000;

interface RankedSource {
  url: string;
  title: string;
  domain: string;
  snippet: string;
  credibilityScore: number;
  credibilityType: string;
  rank: number;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export async function runBrief(
  sessionId: string,
  session: ResearchSession,
  budget: ResearchBudget,
): Promise<void> {
  const preset = depthPreset('brief');
  const model = (await resolveResearchFastModel()).modelId;
  const scope = coerceScope(session.scope);
  const goals = (session.goals ?? []) as string[];
  const topic = session.topic;

  const sys =
    `You are a research analyst. Topic: "${topic}"` +
    (goals.length ? `\nGoals: ${goals.join('; ')}` : '');

  /**
   * Names → ids for every entity this run has stored, so a relationship's
   * endpoints resolve without a database round trip per name. Shared across the
   * parallel source extractions: a source may legitimately name an entity a
   * sibling source created a moment ago, and dropping that link would lose
   * exactly the cross-source connections a graph is for.
   */
  const entityIndex = new SessionEntityIndex();

  const stats: SessionStats = {
    sourcesFound: 0,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
    relationshipsFound: 0,
  };

  emitLog(sessionId, '\u{1F50D}', `Brief: ${describeScope(scope)}`);

  // ---- 1. Queries -------------------------------------------------------
  // The raw-topic search goes out BEFORE the query-generation call returns, so
  // the cheapest useful result is already in flight while the model thinks.
  const searchOpts = scopeToSearchOptions(scope);
  const rawSearch = search(topic, {
    maxResults: 8,
    searchDepth: 'basic',
    ...searchOpts,
    signal: budget.signalFor('gather', SEARCH_CEILING_MS),
  }).catch((err) => {
    console.error('[deepdive] brief raw-topic search failed:', err?.message ?? err);
    return null;
  });

  let queries: string[] = [];
  if (!budget.expiredFor('gather')) {
    try {
      const gen = await jsonCompletion<{ queries: string[] }>(
        sys,
        `Generate ${MAX_QUERIES} diverse search queries covering different angles of this topic. Vary the phrasing to minimise result overlap.\n\nRespond with JSON: { "queries": ["query1", ...] }`,
        {
          model,
          maxTokens: 1024,
          signal: budget.signalFor('gather', QUERY_GEN_CEILING_MS),
        },
      );
      queries = (gen.queries ?? []).filter((q) => typeof q === 'string' && q.trim()).slice(0, MAX_QUERIES);
    } catch {
      // A dead query generator is not a dead run.
      emitLog(sessionId, 'ℹ️', 'Query generation unavailable — searching the topic directly.');
    }
  }
  beat(sessionId);

  // ---- 2. Search --------------------------------------------------------
  emitLog(sessionId, '\u{1F50D}', `Searching (${queries.length + 1} queries, in parallel)…`);
  const settled = await Promise.allSettled(
    queries.map((q) =>
      search(q, {
        maxResults: 6,
        searchDepth: 'basic',
        ...searchOpts,
        signal: budget.signalFor('gather', SEARCH_CEILING_MS),
      }),
    ),
  );
  const raw = await rawSearch;
  throwIfStopped(sessionId);
  beat(sessionId);

  // Search failures used to vanish into Promise.allSettled and resurface as the
  // generic "no search results found", which is indistinguishable from a topic
  // that genuinely has no coverage. Keep the reasons so the error can say which.
  const searchErrors = settled
    .flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (searchErrors.length) {
    console.error('[deepdive] brief search failures:', searchErrors);
    emitLog(sessionId, '⚠️', `${searchErrors.length} search(es) failed: ${searchErrors[0]}`);
  }

  // ---- 3. Rank, filter by scope, cap ------------------------------------
  const seen = new Set<string>();
  const ranked: RankedSource[] = [];
  const responses = [
    ...settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
    ...(raw ? [raw] : []),
  ];

  for (const res of responses) {
    for (let i = 0; i < (res.results?.length ?? 0); i++) {
      const r = res.results[i];
      if (!r?.url || seen.has(r.url)) continue;
      // The API-level include_domains filter is a request, not a guarantee —
      // re-check every URL that actually came back.
      if (!scopeAdmits(scope, r.url)) continue;
      seen.add(r.url);

      const domain = getDomain(r.url);
      const cred = classifyDomain(domain);
      // Position weighting mirrors the quick-answer ranker; the scope bonus is
      // how a `bounded` scope expresses preference without hard-filtering.
      const positionWeight = 1 - (i / 10) * 0.3;
      ranked.push({
        url: r.url,
        title: r.title ?? r.url,
        domain,
        snippet: (r.content ?? '').slice(0, 800),
        credibilityScore: cred.score,
        credibilityType: cred.type,
        rank: cred.score * positionWeight + credibilityBonus(scope, r.url),
      });
    }
  }
  ranked.sort((a, b) => b.rank - a.rank);
  const chosen = ranked.slice(0, preset.maxSources);

  if (chosen.length === 0) {
    // An exclusive scope that matched nothing must say so. Silently widening
    // would produce an answer whose provenance contradicts what was asked for.
    const why =
      scope.mode === 'exclusive'
        ? `No sources matched your scope (${scope.includeDomains.join(', ')}). Widen the scope or remove the domain restriction.`
        : searchErrors.length
          ? `Search failed: ${searchErrors[0]}`
          : 'No search results found for this topic.';
    throw new Error(why);
  }

  const stored: Source[] = [];
  for (const s of chosen) {
    const [row] = await db
      .insert(sourcesTable)
      .values({
        sessionId,
        url: s.url,
        title: s.title,
        snippet: s.snippet.slice(0, 500),
        domain: s.domain,
        phase: 1,
        credibilityScore: s.credibilityScore,
        credibilityType: s.credibilityType,
      })
      .returning();
    stored.push(row);
    emitArtefact(sessionId, 'source', 1, {
      id: row.id,
      url: row.url,
      title: row.title,
      domain: row.domain,
      category: row.category ?? null,
      credibilityScore: row.credibilityScore,
      credibilityType: row.credibilityType,
    });
  }
  stats.sourcesFound = stored.length;
  emitStats(sessionId, stats);
  emit(sessionId, {
    type: 'sources',
    data: {
      sources: stored.map((s, i) => ({
        id: s.id,
        url: s.url,
        title: s.title,
        domain: s.domain,
        credibilityScore: s.credibilityScore,
        credibilityType: s.credibilityType,
        citationIndex: i + 1,
      })),
    },
  });
  emitLog(sessionId, '\u{1F4C4}', `${stored.length} sources kept.`);
  beat(sessionId);

  // ---- 4. Extract -------------------------------------------------------
  // One combined facts+entities call per source, run in parallel. Anything that
  // runs out of budget contributes nothing and costs nothing.
  const limit = pLimit(EXTRACT_CONCURRENCY);
  const toAnalyse = stored.slice(0, MAX_ANALYSED);
  const bySnippet = new Map(chosen.map((c) => [c.url, c.snippet]));

  await Promise.allSettled(
    toAnalyse.map((src) =>
      limit(async () => {
        if (budget.expiredFor('gather')) return;
        const content = bySnippet.get(src.url) ?? src.snippet ?? '';
        if (content.length < 80) return;
        const extracted = await jsonCompletion<{
          facts: { content: string; confidence: number; tags: string[] }[];
          entities: ExtractedEntity[];
          relationships: ExtractedRelationship[];
        }>(
          sys,
          `Analyse this source and return JSON with three keys.\n\n1. facts: factual claims, each { content (one clear sentence), confidence (0-1), tags (2-4 short topic tags) }\n\n2. entities: as described below.\n\n3. relationships: as described below.\n\n${GRAPH_EXTRACTION_PROMPT}\n\nSource: ${src.title}\nContent:\n${content.slice(0, 4000)}\n\nRespond with JSON: { "facts": [...], "entities": [...], "relationships": [...] }`,
          {
            model,
            // Widened from 4096 with the relationships array: a source naming
            // twenty entities now has a second list to write, and a truncated
            // response loses the WHOLE object, not just its tail.
            maxTokens: 6144,
            signal: budget.signalFor('gather', EXTRACT_CEILING_MS),
          },
        );
        await storeFacts(extracted.facts ?? [], src);
        // Entities first: relationship endpoints resolve through the index this
        // fills, so an edge can only be written once both its ends exist.
        await storeEntities(extracted.entities ?? [], src);
        await storeGraphEdges(extracted.relationships ?? [], src);
        beat(sessionId);
      }),
    ),
  );
  emitStats(sessionId, stats);
  emitLog(
    sessionId,
    '✅',
    `${stats.factsExtracted} facts, ${stats.entitiesIdentified} entities, ${stats.relationshipsFound ?? 0} relationships extracted.`,
  );

  // ---- 5. Synthesis (on reserved time) ----------------------------------
  const citations = stored.map((s, i) => `[${i + 1}] ${s.title} (${s.domain})\n${s.snippet ?? ''}`);
  const factLines = (
    await db
      .select({ content: facts.content })
      .from(facts)
      .where(eq(facts.sessionId, sessionId))
      .limit(80)
  ).map((f) => `- ${f.content}`);

  emitLog(sessionId, '\u{1F4DD}', 'Writing the brief…');
  let answer = '';
  let synthesisError: string | null = null;
  try {
    const result = await streamCompletion(
      `You are a research analyst who writes clear, factual, well-sourced briefs.\n\nRules:\n- 250-600 words of clear prose\n- inline [N] citations referencing the numbered sources\n- cite at least three different sources\n- name disagreements between sources rather than smoothing them over\n- say plainly what the sources do NOT establish\n- never assert anything the sources do not support\n- markdown formatting where it helps`,
      `**Topic:** ${topic}` +
        (goals.length ? `\n**Goals:** ${goals.join('; ')}` : '') +
        (factLines.length ? `\n\n**Extracted facts:**\n${factLines.join('\n')}` : '') +
        `\n\n**Sources:**\n${citations.join('\n\n')}\n\nWrite the brief with inline [N] citations.`,
      {
        model,
        // Generous because max_tokens is a ceiling, not a spend: reasoning
        // tokens are billed against it, and a 2,000 cap left a measured 421
        // characters of answer behind 3,251 characters of thinking.
        maxTokens: SYNTHESIS_MAX_TOKENS,
        signal: budget.signalFor('synthesis'),
        onToken: (t) => emit(sessionId, { type: 'token', data: { token: t } }),
        onReasoning: (t) =>
          emit(sessionId, { type: 'reasoning', data: { token: t, stage: 'synthesis' } }),
      },
    );
    answer = result.text;
  } catch (err: any) {
    // Out of time or the model died. The sources and facts are already stored
    // and visible, so the run degrades to "here is what I found" rather than
    // collapsing to nothing.
    synthesisError = err?.message ?? 'unknown error';
    emitLog(sessionId, '⚠️', `Synthesis cut short: ${synthesisError}`);
  }

  const report: ResearchReport = {
    ranked_facts: [],
    timeline: [],
    clusters: [],
    executive_summary: answer,
    entity_centrality: {},
  };
  await db.update(researchSessions).set({ report }).where(eq(researchSessions.id, sessionId));
  emit(sessionId, { type: 'synthesis', data: { executive_summary: answer } });

  // A run that gathered sources but produced no answer is NOT a success, even
  // though every individual step "worked". Reporting it as complete is how a
  // provider outage (an out-of-credit 402 on every LLM call, seen 2026-08-14)
  // silently turned into a run that looked finished and said nothing. Throwing
  // marks the session failed and surfaces the reason.
  if (!answer.trim()) {
    throw new Error(
      synthesisError
        ? `No answer produced: ${synthesisError}`
        : 'No answer produced — the model returned nothing.',
    );
  }

  // ---- helpers ----------------------------------------------------------

  async function storeFacts(
    extracted: { content: string; confidence: number; tags: string[] }[],
    src: Source,
  ): Promise<void> {
    for (const f of extracted) {
      if (!f?.content || f.content.length < 10) continue;
      // Cheap exact-duplicate guard. The embedding-based dedup the phase chain
      // uses costs a round-trip per fact, which this tier cannot afford; near
      // duplicates are tolerable in a brief, a blown budget is not.
      const dupe = await db
        .select({ id: facts.id })
        .from(facts)
        .where(
          and(eq(facts.sessionId, sessionId), sql`lower(trim(${facts.content})) = ${f.content.trim().toLowerCase()}`),
        )
        .limit(1);
      if (dupe.length) continue;

      const extractedConf = Math.max(0, Math.min(1, f.confidence ?? 0.5));
      const blended = extractedConf * 0.7 + (src.credibilityScore ?? 0.5) * 0.3;

      // Embeddings power @research retrieval later; a failure here must not
      // cost the fact.
      let embedding: number[] | null = null;
      try {
        if (!budget.expiredFor('gather')) embedding = await generateEmbedding(f.content);
      } catch {
        embedding = null;
      }

      const [row] = await db
        .insert(facts)
        .values({
          sessionId,
          sourceId: src.id,
          content: f.content,
          confidence: Math.max(0, Math.min(1, blended)),
          tags: f.tags ?? [],
          embedding,
          embeddingModel: embedding ? getEmbeddingModel() : null,
        })
        .returning();

      emitArtefact(sessionId, 'fact', 2, {
        id: row.id,
        sourceId: row.sourceId,
        content: row.content,
        confidence: row.confidence,
        isCounterfactual: row.isCounterfactual,
        refutesFactId: row.refutesFactId,
        tags: row.tags,
        eventDate: null,
      });
      stats.factsExtracted++;
    }
  }

  async function storeEntities(extracted: ExtractedEntity[], _src: Source): Promise<void> {
    for (const e of extracted) {
      if (!e?.name) continue;
      const normalised = e.name.toLowerCase().trim();
      const existing = await db
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(eq(entities.sessionId, sessionId), sql`lower(trim(${entities.name})) = ${normalised}`),
        )
        .limit(1);
      if (existing.length) {
        // Already stored — by an earlier source, or by this one under another
        // spelling. Still index it: the relationship pass that follows resolves
        // names through the index, so skipping the registration here is how a
        // link to a known entity would go missing.
        entityIndex.add(e.name, existing[0].id);
        continue;
      }

      const [row] = await db
        .insert(entities)
        .values({
          sessionId,
          name: e.name,
          type: e.type || 'other',
          description: e.description,
        })
        .returning();
      entityIndex.add(row.name, row.id);
      emitArtefact(sessionId, 'entity', 2, {
        id: row.id,
        name: row.name,
        type: row.type,
        description: row.description,
      });
      stats.entitiesIdentified++;
    }
  }

  /**
   * Store one source's relationships. Endpoints resolve through `entityIndex`,
   * which `storeEntities` has just filled from the SAME response — the contract
   * that stops the two halves of an extraction naming things differently.
   */
  async function storeGraphEdges(
    extracted: ExtractedRelationship[],
    src: Source,
  ): Promise<void> {
    if (!extracted.length) return;
    const outcome = await storeRelationships(sessionId, src.id, extracted, entityIndex);
    stats.relationshipsFound = (stats.relationshipsFound ?? 0) + outcome.stored;
    if (outcome.unresolved > 0) {
      console.warn(
        `[deepdive] brief: ${outcome.unresolved} relationship endpoint(s) matched no entity for ${src.url}`,
      );
    }
  }
}
