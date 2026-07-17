/**
 * D2 — Approval-via-WhatsApp: INBOUND resolution.
 *
 * The WhatsApp orchestrator bridge calls `handleApprovalReply` for every owner
 * message before falling through to general chat. An `APPROVE <code>` /
 * `DENY <code>` (yes/no aliases) reply resolves the paused interaction through
 * the SAME `resolveInteraction` path the canvas uses, so the run resumes
 * identically in web or worker mode — no HTTP self-hop.
 *
 * Split out from `approval-notify.ts` because it depends on `engine-resume`
 * (→ `$lib/workflows`), and the outbound module is imported eagerly by the node
 * registry; keeping the resume dependency here avoids an import cycle. Only the
 * bridge (loaded lazily at WhatsApp boot) imports this file.
 */

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { resolveInteraction } from '$lib/workflows/engine-resume';
import { resolveNaming } from '$lib/workflows/run-notifications';
import { parseApprovalReply, isApprovalTokenExpired } from './approval-tokens';
import { OWNER_PHONE, WA_APPROVAL_SNAPSHOT_KEY, type WaApprovalSnapshot } from './approval-notify';

const OWNER_DIGITS = OWNER_PHONE.replace(/\D+/g, '');

/** Whether an inbound sender is the owner (digit-normalised comparison). */
function isOwner(from: string): boolean {
  return from.replace(/\D+/g, '') === OWNER_DIGITS;
}

interface ApprovalLookupRow {
  runId: string;
  nodeId: string;
  workflowId: string;
  workflowName: string | null;
  workflowDescription: string | null;
  configSnapshot: Record<string, unknown> | null;
  resolvedAt: Date | string | null;
  cancelled: boolean;
  expiresAt: Date | string | null;
}

/**
 * Find the (most recent) interaction carrying a matching one-time code, joined
 * to its run + workflow. Global lookup keyed solely on the code — the inbound
 * message has no workflow context — which is precisely why the interactions
 * table (indexed by run, with first-class resolvedAt/cancelled/expiry) is the
 * right home for the token rather than a per-workflow data-store row.
 */
async function findPendingApprovalByCode(code: string): Promise<ApprovalLookupRow | null> {
  const res = await db.execute(sql`
    SELECT
      i.run_id            AS "runId",
      i.node_id           AS "nodeId",
      i.config_snapshot   AS "configSnapshot",
      i.resolved_at       AS "resolvedAt",
      i.cancelled         AS "cancelled",
      i.expires_at        AS "expiresAt",
      r.workflow_id       AS "workflowId",
      w.name              AS "workflowName",
      w.description       AS "workflowDescription"
    FROM workflow_interactions i
    JOIN workflow_runs r ON r.id = i.run_id
    JOIN workflows w ON w.id = r.workflow_id
    WHERE i.config_snapshot -> ${WA_APPROVAL_SNAPSHOT_KEY} ->> 'code' = ${code}
    ORDER BY i.opened_at DESC
    LIMIT 1
  `);
  const row = (res as unknown as { rows?: ApprovalLookupRow[] }).rows?.[0];
  return row ?? null;
}

export interface ApprovalReplyResult {
  /** True = this message was an owner approval reply we consumed; the bridge
   *  must NOT fall through to general chat. */
  handled: boolean;
  /** Optional confirmation / failure text for the bridge to send back. */
  reply?: string;
}

/**
 * Handle an inbound WhatsApp message as a possible approval reply.
 *
 * Returns `{ handled: false }` for anything that isn't an owner `APPROVE`/`DENY`
 * (yes/no) reply — those fall through to general chat untouched. For an owner
 * approval reply it ALWAYS returns `handled: true` (with a reply string), even
 * on failure, so an approval attempt never leaks into the chat model.
 */
export async function handleApprovalReply(
  from: string,
  text: string,
): Promise<ApprovalReplyResult> {
  // Owner-only + shape gate (both pure, cheap). Non-owner / non-matching
  // messages fall through untouched.
  if (!isOwner(from)) return { handled: false };
  const parsed = parseApprovalReply(text);
  if (!parsed) return { handled: false };

  try {
    const rec = await findPendingApprovalByCode(parsed.code);
    if (!rec) {
      // No interaction carries this code. The shape gate is deliberately loose
      // (verb + any 6-char token), so common owner chat — "yes please",
      // "no thanks", "deny access", "approve budget" — reaches here. Resolved
      // and cancelled interactions still EXIST as rows (they set resolvedAt /
      // cancelled, handled below), so a genuine approval code is effectively
      // always FOUND; "not found" means this wasn't an approval reply at all.
      // Fall through to general chat rather than swallowing the message.
      return { handled: false };
    }

    const display = resolveNaming(rec.workflowName, rec.workflowDescription, null, rec.workflowId).display;

    if (rec.cancelled) {
      return { handled: true, reply: `Approval ${parsed.code} is no longer active — "${display}" was cancelled.` };
    }
    if (rec.resolvedAt) {
      return { handled: true, reply: `Approval ${parsed.code} was already handled.` };
    }

    const snapshot = rec.configSnapshot?.[WA_APPROVAL_SNAPSHOT_KEY] as WaApprovalSnapshot | undefined;
    if (isApprovalTokenExpired(snapshot?.expiresAt) || isApprovalTokenExpired(rec.expiresAt)) {
      return { handled: true, reply: `Approval ${parsed.code} has expired. Re-run "${display}" to get a fresh code.` };
    }

    const result = await resolveInteraction({
      runId: rec.runId,
      nodeId: rec.nodeId,
      formValues: { approved: parsed.verdict === 'approved' },
      resolvedBy: `whatsapp:${from}`,
    });

    if (!result.resolved) {
      // Raced with a canvas resolve / cancel between lookup and resolve.
      return {
        handled: true,
        reply: result.reason === 'cancelled'
          ? `Approval ${parsed.code} is no longer active.`
          : `Approval ${parsed.code} was already handled.`,
      };
    }

    return {
      handled: true,
      reply: parsed.verdict === 'approved'
        ? `✓ Approved — "${display}" is continuing.`
        : `✗ Denied — "${display}" will take the rejected path.`,
    };
  } catch (err) {
    console.error('[approval-inbound] handleApprovalReply threw:', err instanceof Error ? err.message : err);
    return {
      handled: true,
      reply: `Something went wrong resolving approval ${parsed.code}. Resolve it from the canvas instead.`,
    };
  }
}
