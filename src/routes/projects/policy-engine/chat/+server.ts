// chat/+server.ts — the project-bound "Ask the Model" endpoint. Strictly scoped to THIS project:
// it is guarded by the same visibility guard as the pages, retrieves only from the project's own
// corpus index, and is prompted to refuse anything off-topic. It imports NONE of the jkai
// orchestrator / conversation machinery — only the low-level LLM transport. Streams SSE.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getLLMClient } from '$lib/llm/client';
import { resolveProjectChatModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { retrieve, type Retrieved } from '../lib/retrieval.server';

// ---- light in-memory rate limit (per IP). It's owner-only while the project is private, but
// this caps cost/abuse if it ever goes public. Resets on server restart — deliberately simple. ----
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

const SYSTEM = `You are "Ask the Model", the assistant for the England Education Policy Modelling project — a research interactive (an unbiased, apolitical analytical tool) at strangeramblings.com/projects/policy-engine.

YOUR SCOPE IS THIS PROJECT ONLY. You answer questions about: the simulation model and its calculations; the policy levers, outcomes and their evidence/confidence; the field studies (early years, SEND, attendance, NEET, regions, the data/monitoring estate, the international comparators, the Jigsaw data-sharing case); the methodology; and the policy documents the project captures.

RULES:
1. Ground every factual claim in the CONTEXT passages and the CURRENT SCENARIO provided below. Do not draw on outside knowledge to assert facts. If the context does not cover the question, say so plainly ("the project doesn't capture that") rather than inventing an answer.
2. Cite the passages you use with their [n] markers inline.
3. If the question is outside this project — general knowledge, other topics, coding help, anything about other assistants/tools/systems, personal requests — politely DECLINE in one sentence and steer back to what the project covers. You are NOT a general assistant and have no other capabilities.
4. Be concise, neutral and precise. Distinguish the model's ASSUMPTIONS and CONTESTED points (the project flags these and rates confidence) from established facts. Never overstate certainty.
5. When the user asks about "my"/"the current" numbers, use the CURRENT SCENARIO block — those are this user's live model results.
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
  // Project binding + private-visibility gate (throws 404 for the public when private).
  await requireProjectPublic('policy-engine', event);

  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Too many requests — please wait a moment.');

  const body = await event.request.json().catch(() => ({}));
  const question = String(body?.question ?? '').slice(0, 2000).trim();
  if (!question) throw error(400, 'Empty question.');
  const scenario = String(body?.scenario ?? '').slice(0, 4000);
  const history: { role: string; content: string }[] = Array.isArray(body?.history)
    ? body.history.slice(-6).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 2000) }))
    : [];

  const chunks = retrieve(question, 10);
  const sources = chunks.map((c, i) => ({ n: i + 1, title: c.title, sourceType: c.sourceType, url: c.url }));

  const historyBlock = history.length
    ? `\n\nRECENT CONVERSATION (for context):\n${history.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n')}`
    : '';
  const scenarioBlock = scenario.trim()
    ? `\n\nCURRENT SCENARIO (the user's live model settings & results):\n${scenario.trim()}`
    : '\n\nCURRENT SCENARIO: (none provided — the user is on the landing page or has not set one)';

  const userPrompt = `CONTEXT PASSAGES (retrieved from the project's corpus — cite with [n]):\n\n${buildContext(chunks)}${scenarioBlock}${historyBlock}\n\nQUESTION: ${question}\n\nAnswer using only the context and scenario above, citing [n] markers. If it's outside the project's scope, decline briefly.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      send({ type: 'sources', sources });
      try {
        // Direct stream from the shared LLM gateway (OpenRouter).
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
          { signal: AbortSignal.timeout(60_000) as any },
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
