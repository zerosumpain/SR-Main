// projects/archetype/llm — the site-held OpenRouter key, lent to the ARCHETYPE bundle.
//
// ARCHETYPE ships as a static bundle (data/jkai-projects/archetype/, served by the sibling
// [slug]/[...path] route). Its balance lab has always been able to ask a model to rank the
// engine's own proposals, but only if the visitor pasted their own OpenRouter key into a panel —
// a step nobody takes. `src/engine/lab/advisor.ts` was written with a `proxyUrl` option for exactly
// this: "a server-side relay that holds the key instead". This is that relay.
//
// WHY THE SHAPE IS OPENAI'S. The bundle already speaks OpenRouter's chat-completions dialect and
// parses its reply. Relaying that dialect verbatim means the client needs no new transport code and
// no new failure paths — the same parser, the same status handling, the same timeouts. The ONLY
// difference the bundle sees between "my own key" and "the site's key" is the URL.
//
// WHY IT IS HARDENED THE WAY IT IS. /projects is a PUBLIC_PATHS prefix (src/lib/auth.ts), so this
// route is reachable by anonymous traffic the moment the file exists — scripts/check-public-routes.mjs
// exists to make that visible rather than silent. An unguarded chat relay on a public path is a free
// LLM for the internet, billed to the site. Five things bound that, and none of them is a prompt:
//
//   1. The SERVER picks the model. The client's `model` field is read and discarded.
//   2. The server PREPENDS its own system message. Whatever the caller sends, the model is told
//      first that it is part of the ARCHETYPE balance lab and answers nothing else.
//   3. Output is forced to a JSON object and capped. Prose costs tokens; JSON of a fixed shape
//      is worth very little to anyone who is not the lab.
//   4. Per-IP AND global rate limits. The per-IP limit stops one abuser; the global limit bounds
//      the bill when the abuse is distributed, which a per-IP limit alone cannot do.
//   5. Hard caps on body size, message count and message length, checked before any of it is
//      forwarded — an oversized prompt is refused here, not paid for upstream.
//
// It deliberately imports NONE of the jkai orchestrator, conversation or tool machinery. Only the
// low-level LLM transport, exactly as the policy-engine and data-spine project endpoints do.

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { requireProjectPublic } from '$lib/projects/guard';
import { getLLMClient } from '$lib/llm/client';
import { resolveProjectChatModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';

// --- Limits -----------------------------------------------------------------
// Sized for what the lab actually sends: one system prompt describing the objective and the
// detectors, one user prompt listing a handful of findings and proposals. That is a few thousand
// tokens, asked for by a deliberate button press — never a stream of chat.

/** Whole-request ceiling. The largest legitimate call (findings + ~8 proposals) is well under 20KB. */
const MAX_BODY_BYTES = 64 * 1024;
/** system + user is the shape the lab sends; four leaves room for a short exchange without becoming a chat. */
const MAX_MESSAGES = 4;
const MAX_MESSAGE_CHARS = 24_000;
/**
 * Enough for an ordering, six short notes and a paragraph of reading. Not enough to be worth stealing.
 *
 * Sized at 3000 rather than the ~800 the reply actually needs because the site's default model is
 * chosen nightly and REASONING models spend this budget before they emit their first visible token —
 * a ceiling that fits the answer will silently return an empty one the day the router picks a
 * thinking model. 3000 is the floor this codebase already uses everywhere that hazard exists.
 */
const MAX_OUTPUT_TOKENS = 3_000;
/**
 * Longer than it looks like it needs to be. A measured call against the current default took ~20s
 * for a two-proposal ranking; a reasoning model on a full findings list is slower again, and the
 * failure this avoids — a timeout that reads to the visitor as "the adviser is broken" — is worse
 * than waiting. The bundle's own deadline sits just above this so that THIS one fires first and the
 * visitor gets a sentence explaining what happened rather than a bare abort.
 */
const UPSTREAM_TIMEOUT_MS = 45_000;

/** Per-IP: the lab's own use is a handful of presses per session. */
const IP_WINDOW_MS = 5 * 60_000;
const IP_MAX_PER_WINDOW = 8;
/** Global: bounds the bill under distributed abuse, which a per-IP limit cannot. */
const GLOBAL_WINDOW_MS = 60 * 60_000;
const GLOBAL_MAX_PER_WINDOW = 180;

// In-memory, resets on restart — deliberately simple, and the same approach the policy-engine
// endpoint takes. A shared store would be a bigger dependency than the risk warrants.
const IP_HITS = new Map<string, number[]>();
let globalHits: number[] = [];

/** Bound the map itself: a stream of unique source IPs must not grow it without limit. */
const MAX_TRACKED_IPS = 5_000;

function sweep(times: number[], now: number, windowMs: number): number[] {
  return times.filter((t) => now - t < windowMs);
}

function rateLimited(ip: string): 'ip' | 'global' | null {
  const now = Date.now();

  globalHits = sweep(globalHits, now, GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_MAX_PER_WINDOW) return 'global';

  const mine = sweep(IP_HITS.get(ip) ?? [], now, IP_WINDOW_MS);
  if (mine.length >= IP_MAX_PER_WINDOW) {
    IP_HITS.set(ip, mine);
    return 'ip';
  }

  mine.push(now);
  IP_HITS.set(ip, mine);
  globalHits.push(now);

  if (IP_HITS.size > MAX_TRACKED_IPS) {
    for (const [key, times] of IP_HITS) {
      if (sweep(times, now, IP_WINDOW_MS).length === 0) IP_HITS.delete(key);
      if (IP_HITS.size <= MAX_TRACKED_IPS) break;
    }
  }
  return null;
}

/**
 * The guardrail, prepended to whatever the caller sent.
 *
 * This is not the lab's prompt and does not try to be — the lab's own system message still follows
 * and still describes the objective, the findings and the proposals. This one exists so that a
 * caller who sends something else entirely gets a refusal rather than an assistant. It is a
 * mitigation, not the mitigation: the model picking, the token cap and the rate limits hold even
 * when a model ignores every word of this.
 */
const GUARDRAIL =
  'You are the balance adviser inside ARCHETYPE, a strategy-game balance laboratory at ' +
  'strangeramblings.com/projects/archetype. You have exactly one job: comment on, and rank, ' +
  'game-balance options that the ARCHETYPE engine has already measured and already generated. ' +
  'You never write code, never author configuration, and never invent an option that was not ' +
  'offered to you. If the request that follows is not about ARCHETYPE game balance, reply with ' +
  'the JSON object {"error":"out of scope"} and nothing else. Always reply with a single JSON object.';

interface IncomingMessage {
  role: unknown;
  content: unknown;
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
  // Same visibility gate as the bundle itself: if the project is private, its relay 404s for the
  // public exactly as its assets do.
  await requireProjectPublic('archetype', event);

  const ip = event.getClientAddress?.() ?? 'unknown';
  const limit = rateLimited(ip);
  if (limit === 'ip') {
    throw error(429, 'Too many adviser calls from this address. Wait a few minutes and try again.');
  }
  if (limit === 'global') {
    throw error(429, 'The adviser is busy site-wide. Try again later, or use your own OpenRouter key in the panel.');
  }

  // Size-check before parsing: refusing a 10MB body should not cost 10MB of parsing.
  const declared = Number(event.request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw error(413, 'Request too large.');
  }
  const raw = await event.request.text();
  if (raw.length > MAX_BODY_BYTES) throw error(413, 'Request too large.');

  let body: { messages?: unknown; temperature?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    throw error(400, 'Body is not JSON.');
  }

  const incoming = Array.isArray(body?.messages) ? (body.messages as IncomingMessage[]) : [];
  if (incoming.length === 0) throw error(400, 'No messages.');
  if (incoming.length > MAX_MESSAGES) throw error(400, `At most ${MAX_MESSAGES} messages.`);

  // Only the two roles the lab uses survive. An 'assistant' turn asserting a fact the model then
  // treats as its own prior output is the cheapest way to talk a model past its instructions, and
  // the lab has no need of one.
  const messages = incoming.map((m) => {
    const role = m?.role === 'system' ? 'system' : 'user';
    const content = String(m?.content ?? '');
    if (content.length > MAX_MESSAGE_CHARS) {
      throw error(400, `A message exceeds ${MAX_MESSAGE_CHARS} characters.`);
    }
    return { role, content } as const;
  });

  const temperature = Math.min(1, Math.max(0, Number(body?.temperature ?? 0.2) || 0));

  try {
    // The client and model both come from the site's own gateway — the caller's `model` field is
    // read by nobody. resolveProjectChatModel() is the same setting the rest of the site chats on, so
    // the adviser follows the site's model choice without a second place to keep in step.
    const { client, model } = await getLLMClient(await resolveProjectChatModel());

    const completion = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'system', content: GUARDRAIL }, ...messages],
        temperature,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
      },
      { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) as never },
    );

    const content = completion?.choices?.[0]?.message?.content ?? '';

    // Relayed in OpenRouter's own shape, minus the usage/provider detail the bundle never reads.
    // `model` is echoed as the model actually used, not the one asked for, so the panel can show
    // the truth rather than its own guess.
    return json({
      model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: completion?.choices?.[0]?.finish_reason ?? 'stop' }],
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // 502, not 500: the failure is upstream, and the bundle's own error text already says the
    // engine's ranking still stands. Truncated because an upstream message is not ours to trust.
    throw error(502, `The adviser could not be reached: ${detail.slice(0, 160)}`);
  }
};
