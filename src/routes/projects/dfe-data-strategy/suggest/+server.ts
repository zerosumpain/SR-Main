// suggest/+server.ts — "draft policies for this item". Given a strategy, pressure or
// stakeholder from the influence map / landscape, suggest 4-6 candidate headline policies
// the department could include in its data strategy, grounded in the project's material. Small JSON,
// streamed (SSE) for the same edge-proxy reason as /consider. Public + rate-limited.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getLLMClient } from '$lib/llm/client';
import { resolveProjectChatModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { buildStrategyContext, targetBrief } from '$lib/dfe-data-strategy/policy';
import { coerceJson } from '$lib/dfe-data-strategy/jsonsafe';

const HITS = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  HITS.set(ip, arr);
  return arr.length > 20;
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
  await requireProjectPublic('dfe-data-strategy', event);
  const ip = event.getClientAddress?.() ?? 'unknown';
  if (rateLimited(ip)) throw error(429, 'Too many requests — please wait a moment.');

  const body = await event.request.json().catch(() => ({}));
  const kind = ['strategy', 'pressure', 'stakeholder'].includes(body?.kind) ? body.kind : 'strategy';
  const id = String(body?.id ?? '').slice(0, 80);
  const label = String(body?.label ?? '').slice(0, 160);

  const sys = `You help an education data-strategy lead. Given ONE item from the strategy landscape, propose candidate HEADLINE POLICIES the data strategy could include in response to it — concrete, debatable positions (not platitudes), each something the lead could later pressure-test.

Return STRICT JSON only — no prose, no fences:
{"policies": [{"title": string (<= 8 words), "statement": string (one plain-English sentence, <= 40 words)}]}

Rules: 4-6 distinct policies; specific to the department and children's data; grounded in the STRATEGY CONTEXT; mix ambitious and cautious options where sensible. No commentary.

STRATEGY CONTEXT:
${buildStrategyContext()}`;

  const user = `ITEM TO DRAFT POLICIES FOR:\n${targetBrief(kind, id, label)}`;

  const { client, model } = await getLLMClient(await resolveProjectChatModel());

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* closed */ }
      };
      try { controller.enqueue(encoder.encode(': keystone\n\n')); } catch { /* noop */ }
      const generate = async (): Promise<string> => {
        const completion = await client.chat.completions.create(
          {
            model,
            messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
            temperature: 0.4,
            max_tokens: 1400,
            stream: true,
            response_format: { type: 'json_object' },
          },
          { signal: AbortSignal.timeout(90_000) as any },
        );
        let acc = '';
        for await (const chunk of completion as any) {
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) { acc += delta; send({ type: 'tick' }); }
        }
        return acc;
      };
      try {
        let parsed: any;
        try { parsed = coerceJson(await generate()); }
        catch { parsed = coerceJson(await generate()); }
        const policies = (Array.isArray(parsed?.policies) ? parsed.policies : [])
          .map((p: any) => ({ title: String(p?.title ?? '').slice(0, 120), statement: String(p?.statement ?? (typeof p === 'string' ? p : '')).slice(0, 400) }))
          .filter((p: any) => p.statement)
          .slice(0, 6);
        send({ type: 'result', data: { policies } });
      } catch (e: any) {
        send({ type: 'error', message: (e?.message ?? 'generation failed').slice(0, 160) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
};
