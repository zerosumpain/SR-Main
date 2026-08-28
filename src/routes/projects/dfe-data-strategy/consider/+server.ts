// consider/+server.ts — the Consideration Builder. Public + rate-limited (the user's policy
// statements are their own; not persisted server-side). Reviews ALL of this project's strategic
// material + the Policy Engine data brief and returns pros, cons, tensions, tradeoffs,
// stakeholders and considerations with references to the evidence.
//
// STREAMS via SSE: the appraisal takes ~20-40s; a non-streaming response produces no bytes for
// that whole time and the edge proxy 502s it. We flush a byte immediately, keep the connection
// warm with the model's token stream, then emit a single validated `result` event.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getLLMClient } from '$lib/llm/client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { referenceIndex, STAKEHOLDERS, VALID_REFS } from '../lib/policy';
import { retrieve } from '../lib/retrieval.server';
import { coerceJson } from '../lib/jsonsafe';

const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > MAX_PER_WINDOW;
}

const consider = (x: any) =>
  (Array.isArray(x) ? x : [])
    .map((c: any) => (typeof c === 'string' ? { point: c } : { point: String(c?.point ?? '').slice(0, 300), detail: c?.detail ? String(c.detail).slice(0, 300) : undefined }))
    .filter((c: any) => c.point)
    .slice(0, 6);

const stake = (x: any) =>
  (Array.isArray(x) ? x : [])
    .map((s: any) => ({ name: String(s?.name ?? s ?? '').slice(0, 80), why: String(s?.why ?? '').slice(0, 200) }))
    .filter((s: any) => s.name)
    .slice(0, 8);

function validate(parsed: any) {
  const refs = parsed?.references ?? {};
  return {
    headline: String(parsed?.headline ?? '').slice(0, 240),
    summary: String(parsed?.summary ?? '').slice(0, 800),
    pros: consider(parsed?.pros),
    cons: consider(parsed?.cons),
    tensions: (Array.isArray(parsed?.tensions) ? parsed.tensions : [])
      .map((t: any) => ({ point: String(t?.point ?? t ?? '').slice(0, 300), severity: ['high', 'medium', 'low'].includes(t?.severity) ? t.severity : 'medium' }))
      .filter((t: any) => t.point)
      .slice(0, 6),
    tradeoffs: consider(parsed?.tradeoffs),
    considerations: consider(parsed?.considerations),
    stakeholders: { impacted: stake(parsed?.stakeholders?.impacted), interested: stake(parsed?.stakeholders?.interested) },
    references: {
      pressures: (Array.isArray(refs.pressures) ? refs.pressures : []).filter((id: any) => VALID_REFS.pressures.has(id)).slice(0, 10),
      strategies: (Array.isArray(refs.strategies) ? refs.strategies : []).filter((id: any) => VALID_REFS.strategies.has(id)).slice(0, 10),
      legislation: (Array.isArray(refs.legislation) ? refs.legislation : []).filter((id: any) => VALID_REFS.legislation.has(id)).slice(0, 10),
    },
    watchouts: (Array.isArray(parsed?.watchouts) ? parsed.watchouts : []).map((w: any) => String(w).slice(0, 200)).slice(0, 5),
    evidence: [] as { title: string; url: string | null }[],
  };
}

export const POST: RequestHandler = async (event) => {
  await requireProjectPublic('dfe-data-strategy', event);
  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Too many requests — please wait a moment.');

  const body = await event.request.json().catch(() => ({}));
  const title = String(body?.title ?? '').slice(0, 200).trim();
  const statement = String(body?.statement ?? '').slice(0, 2000).trim();
  if (!statement) throw error(400, 'Write a policy statement first.');

  const { client, model } = await getLLMClient(await resolveDefaultModel());

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      try { controller.enqueue(encoder.encode(': keystone\n\n')); } catch { /* noop */ }
      try {
        // 1. RAG — retrieve the most relevant evidence for this policy (the evidential trail,
        //    shown to the user). Hybrid BM25 + embeddings.
        send({ type: 'status', step: 'retrieve', message: 'Researching the corpus for relevant evidence…' });
        const chunks = await retrieve(`${title}\n${statement}`, 12);
        const evidence = chunks.map((c) => ({ title: c.title, url: c.url }));
        send({ type: 'evidence', sources: evidence });
        send({ type: 'status', step: 'weigh', message: `Weighing the policy against ${evidence.length} sources…` });

        // 2. Appraise, grounded in the retrieved evidence; the index is only for citing ids.
        const sys = `You are the Consideration Builder for Keystone, an education strategy workbench. A user proposes a HEADLINE POLICY. Ground a rigorous, balanced appraisal in the RETRIEVED EVIDENCE below; use the REFERENCE INDEX only to cite ids.

Return STRICT JSON only — no prose, no fences — exactly:
{"headline": string (ONE punchy verdict sentence, <=160 chars),
 "summary": string (2-3 sentences),
 "pros": [{"point": string, "detail": string}],
 "cons": [{"point": string, "detail": string}],
 "tensions": [{"point": string, "severity": "high"|"medium"|"low"}],
 "tradeoffs": [{"point": string, "detail": string}],
 "considerations": [{"point": string, "detail": string}],
 "stakeholders": {"impacted": [{"name": string, "why": string}], "interested": [{"name": string, "why": string}]},
 "references": {"pressures": [<pressure id>], "strategies": [<strategy id>], "legislation": [<legislation id>]},
 "watchouts": [string]}

Rules:
- Ground every point in the RETRIEVED EVIDENCE. Tensions must name genuine conflicts (e.g. open-by-default vs the duty of confidence; centralising vs the federated MAT/LA reality; sharing ahead of governance; AI ahead of data quality).
- references: cite ONLY ids from the REFERENCE INDEX that you actually drew on.
- headline: one decisive sentence a lead could read in isolation.
- For stakeholders, prefer these names where they fit (free text allowed): ${STAKEHOLDERS.join('; ')}.
- Be specific to the department and children's data. 3-6 items per list. Neutral, expert tone.

REFERENCE INDEX (valid ids to cite):
${referenceIndex()}

RETRIEVED EVIDENCE (most relevant corpus material for THIS policy — ground here):
${chunks.map((c, i) => `[${i + 1}] ${c.title}${c.url ? ` (${c.url})` : ''}\n${c.text.slice(0, 800)}`).join('\n\n')}`;

        const messages = [
          { role: 'system' as const, content: sys },
          { role: 'user' as const, content: `HEADLINE POLICY${title ? ` — "${title}"` : ''}:\n${statement}` },
        ];
        const generate = async (): Promise<string> => {
          const completion = await client.chat.completions.create(
            { model, messages, temperature: 0.2, max_tokens: 6000, stream: true, response_format: { type: 'json_object' } },
            { signal: AbortSignal.timeout(110_000) as any },
          );
          let acc = '';
          for await (const chunk of completion as any) {
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) { acc += delta; send({ type: 'tick' }); }
          }
          return acc;
        };

        let parsed: any;
        try { parsed = coerceJson(await generate()); }
        catch { send({ type: 'status', step: 'weigh', message: 'Tidying the appraisal…' }); parsed = coerceJson(await generate()); }
        const out = validate(parsed);
        out.evidence = evidence;
        send({ type: 'result', data: out });
      } catch (e: any) {
        send({ type: 'error', message: (e?.message ?? 'generation failed').slice(0, 160) });
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
