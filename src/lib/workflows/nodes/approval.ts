import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { createInteraction } from '$lib/workflows/engine-interactions';
import {
  planApprovalNotification,
  sendApprovalPendingMessage,
  WA_APPROVAL_SNAPSHOT_KEY,
} from '$lib/workflows/whatsapp/approval-notify';

export { approvalDef } from './approval.def';

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/**
 * Normalise an arbitrary decision value into the standard approved/rejected
 * NodeResult: the input passes through, an `approved` boolean is attached, and
 * `_selectedHandle` is set so the engine fans execution to the matching branch
 * (same mechanism as conditional / switch).
 */
function decisionResult(input: Record<string, unknown>, approved: boolean): NodeResult {
  const handle = approved ? 'approved' : 'rejected';
  return {
    output: { ...input, approved },
    metadata: { _selectedHandle: handle },
    rowCount: 1,
  };
}

export const approvalExecutor: NodeExecutor = {
  type: 'approval',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const prompt = (config.prompt as string) || 'Approve to continue?';
    const timeoutMinutes = (config.timeoutMinutes as number) || 60;

    // Fully-automated path: if a decision is already present in the input at the
    // configured dot-path, resolve synchronously without pausing the run. This
    // makes the gate usable in headless / scheduled workflows and keeps the
    // approved/rejected branch routing identical to the human path.
    const decisionPath = (config.decisionPath as string) || '';
    if (decisionPath) {
      const raw = resolvePath(input, decisionPath);
      if (typeof raw === 'boolean') {
        return decisionResult(input, raw);
      }
    }

    // D2 — opt-in WhatsApp approval: if this workflow enabled it, mint a
    // one-time code to embed in the interaction snapshot and ping the owner
    // after the interaction exists. planApprovalNotification never throws and
    // returns null when the workflow hasn't opted in (the default). Skipped in
    // dryRun (verify) so a dry-run never pings the phone.
    const waPlan = context.dryRun ? null : await planApprovalNotification(context.workflowId);

    const configSnapshot: Record<string, unknown> = {
      // Surface a single boolean field for the resolve form. On resume the
      // engine seeds this node's output with { completed, formValues, ... };
      // downstream nodes read the decision from formValues.approved (or the
      // top-level approved value the resolver may attach).
      fields: [{ name: 'approved', type: 'boolean', label: prompt }],
    };
    if (waPlan) {
      configSnapshot[WA_APPROVAL_SNAPSHOT_KEY] = { code: waPlan.code, expiresAt: waPlan.expiresAt };
    }

    // Human path: register a pending interaction and return the pause sentinel.
    // Reuses the SAME engine pause/resume primitive as interactive-step
    // (createInteraction + pause: { reason: 'awaiting_human', interactionId }).
    // No import from $lib/workflows/scraper/* — the approval gate is fully
    // decoupled from the browser scraper.
    const interactionId = await createInteraction({
      runId: context.runId,
      nodeId: context._currentNodeId ?? '',
      mode: 'confirm',
      prompt,
      configSnapshot,
      timeoutMinutes,
    });

    // Fire-and-forget the WhatsApp ping (never throws). Sent after the
    // interaction is persisted so an inbound reply always finds a matching row.
    if (waPlan) {
      void sendApprovalPendingMessage(waPlan, prompt);
    }

    return {
      output: {},
      pause: { reason: 'awaiting_human', interactionId },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Passed through to the approved / rejected branch' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'On approve: input passed through with approved:true (approved handle). On reject: approved:false (rejected handle).',
    };
  },
};
