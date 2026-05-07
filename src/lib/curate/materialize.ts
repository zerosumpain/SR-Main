// src/lib/curate/materialize.ts
//
// Convert an approved CurateProposal into a full NodeSpec via an LLM turn.
// The proposal alone is too high-level for codegen — it lacks the executor
// body, full uiSchema, and complete docs. This step asks the LLM to flesh
// the proposal into a NodeSpec that writeNodeFiles() can compile.
//
// Called by the engine immediately after the user clicks Approve, before
// runGenerate() takes over.

import { getSession, updateSession } from './session-store';
import { streamChat } from './llm-client';
import { MATERIALIZE_SYSTEM_PROMPT } from './prompts/materialize';
import { validateNodeSpec } from './spec/validate';
import type { NodeSpec } from './spec/types';

/**
 * Materialize a NodeSpec from the session's stored proposal. Saves the
 * resulting NodeSpec to session.nodeSpec on success. Throws on validation
 * or LLM failure (caller surfaces the error).
 *
 * Uses streamChat (not oneShot) — non-streaming returns are unreliable
 * for very long outputs across some gateway models; the streamed pathway
 * accumulates text deltas robustly.
 */
export async function materializeNodeSpec(sessionId: string): Promise<NodeSpec> {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);
  if (!session.proposal) {
    throw new Error(`Session ${sessionId} has no proposal — cannot materialize spec`);
  }

  const proposalJson = JSON.stringify(session.proposal, null, 2);
  const userPrompt = `Approved proposal:\n\n${proposalJson}\n\nProduce the full NodeSpec JSON now. Output ONLY the JSON object, no prose, no fences.`;

  let raw = '';
  for await (const chunk of streamChat({
    system: MATERIALIZE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: 8192,
  })) {
    if (chunk.type === 'text') raw += chunk.delta;
  }

  if (!raw.trim()) {
    throw new Error(
      `Materialize LLM returned empty content. Likely max_tokens hit by reasoning, ` +
      `model unavailable, or content filter. Try again or check the gateway model setting.`,
    );
  }

  const spec = parseNodeSpecJson(raw);
  const validation = validateNodeSpec(spec);
  if (!validation.ok) {
    throw new Error(
      `Materialized NodeSpec failed validation:\n${validation.errors.join('\n')}\n\n` +
      `Raw LLM output (${raw.length} chars, first 800):\n${raw.slice(0, 800)}`,
    );
  }

  await updateSession(sessionId, { nodeSpec: spec as unknown as Record<string, unknown> });
  return spec;
}

/**
 * Tolerant JSON parser: strips ``` fences, leading prose, etc. — the LLM
 * sometimes adorns its output even when told not to.
 */
function parseNodeSpecJson(raw: string): NodeSpec {
  let text = raw.trim();

  // Strip ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // If the LLM emitted leading prose followed by a JSON object, try to
  // extract from the first { to the last balanced }.
  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    if (start >= 0) text = text.slice(start);
  }

  try {
    return JSON.parse(text) as NodeSpec;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`NodeSpec JSON parse failed: ${msg}\n\nFirst 500 chars:\n${text.slice(0, 500)}`);
  }
}
