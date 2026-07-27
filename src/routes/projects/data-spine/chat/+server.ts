// chat/+server.ts — the project-bound "Ask the project" endpoint (pattern copied from
// policy-engine/chat). Same visibility guard as the pages; retrieves only from this
// project's corpus; refuses off-topic questions. Streams SSE.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { rateLimit } from '$lib/server/rate-limit';
import { retrieve, type Retrieved } from '../lib/retrieval.server';

const SYSTEM = `You are "Ask the project", the assistant for The Data Spine — a research interactive (an unbiased, apolitical analytical tool) at strangeramblings.com/projects/data-spine, examining the Department for Education's proposed education data spine.

YOUR SCOPE IS THIS PROJECT ONLY. You answer questions about: what the data spine is and its announced status; the consistent identifier (CWSA 2026) and how it differs from the spine; international and cross-government precedents (NHS Spine, X-Road, ContactPoint, Verify, CPR/BSN/NSN/USI); the stakeholder personas and their positions; the value ledger (claimed benefits and risks); the operational services (attendance feed, Education Record, FSM auto-enrolment); and the information-governance analysis (trust ledger, legal instruments, privacy-enhancing techniques, the design playbook).

RULES:
1. Ground every factual claim in the CONTEXT passages below. Do not draw on outside knowledge to assert facts. If the context does not cover the question, say so plainly ("the project doesn't capture that") rather than inventing an answer.
2. Cite the passages you use with their [n] markers inline.
3. If the question is outside this project — general knowledge, other topics, coding help, anything about other assistants/tools/systems, personal requests — politely DECLINE in one sentence and steer back to what the project covers. You are NOT a general assistant.
4. Be concise, neutral and precise. The project marks claims FACT / HYPOTHESIS / CONTESTED — preserve those distinctions; never overstate certainty. The spine has NO published architecture: analysis of its design is necessarily hypothesis.
5. If a LENS is provided, weight the answer toward that persona's perspective while staying factual.
Never fabricate statistics, sources or quotes.`;

function buildContext(chunks: Retrieved[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.title}${c.url ? `, ${c.url}` : ''})\n${c.text.slice(0, 1400)}`)
    .join('\n\n');
}

export const POST: RequestHandler = async (event) => {
  await requireProjectPublic('data-spine', event);

  // Behind cloudflared, getClientAddress() resolves to the tunnel loopback for every
  // visitor — prefer the Cloudflare-provided real client IP so the limit is per-client.
  const ip = event.request.headers.get('cf-connecting-ip')
    ?? event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? event.getClientAddress?.() ?? 'unknown';
  // ~20 questions/min sustained with a burst of 20; the shared bucket store self-cleans.
  if (!rateLimit(`data-spine-chat:${ip}`, { capacity: 20, refillPerSecond: 20 / 60 }).allowed) {
    throw error(429, 'Too many requests — please wait a moment.');
  }

  const body = await event.request.json().catch(() => ({}));
  const question = String(body?.question ?? '').slice(0, 2000).trim();
  if (!question) throw error(400, 'Empty question.');
  const lens = String(body?.lens ?? '').slice(0, 500);
  const history: { role: string; content: string }[] = Array.isArray(body?.history)
    ? body.history.slice(-6).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 2000) }))
    : [];

  const chunks = retrieve(question, 10);
  const sources = chunks.map((c, i) => ({ n: i + 1, title: c.title, sourceType: c.sourceType, url: c.url }));

  const historyBlock = history.length
    ? `\n\nRECENT CONVERSATION (for context):\n${history.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n')}`
    : '';
  const lensBlock = lens.trim() ? `\n\nLENS: ${lens.trim()}` : '';

  const userPrompt = `CONTEXT PASSAGES (retrieved from the project's corpus — cite with [n]):\n\n${buildContext(chunks)}${lensBlock}${historyBlock}\n\nQUESTION: ${question}\n\nAnswer using only the context above, citing [n] markers. If it's outside the project's scope, decline briefly.`;

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
          // The signal spans the WHOLE stream, not time-to-first-token — sized so a
          // slow generation of max_tokens=1000 isn't cut off mid-answer.
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
