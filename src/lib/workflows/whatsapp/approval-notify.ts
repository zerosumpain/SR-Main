/**
 * D2 — Approval-via-WhatsApp: OUTBOUND ping.
 *
 * When an `approval` node pauses a run and the workflow has opted into WhatsApp
 * approvals (`notifications.channel === 'whatsapp'` + `notifications.approvals
 * === true`), we mint a one-time code, stash it in the interaction's
 * `configSnapshot.waApproval`, and ping the owner.
 *
 * This module is imported by the approval node executor (which the node registry
 * loads eagerly via `$lib/workflows`), so it deliberately does NOT import
 * `engine-resume` — the inbound resolution path that needs `resolveInteraction`
 * lives in the separately-loaded `approval-inbound.ts` to keep this file off the
 * eager import cycle.
 *
 * Every exported function is wrapped so it can NEVER throw into its caller — a
 * notification hiccup must not fail a run.
 */

import { ownerPhone } from '$lib/config/owner';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveNaming } from '$lib/workflows/run-notifications';
import { generateApprovalCode, APPROVAL_TOKEN_TTL_MS } from './approval-tokens';

/**
 * The owner's WhatsApp number — matches `chat/wa-escalation.ts` /
 * `run-notifications.ts`. Empty string when unset, which every caller already
 * treats as "nobody to notify".
 *
 * A FUNCTION, not a const, and that matters: `$env/dynamic/private` is empty
 * until SvelteKit populates it, so a module-level read resolves at import time
 * and can freeze in `''` even on a host where the variable is set. The old
 * literal fallback hid that — without one it is a silent outage.
 */
export function getOwnerPhone(): string {
  return ownerPhone() ?? '';
}

/** The key under which the one-time code lives in an interaction's configSnapshot. */
export const WA_APPROVAL_SNAPSHOT_KEY = 'waApproval';

/** Max characters of the approval prompt echoed into the WhatsApp ping. */
const MAX_PROMPT_CHARS = 180;

/** The shape persisted under `configSnapshot.waApproval`. */
export interface WaApprovalSnapshot {
  code: string;
  expiresAt: string;
}

export interface ApprovalNotifyPlan {
  /** The one-time code to embed in the interaction snapshot and the ping. */
  code: string;
  /** ISO expiry (24h) — the token's own window, independent of the node timeout. */
  expiresAt: string;
  /** Human display name of the workflow, for the message. */
  display: string;
}

/** Collapse + trim + cap the prompt for the WhatsApp ping. */
function summarisePrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim() || 'Approve to continue?';
  return clean.length > MAX_PROMPT_CHARS ? `${clean.slice(0, MAX_PROMPT_CHARS - 1)}…` : clean;
}

/** Lazy-imported best-effort WhatsApp send. Never throws. */
async function sendWhatsApp(text: string): Promise<void> {
  try {
    const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
    const wa = getWhatsAppService();
    const result = await wa.sendMessage(getOwnerPhone(), text);
    if (!result.sent) {
      console.warn(`[approval-notify] WhatsApp send failed: ${result.error ?? 'unknown error'}`);
    }
  } catch (err) {
    console.error('[approval-notify] WhatsApp send threw:', err instanceof Error ? err.message : err);
  }
}

/**
 * Decide whether this workflow opts into WhatsApp approval pings and, if so,
 * mint a code + expiry. Returns null (silently) otherwise. Never throws.
 *
 * The caller (approval executor) embeds `{ code, expiresAt }` into the
 * interaction's configSnapshot BEFORE creating it, then calls
 * `sendApprovalPendingMessage` with the returned plan.
 */
export async function planApprovalNotification(
  workflowId: string,
): Promise<ApprovalNotifyPlan | null> {
  try {
    const [row] = await db
      .select({
        name: workflows.name,
        description: workflows.description,
        notifications: workflows.notifications,
      })
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);

    const cfg = row?.notifications;
    if (!cfg || cfg.approvals !== true) return null;
    // Only WhatsApp is wired; undefined channel defaults to whatsapp.
    if (cfg.channel && cfg.channel !== 'whatsapp') return null;

    const { display } = resolveNaming(row?.name, row?.description, null, workflowId);
    return {
      code: generateApprovalCode(),
      expiresAt: new Date(Date.now() + APPROVAL_TOKEN_TTL_MS).toISOString(),
      display,
    };
  } catch (err) {
    console.error('[approval-notify] planApprovalNotification threw:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Send the outbound "awaiting approval" WhatsApp ping. Never throws. */
export async function sendApprovalPendingMessage(
  plan: ApprovalNotifyPlan,
  prompt: string,
): Promise<void> {
  const text =
    `⏸ ${plan.display} awaiting approval: ${summarisePrompt(prompt)}. ` +
    `Reply APPROVE ${plan.code} or DENY ${plan.code}`;
  await sendWhatsApp(text);
}
