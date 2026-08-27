/**
 * OpenAI chat-completions `messages[]` → Responses API `input[]`.
 *
 * This is the half of the transport swap that actually pays. `messagesToPrompt`
 * (messages.ts) flattens a conversation into one prose blob because the SDK
 * takes a single string per turn — which means every tool result arrives as
 * narrated text ("Tool result (x): ..."), the model has to re-read the whole
 * transcript as prose, and no two turns share a byte-identical prefix so prompt
 * caching can never hit.
 *
 * The Responses API takes the structure directly: system text becomes
 * `instructions`, turns keep their roles, and tool traffic becomes real
 * `function_call` / `function_call_output` items. Same conversation, told to
 * the model in its own grammar.
 *
 * Shapes follow the Codex responses adapter, which drove this exact
 * endpoint in production for months — including the two rules below that look
 * arbitrary and are not.
 */
import type { ChatMessage } from './messages';
import { flattenContent } from './messages';

/** A Responses API input item. Loose by design — the endpoint accepts several
 *  shapes and we pass through what the caller gave us. */
export type ResponsesInputItem = Record<string, unknown>;

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: unknown;
}

/**
 * `call_id` has a length ceiling on this endpoint, and an over-long id is
 * rejected for the whole request rather than truncated. Callers mostly send
 * OpenAI-style `call_abc123`, but a tool bridge upstream can hand us something
 * much longer, so clamp rather than trust.
 */
export function clampCallId(id: string): string {
  const trimmed = id.trim();
  return trimmed.length <= 64 ? trimmed : trimmed.slice(0, 64);
}

/**
 * Split system/developer text out of the conversation.
 *
 * Responses has a real `instructions` channel, so standing rules go there
 * instead of being glued to the top of the prompt. That is also what makes
 * caching work: `instructions` is the stable prefix across every turn in a
 * thread, and the site's system prompt is ~18–30k tokens of it.
 */
export function splitInstructions(messages: ChatMessage[]): {
  instructions: string;
  rest: ChatMessage[];
} {
  const instructions: string[] = [];
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') {
      const text = flattenContent(m.content).trim();
      if (text) instructions.push(text);
      continue;
    }
    rest.push(m);
  }
  return { instructions: instructions.join('\n\n'), rest };
}

/**
 * Build the `input[]` array.
 *
 * Note the asymmetry in content part types, which is a real API rule and not a
 * typo: a user turn carries `input_text`, an assistant turn carries
 * `output_text`. Sending `input_text` on an assistant turn is rejected.
 */
export function messagesToResponsesInput(messages: ChatMessage[]): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];

  for (const m of messages) {
    if (m.role === 'tool') {
      const callId = typeof m.tool_call_id === 'string' ? m.tool_call_id.trim() : '';
      // A tool result with no call to attach it to is unroutable — the endpoint
      // rejects the request rather than ignoring the item, so drop it here
      // where we can say why.
      if (!callId) continue;
      items.push({
        type: 'function_call_output',
        call_id: clampCallId(callId),
        output: flattenContent(m.content),
      });
      continue;
    }

    if (m.role === 'assistant') {
      const text = flattenContent(m.content).trim();
      if (text) {
        items.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      }
      // Tool calls are items in their own right, and must follow the assistant
      // message rather than being folded into it.
      for (const call of m.tool_calls ?? []) {
        const name = call.function?.name;
        const callId = call.id;
        if (!name || !callId) continue;
        let args = call.function?.arguments ?? '{}';
        if (typeof args !== 'string') args = JSON.stringify(args);
        items.push({
          type: 'function_call',
          call_id: clampCallId(callId),
          name,
          arguments: args.trim() || '{}',
        });
      }
      continue;
    }

    const text = flattenContent(m.content);
    if (!text.trim()) continue;
    items.push({ role: 'user', content: [{ type: 'input_text', text }] });
  }

  return items;
}

/**
 * OpenAI `tools[]` → Responses `tools[]`.
 *
 * This is why the per-request MCP server can go: the Responses API takes
 * function schemas directly. The MCP hop existed only because the SDK had no
 * `tools` parameter at all — it was never the better design, just the only one
 * available.
 */
export function toolsToResponsesTools(tools: unknown): ResponsesTool[] {
  if (!Array.isArray(tools)) return [];
  const out: ResponsesTool[] = [];
  for (const t of tools) {
    const fn = (t as { function?: { name?: string; description?: string; parameters?: unknown } })
      ?.function;
    const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
    // A nameless tool is one the model would be shown and could never call.
    if (!name) continue;
    out.push({
      type: 'function',
      name,
      ...(fn?.description ? { description: fn.description } : {}),
      parameters: fn?.parameters ?? { type: 'object', properties: {} },
    });
  }
  return out;
}

/**
 * A stable cache key for this conversation.
 *
 * The endpoint caches on the prompt prefix, but `prompt_cache_key` is what lets
 * it route repeat turns of the same conversation to the same cache. Derived
 * from the instructions, so every turn in a thread shares one key while two
 * different system prompts never collide. Bounded because the field has a
 * length limit and our instructions are tens of kilobytes.
 */
export function promptCacheKey(instructions: string): string | undefined {
  if (!instructions) return undefined;
  let h = 0x811c9dc5;
  for (let i = 0; i < instructions.length; i++) {
    h ^= instructions.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `jkai_${h.toString(16)}`;
}
