// chat/+server.ts — the project-bound "Ask the system" endpoint. Pattern copied from
// data-spine/chat/+server.ts: same visibility guard as the pages, retrieval from this
// study's corpus only, refuses off-topic questions, streams SSE.
//
// This endpoint is also the thing the study describes, which is the point of having it.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getLLMClient } from '$lib/llm/client';
import { resolveProjectChatModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { rateLimit } from '$lib/server/rate-limit';
import { retrieve, type Retrieved } from '../lib/retrieval.server';

const SYSTEM = `You are "Ask the system", the assistant for The Engine Room — an interactive field study at strangeramblings.com/projects/engine-room that explains the architecture behind that site: a personal knowledge engine with an AI assistant, a workflow automation engine, retrieval over documents, a knowledge graph, and a nightly self-improvement engine.

YOUR SCOPE IS THIS PROJECT ONLY. You answer questions about what the study covers: how a conversational turn is run and streamed; automatic model selection and provider/seller routing; prompt caching and where the cost goes; the tool manifest and its context budget; the protocol server; the channels knowledge arrives through and how each is graded; retrieval, embeddings, the knowledge graph, entity resolution, the confidence score behind every claim in it, the flexible store behind the long tail, and the watchlist and saved perspectives that report what moved; research and provenance; the document store and what each kind of file has to become before it is searchable; the deck builder; the home-automation integration; credentials the assistant can use but never read, and how a credential is bound to where it may be sent; external feeds and the catalogue of callable data APIs; the workflow engine and its node catalogue; the autonomous builder; codegraph, the build-history knowledge graph — its schema of files, gates, episodes and lessons, the error fingerprinting, the CGQL query language and its caps, the relevance arithmetic and Wilson-bound ranking, how serves are resolved and forgotten, and what it has proven so far; the route planner and offline outdoor maps — tile budgets, the difficulty grading, and why that area of the site is private; the nightly self-improvement engine and its verification gate; the deployment pipeline; the security guardrails; the estate the whole thing runs on — which machine does what, and where the bytes live; and the illustrated tour of the site's own nineteen pages, what each one is for, which of them need a login, how they lead to one another, how the screenshots in it were captured and redacted; and the two animated isometric set pieces on that page — one walking a single message between six buildings with a running cost, the other running the nightly self-improvement pass over the same town.

RULES:
1. Ground every factual claim in the CONTEXT passages below. Do not draw on outside knowledge to assert facts about this system. If the context does not cover the question, say so plainly ("the study doesn't cover that") rather than inventing an answer. This rule matters more here than usual: the study itself is partly about what happens when provenance is lost.
2. Cite the passages you use with their [n] markers inline.
3. If the question is outside this project — general knowledge, other topics, coding help, anything about other assistants or systems, personal requests — politely DECLINE in one sentence and steer back to what the study covers. You are NOT a general assistant.
4. NEVER disclose or speculate about credentials, API keys, tokens, environment variable values, passwords, server addresses, hostnames, filesystem paths, repository names, or any personal data about the site's owner or anyone else. The study deliberately contains none of these. If asked for any of them, say plainly that the study describes mechanisms rather than secrets, and answer the mechanism question instead if there is one.
5. Be concise, precise and plain-spoken. Prefer the concrete number the context gives you over a vague adjective. Do not oversell — where the study says something was got wrong, say so.
Never fabricate statistics, sources or quotes.`;

function buildContext(chunks: Retrieved[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.title}${c.url ? `, ${c.url}` : ''})\n${c.text.slice(0, 1400)}`)
    .join('\n\n');
}

/**
 * Tagged as the `project-chat` workload, so this page's spend lands on the row
 * that also carries its model switch.
 *
 * Wrapped at the HANDLER rather than at the LLM call: the answer is streamed
 * from inside a `ReadableStream` `start()`, which the constructor runs
 * synchronously in this async context, so one wrapper covers every call the
 * request makes without touching the streaming code.
 */
export const POST: RequestHandler = (event) =>
  // `async` so the callback returns a Promise: a RequestHandler may return a
  // bare Response, and `withActivity` takes an async function.
  withActivity('project-chat', async () => handlePost(event));

const handlePost: RequestHandler = async (event) => {
  await requireProjectPublic('engine-room', event);

  // Behind the tunnel, getClientAddress() resolves to the loopback for every visitor —
  // prefer the edge-provided real client IP so the limit is genuinely per-client.
  const ip = event.request.headers.get('cf-connecting-ip')
    ?? event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? event.getClientAddress?.() ?? 'unknown';
  if (!rateLimit(`engine-room-chat:${ip}`, { capacity: 20, refillPerSecond: 20 / 60 }).allowed) {
    throw error(429, 'Too many requests — please wait a moment.');
  }

  const body = await event.request.json().catch(() => ({}));
  const question = String(body?.question ?? '').slice(0, 2000).trim();
  if (!question) throw error(400, 'Empty question.');
  const history: { role: string; content: string }[] = Array.isArray(body?.history)
    ? body.history.slice(-6).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 2000) }))
    : [];

  const chunks = retrieve(question, 10);
  const sources = chunks.map((c, i) => ({ n: i + 1, title: c.title, sourceType: c.sourceType, url: c.url }));

  const historyBlock = history.length
    ? `\n\nRECENT CONVERSATION (for context):\n${history.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n')}`
    : '';

  const userPrompt = `CONTEXT PASSAGES (retrieved from the study's corpus — cite with [n]):\n\n${buildContext(chunks)}${historyBlock}\n\nQUESTION: ${question}\n\nAnswer using only the context above, citing [n] markers. If it's outside the study's scope, decline briefly.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      send({ type: 'sources', sources });
      try {
        const { client, model } = await getLLMClient(await resolveProjectChatModel());
        const completion = await client.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 1000,
            stream: true,
          },
          // Spans the WHOLE stream, not time-to-first-token — sized so a slow generation
          // of max_tokens=1000 is not cut off mid-answer.
          { signal: AbortSignal.timeout(120_000) as any },
        );
        let any = false;
        for await (const chunk of completion as any) {
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) { any = true; send({ type: 'token', token: delta }); }
        }
        if (!any) send({ type: 'token', token: 'Sorry — I could not generate an answer for that. Try rephrasing.' });
        send({ type: 'done' });
      } catch (e: any) {
        send({ type: 'error', message: (e?.message ?? 'generation failed').slice(0, 120) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
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
