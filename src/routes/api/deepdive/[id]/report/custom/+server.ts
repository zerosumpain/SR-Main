// src/routes/api/deepdive/[id]/report/custom/+server.ts
// POST /api/deepdive/[id]/report/custom
// Brief-driven report generation. Body: { brief: string, history? }.
// Streams SSE-over-POST identical in shape to /chat:
//   data:{type:'sources',sources}  → data:{type:'token',token}  → data:{type:'done'}
// Reuses the same retrieval + context infra as the chat endpoint.
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
  buildReportPrompt,
  type RetrievedFact,
  type SourceMeta,
} from '$lib/deepdive/chat-context';
import type { ResearchReport } from '$lib/deepdive/types';

const RETRIEVAL_LIMIT = 14; // slightly larger than chat — cover the full brief

export const POST: RequestHandler = async ({ params, request }) => {
  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, report: researchSessions.report })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw error(404, 'Session not found');

  const body = await request.json().catch(() => ({}));
  const brief = String(body?.brief ?? '').slice(0, 2000).trim();
  if (!brief) throw error(400, 'Brief is required.');

  const report = (session.report ?? null) as ResearchReport | null;

  // --- Retrieval: embed the brief, pull the top on-topic facts (pgvector cosine). ---
  let retrieved: RetrievedFact[] = [];
  try {
    const embedding = await generateEmbedding(brief);
    const vectorStr = toVectorLiteral(embedding);
    const rows = await db.execute(
      sql`SELECT id, content, source_id, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM fact
          WHERE session_id = ${params.id}
            AND NOT is_counterfactual
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorStr}::vector) > 0.45
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
    // Non-fatal: fall back to overview-only context.
    console.error('[deepdive] report/custom retrieval failed:', e);
  }

  // --- Resolve source metadata for [n] citations. ---
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

  // --- Build the compact overview from the persisted report (or top-confidence facts). ---
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
    fallbackFacts = await db
      .select({ id: facts.id, content: facts.content, confidence: facts.confidence })
      .from(facts)
      .where(eq(facts.sessionId, params.id))
      .orderBy(sql`confidence DESC`)
      .limit(10);
  }

  const overview = buildOverview(report, factsById, entitiesById, fallbackFacts);
  const { passages, sources: citationSources } = numberSources(retrieved, sourceMeta);
  const { system, user } = buildReportPrompt(session.topic, brief, overview, passages);

  // --- Stream SSE-over-POST (same frame shape as /chat). ---
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
          maxTokens: 4096,
          temperature: 0.3,
          signal: request.signal,
          onToken: (token) => send({ type: 'token', token }),
        });
        if (!text.trim()) {
          send({
            type: 'token',
            token: '_No report could be generated. Try broadening the brief or waiting for more research to complete._',
          });
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
