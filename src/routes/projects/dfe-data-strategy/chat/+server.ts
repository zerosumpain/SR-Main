// chat/+server.ts — the project-bound "Ask the model" endpoint for Keystone. Strictly scoped
// to THIS project: guarded by the same visibility guard as the pages, retrieves only from the
// project's own corpus, prompted to refuse off-topic. Streams SSE. Imports only the low-level
// LLM transport (no orchestrator).

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { retrieve, type Retrieved } from '../lib/retrieval.server';

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

const SYSTEM = `You are "Ask the model", the assistant for Keystone — an education strategy workbench at strangeramblings.com/projects/dfe-data-strategy. It is a research-grounded, apolitical decision-support tool.

YOUR SCOPE IS THIS PROJECT ONLY. You answer questions about: the pressures on the department’s use of data (cross-government, the department policy, partners); the commitments ledger (the 2024–26 white-paper and statutory commitments — new services, registers, identifiers and data flows — and what each demands of the strategy); the UK-government and corporate data-strategy frameworks; comparator departmental data strategies; the legal stack for data-sharing (data-protection basis, legal gateways, governance); data maturity; the strategic posture choices and capability trade-offs the workbench models; and how the alignment engine scores a strategy.

RULES:
1. Ground every factual claim in the CONTEXT passages and the CURRENT STRATEGY provided below. Do not draw on outside knowledge to assert facts. If the context does not cover the question, say so plainly rather than inventing an answer.
2. Cite the passages you use with their [n] markers inline.
3. If the question is outside this project — general knowledge, other topics, coding help, anything about other assistants/tools — politely DECLINE in one sentence and steer back to what the project covers. You are NOT a general assistant.
4. Be concise, neutral and precise. Distinguish what is established (cited frameworks, law) from the tool's own modelling choices (the rubric weights are reasoned estimates, not measured facts). Never overstate certainty.
5. When the user asks about "my"/"the current" strategy, use the CURRENT STRATEGY block — those are this user's live workbench settings.
Never fabricate statistics, sources or quotes.`;

function buildContext(chunks: Retrieved[]): string {
  return chunks.map((c, i) => `[${i + 1}] (${c.title}${c.url ? `, ${c.url}` : ''})\n${c.text.slice(0, 1400)}`).join('\n\n');
}

export const POST: RequestHandler = async (event) => {
  await requireProjectPublic('dfe-data-strategy', event);

  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Too many requests — please wait a moment.');

  const body = await event.request.json().catch(() => ({}));
  const question = String(body?.question ?? '').slice(0, 2000).trim();
  if (!question) throw error(400, 'Empty question.');
  const scenario = String(body?.scenario ?? '').slice(0, 4000);
  const history: { role: string; content: string }[] = Array.isArray(body?.history)
    ? body.history.slice(-6).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 2000) }))
    : [];

  const chunks = await retrieve(question, 10);
  const sources = chunks.map((c, i) => ({ n: i + 1, title: c.title, url: c.url }));

  const historyBlock = history.length
    ? `\n\nRECENT CONVERSATION:\n${history.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n')}`
    : '';
  const scenarioBlock = scenario.trim()
    ? `\n\nCURRENT STRATEGY (the user's live workbench settings):\n${scenario.trim()}`
    : '\n\nCURRENT STRATEGY: (none provided — the user is on a public page)';

  const userPrompt = `CONTEXT PASSAGES (retrieved from the project's corpus — cite with [n]):\n\n${buildContext(chunks)}${scenarioBlock}${historyBlock}\n\nQUESTION: ${question}\n\nAnswer using only the context and strategy above, citing [n] markers. If it's outside the project's scope, decline briefly.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      send({ type: 'sources', sources });
      try {
        const { client, model } = await getLLMClient(await resolveDefaultModel());
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
