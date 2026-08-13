/**
 * Pull the reasoning text out of one streamed chat-completion delta.
 *
 * Why this exists: the collapsible Reasoning panel in the chat UI is driven by
 * `{type:'thinking'}` JobEvents, and until now the only thing that produced one
 * was the Hermes frame adapter ($lib/jkai/sse-adapter). So with Hermes bypassed
 * (`jkai.chat.hermes_enabled=false`) the panel had no input: general-chat's
 * streaming loop read `delta.content` and `delta.tool_calls` and silently
 * dropped everything else, leaving the synthetic "Still thinking…" narration
 * ticker as the only sign of life on a reasoning-heavy turn.
 *
 * Extracted into its own module rather than inlined in the loop for the same
 * reason `adaptFrameToCanvasSse` was: the mapping is worth unit-testing, and
 * general-chat cannot be imported without a DB and a SvelteKit request context.
 *
 * Providers disagree about where reasoning lives, and we speak to them through
 * one OpenAI-shaped client, so all three known spellings are accepted:
 *   - `reasoning`         — OpenRouter (the gateway everything non-Codex uses)
 *   - `reasoning_content` — DeepSeek-style OpenAI-compatible endpoints
 *   - `reasoning_details` — newer OpenRouter builds, an ordered array
 *
 * Anything that is not a non-empty string is ignored rather than coerced: a
 * stringified object in the Reasoning panel is worse than an empty one. Note
 * the Codex bridge is deliberately NOT a source here — it strips reasoning
 * items server-side (packages/jkai-codex-bridge/src/codex-runner.ts), so a
 * Codex turn legitimately has none to surface.
 */

/** Reasoning carried as a bare string, or wrapped in a `{text|content|summary}`
 *  object — both shapes appear in the wild for the same provider. */
function readOne(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'summary'] as const) {
      if (typeof o[key] === 'string') return o[key] as string;
    }
  }
  return '';
}

export function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return '';
  const d = delta as Record<string, unknown>;

  // First non-empty source wins. A provider that sends the same text under two
  // keys must not have it emitted twice into the panel.
  const direct = readOne(d.reasoning) || readOne(d.reasoning_content);
  if (direct) return direct;

  if (Array.isArray(d.reasoning_details)) {
    return d.reasoning_details.map(readOne).join('');
  }
  return '';
}
