import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiToolTraces, orchestratorChats } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ToolTrace } from '$lib/jkai/tool-trace';
import { getTools } from '$lib/workflows/site-tools/registry';
import {
  analyseChain,
  buildAnalysisMessages,
  coerceFindings,
  findingToIdea,
  routeCandidates,
  resolveStepTool,
  type ChainFinding,
} from '$lib/jkai/chain-analysis';
import { parseJsonLoose } from '$lib/selfimprove/types';

// Read one turn's tool-call chain and say where the calls went. Owner-gated by
// hooks, like the rest of /api/jkai.
//
// POST            -> analyse the chain, return findings
// POST { send }   -> push those findings into the self-improvement backlog
//
// The model is pinned to the SELFIMPROVE workload rather than the chat default
// so a finding means the same thing whichever surface produced it — the
// engine's own phases are pinned the same way, and this feeds the same backlog.

/** Accepts the trace id (= the chat job id) or the assistant message id, the
 *  same pair the page loader accepts — the client only ever holds one of them. */
async function loadTrace(id: string) {
  let [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.id, id)).limit(1);
  if (!row) {
    [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.messageId, id)).limit(1);
  }
  return row ?? null;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const row = await loadTrace(params.traceId);
  if (!row) return json({ error: 'No tool trace for that turn' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { send?: unknown };

  // ── Send an already-reviewed set of findings to the engine ───────────────
  //
  // Deliberately a separate call rather than a side effect of analysing: a
  // finding is a hypothesis drawn from ONE turn, and one turn cannot support a
  // rate. The backlog is where a hypothesis belongs; the live tool policy is
  // not, and nothing here writes to it.
  if (Array.isArray(body.send)) {
    const registered = new Set(getTools().map((t) => t.name));
    const findings = (body.send as ChainFinding[]).filter(
      (f) => f && typeof f === 'object' && typeof f.tool === 'string' && registered.has(f.tool) && typeof f.rationale === 'string',
    );
    if (!findings.length) return json({ error: 'No usable findings to send' }, { status: 400 });
    try {
      const { addIdeas } = await import('$lib/selfimprove/backlog');
      // addIdeas dedupes on a slug derived from the title, so the same finding
      // arriving from five traces updates one row instead of creating five.
      const added = await addIdeas(findings.map(findingToIdea));
      return json({ added, considered: findings.length });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'backlog write failed' }, { status: 500 });
    }
  }

  // ── Analyse ─────────────────────────────────────────────────────────────
  const trace = row.steps as ToolTrace;
  const shapes = getTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const analysis = analyseChain(trace, shapes);

  // Nothing measurable is worth a model call. Saying so is the honest answer,
  // and it keeps a button on a page from costing tokens on every quiet turn.
  if (analysis.signals.length === 0 && analysis.discoveryCalls === 0) {
    return json({ analysis, findings: [], model: null, note: 'No repeat, ladder or discovery pattern in this chain.' });
  }

  let answer = '';
  if (row.messageId) {
    const [msg] = await db
      .select({ content: orchestratorChats.content })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.id, row.messageId))
      .limit(1);
    answer = msg?.content ?? '';
  }

  const called = new Set((trace?.steps ?? []).map((s) => resolveStepTool(s).tool).filter(Boolean));
  const candidates = routeCandidates(row.prompt ?? '', shapes, called);
  const messages = buildAnalysisMessages(row.prompt ?? '', answer, analysis, candidates);

  try {
    const { getLLMClient } = await import('$lib/jkai/llm-client');
    const { resolveSelfimproveModel } = await import('$lib/server/models/workload-settings');
    const { client, model } = await getLLMClient(await resolveSelfimproveModel());
    const resp = await client.chat.completions.create({
      model,
      messages,
      // Generous, because reasoning tokens are deducted from this budget and a
      // truncated JSON body coerces to zero findings rather than to an error.
      max_tokens: 4000,
      temperature: 0.2,
    });
    const raw = parseJsonLoose(resp.choices?.[0]?.message?.content ?? '');
    const registered = new Set(shapes.map((s) => s.name));
    return json({ analysis, findings: coerceFindings(raw, analysis, registered), model });
  } catch (err) {
    // The measurement stands on its own — return it rather than losing the
    // deterministic half to a gateway failure.
    return json({
      analysis,
      findings: [],
      model: null,
      error: err instanceof Error ? err.message : 'analysis failed',
    }, { status: 502 });
  }
};
