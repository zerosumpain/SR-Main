import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { jkaiToolTraces, orchestratorChats, conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ToolTrace } from '$lib/jkai/tool-trace';
import { getToolErrorRates } from '$lib/server/tool-error-rates';

/** Window the "usually fails" baseline is measured over. */
const BASELINE_DAYS = 30;

/**
 * Below this many recorded calls, a percentage says more about the sample than
 * about the tool — one failure out of two is not a 50% failure rate in any
 * useful sense. The page renders those as "—" with the raw counts on hover
 * rather than printing a number that invites a wrong conclusion.
 */
const MIN_BASELINE_CALLS = 5;

export interface ToolBaseline {
  calls: number;
  errors: number;
  errorRate: number;
  /** False when the sample is too thin to quote a rate. */
  meaningful: boolean;
}

// Owner-gated by hooks (the whole /jkai area is owner-only) — see
// hooks.server.ts, which redirects a non-owner before any load runs.

/**
 * The route param accepts either identifier a caller might hold:
 *
 *  - the **trace id** (= the chat job id), which is what the live chat has the
 *    moment a turn finishes, and what `metadata.traceId` stores; and
 *  - the assistant **message id**, which is the only stable id a reloaded
 *    thread has for a turn.
 *
 * Trying the primary key first keeps the common case to a single indexed
 * lookup.
 */
export const load: PageServerLoad = async ({ params }) => {
  const id = params.traceId;

  let [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.id, id)).limit(1);
  if (!row) {
    [row] = await db.select().from(jkaiToolTraces).where(eq(jkaiToolTraces.messageId, id)).limit(1);
  }
  if (!row) throw error(404, 'No tool trace for that turn');

  // The reply this chain produced, for context at the top of the page. Absent
  // when the turn never persisted a message (cancelled, or a hang-up before the
  // insert) — the chain is still worth showing on its own.
  let reply: { id: string; content: string; createdAt: Date } | null = null;
  if (row.messageId) {
    const [msg] = await db
      .select({ id: orchestratorChats.id, content: orchestratorChats.content, createdAt: orchestratorChats.createdAt })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.id, row.messageId))
      .limit(1);
    reply = msg ?? null;
  }

  let conversationTitle: string | null = null;
  if (row.conversationId) {
    const [conv] = await db
      .select({ title: conversations.title })
      .from(conversations)
      .where(eq(conversations.id, row.conversationId))
      .limit(1);
    conversationTitle = conv?.title ?? null;
  }

  // How often each tool in THIS chain fails across every recorded turn. A single
  // turn cannot support a rate of its own — one call that failed is 100% and
  // means nothing — so the useful question is whether this failure is normal for
  // this tool. Narrowed to the tools actually present, so the page carries a
  // handful of rows rather than the whole registry.
  const trace = row.steps as ToolTrace;
  const toolsInTrace = new Set((trace?.steps ?? []).map((s) => s.displayTool).filter(Boolean));
  const baselines: Record<string, ToolBaseline> = {};
  if (toolsInTrace.size > 0) {
    const rates = await getToolErrorRates(BASELINE_DAYS).catch(() => null);
    for (const t of rates?.tools ?? []) {
      if (!toolsInTrace.has(t.tool)) continue;
      baselines[t.tool] = {
        calls: t.calls,
        errors: t.errors,
        errorRate: t.errorRate,
        meaningful: t.calls >= MIN_BASELINE_CALLS,
      };
    }
  }

  return {
    trace,
    baselines,
    baselineDays: BASELINE_DAYS,
    meta: {
      id: row.id,
      conversationId: row.conversationId,
      workflowId: row.workflowId,
      messageId: row.messageId,
      conversationTitle,
      prompt: row.prompt,
      model: row.model,
      provider: row.provider,
      costUsd: row.costUsd,
      stepCount: row.stepCount,
      errorCount: row.errorCount,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
    },
    reply,
  };
};
