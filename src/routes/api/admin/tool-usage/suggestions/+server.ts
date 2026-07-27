import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clampDays } from '$lib/server/hermes-sessions';
import { rToolAudit } from '$lib/server/hermes-remote';
import { getTools } from '$lib/workflows/site-tools/registry';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';

// Owner-only (all /api/admin/* is owner-gated by hooks.server.ts). Feeds the
// tool-usage audit for the window to the model and returns a forensic,
// actionable markdown analysis of how the toolset is being used.
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { days?: number };
  const days = clampDays(body?.days);

  const audit = await rToolAudit(days).catch(() => null);
  if (!audit) throw error(503, 'Tool-usage data unavailable (Hermes store unreachable).');

  const registered = getTools().map((t) => t.name);
  const called = new Set([...audit.tools, ...audit.jkaiTools].map((t) => t.tool));
  const neverUsed = registered.filter((n) => !called.has(n));

  const summary = {
    windowDays: days,
    totalToolCalls: audit.totalCalls,
    distinctToolsCalled: audit.uniqueTools,
    registeredToolCount: registered.length,
    topTools: audit.tools.slice(0, 20),
    resolvedJkaiSubTools: audit.jkaiTools.slice(0, 20),
    callsPerDay: audit.perDay,
    callsByHour: audit.byHour,
    neverUsedCount: neverUsed.length,
    neverUsedSample: neverUsed.slice(0, 40),
  };

  const system =
    'You are a systems analyst auditing how an AI assistant ("jkai") uses its tools, for the technical site owner. ' +
    'You are given aggregated tool-call telemetry from the LIVE engine over a time window. Produce a SHORT, forensic, ' +
    'actionable analysis in GitHub markdown. Structure with `## ` headings and bullet lists. Cover: (1) what the usage ' +
    'pattern reveals — concentration, meta-tool overhead (e.g. jkai_extended, activate_toolset), never-used/dead tools, ' +
    'time-of-day rhythm; (2) concrete improvements — which tools to prune/consolidate/pre-load/rename, and ergonomics ' +
    'fixes; (3) anything anomalous. Reference ACTUAL tool names and numbers from the data. No preamble, do not restate ' +
    'the raw data, no fluff. ~250–400 words.';
  const user = `Tool-usage telemetry (last ${days} days):\n\n${JSON.stringify(summary, null, 2)}`;

  const ctx = await resolveDefaultModel();
  const { client, model } = await getLLMClient(ctx);

  // max_tokens generous so GLM's reasoning budget doesn't truncate the answer
  // (see feedback_glm_reasoning_tokens: reasoning deducts from max_tokens).
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 4000,
    temperature: 0.4,
  });

  const suggestions = resp.choices?.[0]?.message?.content?.trim() || 'No suggestions were generated.';
  return json({ suggestions, model });
};
