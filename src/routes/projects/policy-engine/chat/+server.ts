// chat/+server.ts — the project-bound "Ask the Model" endpoint. Strictly scoped to THIS project:
// it is guarded by the same visibility guard as the pages, retrieves only from the project's own
// corpus index, and is prompted to refuse anything off-topic. It imports NONE of the jkai
// orchestrator / conversation machinery — only the low-level LLM transport. Streams SSE.

import { retrieve } from '../lib/retrieval.server';
import { createProjectChatHandler } from '$lib/projects/chat.server';

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

export const POST = createProjectChatHandler({
  slug: 'policy-engine',
  systemPrompt: SYSTEM,
  retrieve,
  answerScope: 'context and scenario above',
  timeoutMs: 60_000,
  supplement: ({ body }) => {
    const scenario = String(body.scenario ?? '').slice(0, 4000).trim();
    return scenario
      ? `\n\nCURRENT SCENARIO (the user's live model settings & results):\n${scenario}`
      : '\n\nCURRENT SCENARIO: (none provided — the user is on the landing page or has not set one)';
  },
});
