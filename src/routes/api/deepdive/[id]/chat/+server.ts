// src/routes/api/deepdive/[id]/chat/+server.ts
// POST /api/deepdive/[id]/chat — retrieval-grounded chat for a single Research
// Desk session. Streams SSE-over-POST: a `sources` frame, then `token` frames,
// then `done`. Mirrors projects/policy-engine/chat/+server.ts (transport) and
// reuses the similar-facts pgvector retrieval. All LLM I/O goes through the
// deepdive streamCompletion gateway (disableThinking to stop GLM reasoning
// starvation; keeps the OpenRouter 429 fallback + idle watchdog).
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { researchSessions, facts, sources, entities } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { streamCompletion, generateEmbedding } from '$lib/deepdive/ai';
import { toVectorLiteral } from '$lib/deepdive/vector';
import {
  buildOverview,
  numberSources,
  buildChatPrompt,
  type RetrievedFact,
  type SourceMeta,
  type HistoryTurn,
} from '$lib/deepdive/chat-context';
import type { ResearchReport } from '$lib/deepdive/types';

const RETRIEVAL_LIMIT = 12;

export const POST: RequestHandler = async ({ params, request }) => {
  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw error(404, 'Session not found');

  const body = await request.json().catch(() => ({}));
  const question = String(body?.question ?? '').slice(0, 2000).trim();
  if (!question) throw error(400, 'Empty question.');
  const history: HistoryTurn[] = Array.isArray(body?.history)
    ? body.history
        .slice(-6)
        .map((m: any) => ({
          role: m?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: String(m?.content ?? '').slice(0, 2000),
        }))
    : [];

  const report = (session.report ?? null) as ResearchReport | null;

  // --- Retrieval: embed the question, pull the top on-topic facts (pgvector cosine). ---
  let retrieved: RetrievedFact[] = [];
  try {
    const embedding = await generateEmbedding(question);
    const vectorStr = toVectorLiteral(embedding);
    const rows = await db.execute(
      sql`SELECT id, content, source_id, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM fact
          WHERE session_id = ${params.id}
            AND NOT is_counterfactual
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorStr}::vector) > 0.5
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${RETRIEVAL_LIMIT}`,
    );
    retrieved = (rows.rows as any[]).map((r) => ({
      id: String(r.id),
      content: String(r.content ?? ''),
      sourceId: String(r.source_id),
      similarity: Number(r.similarity ?? 0),
    }));
  } catch (e) {
    // Retrieval failure (e.g. embeddings unavailable) is non-fatal — the
    // overview alone still grounds an answer.
    console.error('[deepdive] chat retrieval failed:', e);
  }

  // --- Resolve source metadata for the [n] citations. ---
  const sourceIds = [...new Set(retrieved.map((r) => r.sourceId))];
  const sourceMeta = new Map<string, SourceMeta>();
  if (sourceIds.length) {
    const srcRows = await db
      .select({ id: sources.id, title: sources.title, domain: sources.domain, url: sources.url })
      .from(sources)
      .where(eq(sources.sessionId, params.id));
    for (const s of srcRows) {
      sourceMeta.set(s.id, { id: s.id, title: s.title, domain: s.domain, url: s.url });
    }
  }

  // --- Build the compact overview from the report (or the top-confidence fallback). ---
  const factsById = new Map<string, { id: string; content: string; confidence: number }>();
  const entitiesById = new Map<string, { id: string; name: string; type: string }>();
  let fallbackFacts: { id: string; content: string; confidence: number }[] = [];

  if (report?.executive_summary || report?.ranked_facts?.length) {
    const wantedFactIds = [...new Set((report.ranked_facts ?? []).slice(0, 8))];
    if (wantedFactIds.length) {
      const fr = await db
        .select({ id: facts.id, content: facts.content, confidence: facts.confidence })
        .from(facts)
        .where(eq(facts.sessionId, params.id));
      for (const f of fr) factsById.set(f.id, { id: f.id, content: f.content, confidence: f.confidence });
    }
    const wantedEntityIds = Object.keys(report.entity_centrality ?? {});
    if (wantedEntityIds.length) {
      const er = await db
        .select({ id: entities.id, name: entities.name, type: entities.type })
        .from(entities)
        .where(eq(entities.sessionId, params.id));
      for (const e of er) entitiesById.set(e.id, { id: e.id, name: e.name, type: e.type });
    }
  } else {
    // No report yet — load the top-confidence facts for the fallback overview.
    fallbackFacts = await db
      .select({ id: facts.id, content: facts.content, confidence: facts.confidence })
      .from(facts)
      .where(eq(facts.sessionId, params.id))
      .orderBy(sql`confidence DESC`)
      .limit(10);
  }

  const overview = buildOverview(report, factsById, entitiesById, fallbackFacts);
  const { passages, sources: citationSources } = numberSources(retrieved, sourceMeta);
  const { system, user } = buildChatPrompt(session.topic, overview, passages, history, question);

  // --- Stream SSE-over-POST. ---
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller already closed */
        }
      };
      send({ type: 'sources', sources: citationSources });
      try {
        const { text } = await streamCompletion(system, user, {
          disableThinking: true,
          maxTokens: 3072,
          temperature: 0.3,
          signal: request.signal,
          onToken: (token) => send({ type: 'token', token }),
        });
        if (!text.trim()) {
          send({ type: 'token', token: 'Sorry — I could not generate an answer for that. Try rephrasing.' });
        }
        send({ type: 'done' });
      } catch (e: any) {
        send({ type: 'error', message: String(e?.message ?? 'generation failed').slice(0, 120) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
