/**
 * D3 — whatsapp-trigger dispatch.
 *
 * The WhatsApp orchestrator bridge calls `dispatchWhatsAppWorkflow` for every
 * OWNER message that wasn't consumed by the D2 approval-reply intercept, BEFORE
 * falling through to general chat. If the message matches the keyword of a
 * `whatsapp-trigger` start node, that workflow is dispatched (mirroring the
 * gmail bridge's find-and-dispatch path) and the bridge replies
 * "▶ Started <name>"; otherwise the message falls through untouched.
 *
 * Mirrors `gmail/orchestrator-bridge.ts` findMatchingWorkflows/dispatchWorkflow.
 * `engine` is imported here (this module is itself loaded lazily by the bridge,
 * so it never widens the bridge's static import graph — the same reason the
 * gmail bridge can import `engine` at module top).
 */

import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows/types';
import { OWNER_PHONE } from './approval-notify';

export type WaMatchMode = 'prefix' | 'exact' | 'contains';

/**
 * Words that belong to the D2 approval-reply flow. A whatsapp-trigger keyword
 * can never be one of these, so a bare "yes"/"no"/"approve"/"deny" (i.e. an
 * approval reply whose code is missing/wrong) is never shadowed by a workflow.
 */
export const WA_RESERVED_KEYWORDS: ReadonlySet<string> = new Set(['approve', 'deny', 'yes', 'no']);

const OWNER_DIGITS = OWNER_PHONE.replace(/\D+/g, '');

/** Whether an inbound sender is the owner (digit-normalised comparison). */
export function isOwnerSender(from: string): boolean {
  return from.replace(/\D+/g, '') === OWNER_DIGITS;
}

/** Whether a configured keyword is reserved (belongs to the approval flow). */
export function isReservedKeyword(keyword: string): boolean {
  return WA_RESERVED_KEYWORDS.has(keyword.trim().toLowerCase());
}

export interface WaKeywordMatch {
  matched: boolean;
  /** The text forwarded downstream as {{input.message}} (keyword-stripped when stripKeyword). */
  stripped: string;
}

/**
 * Match an inbound message against a keyword per matchMode (case-insensitive)
 * and compute the forwarded (optionally keyword-stripped) remainder. Pure — no
 * DB / engine deps, so the matching matrix is unit-testable in isolation.
 *
 * - prefix (default): the message must START with the keyword as a whole token
 *   (keyword, or keyword followed by whitespace). "newsflash" does NOT match
 *   keyword "news".
 * - exact: the message must equal the keyword.
 * - contains: the keyword appears anywhere in the message.
 *
 * When stripKeyword is false the full trimmed message is forwarded unchanged.
 */
export function matchWhatsAppKeyword(
  text: string,
  keyword: string,
  matchMode: WaMatchMode,
  stripKeyword: boolean,
): WaKeywordMatch {
  const trimmed = (text ?? '').trim();
  const kw = (keyword ?? '').trim();
  if (!kw) return { matched: false, stripped: trimmed };

  const lowerText = trimmed.toLowerCase();
  const lowerKw = kw.toLowerCase();

  let matched = false;
  let stripped = trimmed;

  switch (matchMode) {
    case 'exact': {
      matched = lowerText === lowerKw;
      if (matched && stripKeyword) stripped = '';
      break;
    }
    case 'contains': {
      const idx = lowerText.indexOf(lowerKw);
      matched = idx !== -1;
      if (matched && stripKeyword) {
        stripped = (trimmed.slice(0, idx) + trimmed.slice(idx + kw.length)).replace(/\s+/g, ' ').trim();
      }
      break;
    }
    case 'prefix':
    default: {
      matched = lowerText === lowerKw || lowerText.startsWith(lowerKw + ' ');
      if (matched && stripKeyword) stripped = trimmed.slice(kw.length).trimStart();
      break;
    }
  }

  return { matched, stripped };
}

export interface WaWorkflowMatch {
  workflowId: string;
  workflowName: string;
  keyword: string;
  /** The forwarded (keyword-stripped) message for this match. */
  stripped: string;
}

/**
 * Find every enabled workflow whose start node is a `whatsapp-trigger` matching
 * the inbound text. Mirrors the gmail bridge's findMatchingWorkflows query
 * approach: load all nodes of the trigger type in one query, then verify each
 * parent workflow exists. Reserved-keyword triggers are skipped entirely so the
 * approval flow always owns approve/deny/yes/no.
 */
export async function findMatchingWhatsAppWorkflows(text: string): Promise<WaWorkflowMatch[]> {
  const triggerNodes = await db
    .select({
      id: workflowNodes.id,
      workflowId: workflowNodes.workflowId,
      config: workflowNodes.config,
    })
    .from(workflowNodes)
    .where(eq(workflowNodes.type, 'whatsapp-trigger'));

  if (triggerNodes.length === 0) return [];

  const matched: WaWorkflowMatch[] = [];

  for (const node of triggerNodes) {
    const config = (node.config ?? {}) as Record<string, unknown>;
    const keyword = typeof config.keyword === 'string' ? config.keyword : '';
    if (!keyword.trim()) continue;
    // Reserved words belong to the approval-reply flow — never route to a workflow.
    if (isReservedKeyword(keyword)) continue;

    const matchMode = (config.matchMode as WaMatchMode) ?? 'prefix';
    // stripKeyword defaults to true (only an explicit false disables it).
    const stripKeyword = config.stripKeyword !== false;

    const result = matchWhatsAppKeyword(text, keyword, matchMode, stripKeyword);
    if (!result.matched) continue;

    // Verify the parent workflow exists.
    const [wf] = await db
      .select({ id: workflows.id, name: workflows.name })
      .from(workflows)
      .where(eq(workflows.id, node.workflowId))
      .limit(1);
    if (!wf) continue;

    matched.push({
      workflowId: wf.id,
      workflowName: wf.name,
      keyword: keyword.trim(),
      stripped: result.stripped,
    });
  }

  return matched;
}

/**
 * Build a WorkflowDefinition from the DB and fire it via the engine, persisting
 * run status on completion. Byte-for-byte mirror of the gmail bridge's
 * dispatchWorkflow (same worker-mode switch, same run row shape).
 */
async function dispatchRun(workflowId: string, initialInput: Record<string, unknown>): Promise<void> {
  const [wf] = await db
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);
  if (!wf) return;

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

  const definition: WorkflowDefinition = {
    id: wf.id,
    name: wf.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: (n.config as Record<string, unknown>) ?? {},
      label: n.label,
      position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    })),
  };

  const runId = crypto.randomUUID();
  const workerMode = process.env.JKAI_RUN_WORKER === '1';

  await db.insert(workflowRuns).values({
    id: runId,
    workflowId,
    status: workerMode ? 'pending' : 'running',
    trigger: 'event',
    startedAt: new Date(),
    inputData: initialInput,
  });

  if (workerMode) {
    const { enqueue } = await import('$lib/workflows/run-queue');
    await enqueue(runId);
    return;
  }

  engine
    .execute(definition, runId, initialInput, undefined, workflowId)
    .then(async (result) => {
      await db
        .update(workflowRuns)
        .set({ status: result.status, completedAt: new Date(), error: result.error ?? null })
        .where(eq(workflowRuns.id, runId));
    })
    .catch(async (err) => {
      console.error(
        `[whatsapp-dispatch] workflow execution error (runId=${runId}):`,
        err instanceof Error ? err.message : err,
      );
      try {
        await db
          .update(workflowRuns)
          .set({ status: 'failed', completedAt: new Date(), error: err instanceof Error ? err.message : String(err) })
          .where(eq(workflowRuns.id, runId));
      } catch {
        /* swallow */
      }
    });
}

export interface WaDispatchResult {
  /** True = a workflow was dispatched; the bridge must NOT fall through to chat. */
  dispatched: boolean;
  /** Name of the dispatched workflow (for the "▶ Started …" reply). */
  workflowName?: string;
}

/**
 * Entry point for the bridge. Owner-only. Finds a matching whatsapp-trigger
 * workflow for the message and dispatches the FIRST match (logging if more than
 * one matched — a keyword should be owned by a single workflow). Returns
 * `{ dispatched: false }` for non-owners or no match so the bridge falls through
 * to general chat untouched.
 */
export async function dispatchWhatsAppWorkflow(from: string, text: string): Promise<WaDispatchResult> {
  if (!isOwnerSender(from)) return { dispatched: false };
  if (!text || !text.trim()) return { dispatched: false };

  try {
    const matches = await findMatchingWhatsAppWorkflows(text);
    if (matches.length === 0) return { dispatched: false };

    if (matches.length > 1) {
      console.warn(
        `[whatsapp-dispatch] ${matches.length} whatsapp-trigger workflows matched "${text.slice(0, 40)}" ` +
          `(${matches.map((m) => `${m.workflowName}[${m.keyword}]`).join(', ')}) — dispatching first only.`,
      );
    }

    const chosen = matches[0];
    console.log(`[whatsapp-dispatch] dispatching workflow "${chosen.workflowName}" (${chosen.workflowId}) keyword=${chosen.keyword}`);

    await dispatchRun(chosen.workflowId, {
      message: chosen.stripped,
      rawMessage: text,
      from,
      matchedKeyword: chosen.keyword,
    });

    return { dispatched: true, workflowName: chosen.workflowName };
  } catch (err) {
    console.error('[whatsapp-dispatch] dispatchWhatsAppWorkflow threw:', err instanceof Error ? err.message : err);
    return { dispatched: false };
  }
}
