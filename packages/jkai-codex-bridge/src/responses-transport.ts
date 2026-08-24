/**
 * The Codex Responses API, spoken directly.
 *
 * This replaces `@openai/codex-sdk` as the way the bridge reaches Codex, and it
 * exists for one measured reason: the SDK drives the `codex` CLI's app-server,
 * which injects its own agent scaffolding — shell tools, apply_patch
 * instructions, sandbox rules — into every request. On a chat turn that will
 * never touch a file, that cost **12,024 prompt tokens and ~3 seconds**, and
 * the SDK emits one completed message per turn so nothing could stream.
 *
 * Measured on the VPS, same model, same account, "reply ok":
 *
 *                        raw Responses    codex-sdk bridge
 *   input tokens                    27              12,024
 *   first visible text          934 ms          ~5,000 ms
 *   text deltas         33, incremental             1 block
 *   total                     1,389 ms           4,334 ms
 *
 * This is the transport Hermes used (`plugins/model-providers/openai-codex`,
 * `api_mode: codex_responses`), which is why chat felt faster before the Hermes
 * exit. Removing Hermes did not make Codex slower; it swapped a thin streaming
 * transport for a thick blocking one.
 */
import { getCodexAuth, invalidateCodexAuth } from './codex-auth';
import {
  messagesToResponsesInput,
  splitInstructions,
  toolsToResponsesTools,
  promptCacheKey,
} from './responses-input';
import type { ChatMessage } from './messages';
import type { StreamChunk, CapturedToolCall } from './codex-runner';
import type { CapturedSearch } from './web-search';
import { randomUUID } from 'node:crypto';

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

export interface ResponsesRunRequest {
  model: string;
  messages: ChatMessage[];
  tools?: unknown;
  outputSchema?: unknown;
  reasoningEffort?: string;
  webSearch?: boolean;
  signal?: AbortSignal;
}

/** Accumulator for a function call arriving across several SSE events. */
interface PendingCall {
  callId: string;
  name: string;
  args: string;
}

/**
 * Parse an SSE byte stream into `data:` payloads.
 *
 * Hand-rolled rather than pulled from a library because the failure mode we
 * care about is subtle: a JSON event split across two TCP reads must not be
 * parsed as two broken halves. Buffering to the blank-line frame boundary is
 * the whole job.
 */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            yield JSON.parse(payload);
          } catch {
            // A malformed frame is the server's problem, not a reason to drop
            // the rest of a working stream.
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Responses usage → the SDK-shaped usage the HTTP layer already reports. */
function toUsage(u: Record<string, any> | undefined) {
  if (!u) return null;
  return {
    input_tokens: u.input_tokens ?? 0,
    cached_input_tokens: u.input_tokens_details?.cached_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    reasoning_output_tokens: u.output_tokens_details?.reasoning_tokens ?? 0,
    total_tokens: u.total_tokens ?? 0,
  };
}

function buildBody(req: ResponsesRunRequest): Record<string, unknown> {
  const { instructions, rest } = splitInstructions(req.messages);
  const tools = toolsToResponsesTools(req.tools);
  const allTools: unknown[] = req.webSearch ? [...tools, { type: 'web_search' }] : tools;
  const cacheKey = promptCacheKey(instructions);

  return {
    model: req.model,
    ...(instructions ? { instructions } : {}),
    input: messagesToResponsesInput(rest),
    stream: true,
    // We re-send the conversation every turn (our callers are stateless), so
    // there is nothing for the server to retain between calls. Storing would
    // accumulate orphaned response objects on the account for no benefit.
    store: false,
    // Assembled once, explicitly. Built as two conditional spreads this read
    // fine and was wrong: the `webSearch` spread replaced `tools` wholesale
    // rather than adding to it, so a grounded call silently lost every caller
    // tool it had been given.
    ...(allTools.length ? { tools: allTools, parallel_tool_calls: true } : {}),
    ...(req.reasoningEffort
      ? { reasoning: { effort: req.reasoningEffort, summary: 'auto' } }
      : { reasoning: { summary: 'auto' } }),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    ...(req.outputSchema
      ? { text: { format: { type: 'json_schema', name: 'output', schema: req.outputSchema } } }
      : {}),
  };
}

async function openStream(req: ResponsesRunRequest, retryOn401 = true): Promise<Response> {
  const auth = await getCodexAuth();
  const res = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      'chatgpt-account-id': auth.accountId,
      'content-type': 'application/json',
      'openai-beta': 'responses=experimental',
      // The endpoint gates on this; it is how the CLI identifies itself and a
      // request without it is refused.
      originator: 'codex_cli_rs',
      session_id: randomUUID(),
    },
    body: JSON.stringify(buildBody(req)),
    ...(req.signal ? { signal: req.signal } : {}),
  });

  if (res.status === 401 && retryOn401) {
    // Our cached token was stale in a way the expiry claim did not predict —
    // revoked, rotated elsewhere, or clock skew. Drop it and let the next read
    // refresh from disk. Once only: a genuine auth failure must surface rather
    // than spin.
    invalidateCodexAuth();
    return openStream(req, false);
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`codex responses ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res;
}

/**
 * Run one turn, yielding text and reasoning as they arrive.
 *
 * Contract-compatible with `runStreamed` in codex-runner.ts, so the HTTP layer
 * and the non-streaming `runOnce` face are unchanged.
 *
 * Unlike the SDK path this does NOT abort at the first tool call. There is no
 * need: the Responses API hands back `function_call` items as part of a normal
 * completion, so the whole batch arrives without racing a grace timer, and a
 * turn that calls tools *and* writes prose keeps both.
 */
export async function* runStreamedViaResponses(
  req: ResponsesRunRequest,
): AsyncGenerator<StreamChunk> {
  const res = await openStream(req);

  const calls = new Map<string, PendingCall>();
  const searches = new Map<string, CapturedSearch>();
  let usage: ReturnType<typeof toUsage> = null;
  let failure: string | null = null;

  for await (const raw of sseEvents(res.body!)) {
    const ev = raw as Record<string, any>;
    const type = ev.type as string | undefined;
    if (!type) continue;

    if (type === 'response.output_text.delta') {
      if (typeof ev.delta === 'string' && ev.delta) yield { delta: ev.delta, done: false };
      continue;
    }

    // Reasoning arrives as a summary stream on this endpoint. Both spellings
    // are accepted upstream depending on model; take either.
    if (
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning_text.delta'
    ) {
      if (typeof ev.delta === 'string' && ev.delta) {
        yield { delta: '', reasoning: ev.delta, done: false };
      }
      continue;
    }

    if (type === 'response.output_item.done' || type === 'response.output_item.added') {
      const item = ev.item as Record<string, any> | undefined;
      if (item?.type === 'function_call' && item.name) {
        const callId = String(item.call_id ?? item.id ?? '');
        if (callId) {
          calls.set(callId, {
            callId,
            name: String(item.name),
            args: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
          });
        }
      }
      if (item?.type === 'web_search_call') {
        const q = item.action?.query ?? item.query;
        if (typeof q === 'string' && q.trim()) {
          const value = q.trim();
          // Same rule as web-search.ts: decided on the VALUE, so a page fetch
          // is a citation and a query is not, however the model reached it.
          searches.set(String(item.id ?? value), {
            kind: /^https?:\/\//i.test(value) ? 'fetch' : 'search',
            value,
          });
        }
      }
      continue;
    }

    if (type === 'response.completed') {
      usage = toUsage(ev.response?.usage);
      continue;
    }

    if (type === 'response.failed' || type === 'error') {
      failure =
        ev.response?.error?.message ?? ev.error?.message ?? ev.message ?? 'codex responses stream failed';
      continue;
    }
  }

  // A stream that produced tool calls is not a failure even if it also errored
  // on the way out — the caller can still run them. Mirrors the SDK path.
  if (failure && calls.size === 0) throw new Error(failure);

  const toolCalls: CapturedToolCall[] = [...calls.values()].map((c) => ({
    name: c.name,
    arguments: c.args,
    id: c.callId,
  }));

  yield {
    delta: '',
    usage,
    done: true,
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(searches.size ? { searches: [...searches.values()] } : {}),
  };
}
