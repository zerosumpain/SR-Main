/**
 * Shared owner-inbound intercept for WhatsApp — the single source of truth for
 * the D2 (approval-reply) → D3 (whatsapp-trigger dispatch) sequence.
 *
 * Two callers use it:
 *  - `OrchestratorBridge.handleMessage` — the non-delegated topology, where our
 *    own Baileys socket receives inbound messages.
 *  - `POST /api/whatsapp/inbound` — the DELEGATED topology (production), where
 *    another process owns the WhatsApp connection and relays owner messages to us over
 *    HTTP. Without this entry point the D2/D3 inbound halves were dead code in
 *    production: the bridge is never wired in delegated mode, so an owner
 *    "APPROVE <code>" reply was handled there as ordinary chat and never
 *    resolved the paused run.
 *
 * Both intercept functions are owner-gated and shape-gated internally, so a
 * non-owner or non-matching message returns `{ handled: false }` and the caller
 * falls through to normal chat.
 *
 * Imports are lazy: approval-inbound / workflow-dispatch pull in engine-resume →
 * the eager node-registry barrel, which must not widen a caller's static graph.
 */

export interface InboundInterceptResult {
  /** True = consumed (approval resolved or workflow dispatched); do NOT fall
   *  through to general chat. */
  handled: boolean;
  /** Text to send back to the owner (a confirmation / "▶ Started …" / error). */
  reply?: string;
}

export async function interceptOwnerInbound(
  from: string,
  text: string,
): Promise<InboundInterceptResult> {
  // D2 — approval reply first (approve/deny/yes/no own these keywords).
  const { handleApprovalReply } = await import('./approval-inbound');
  const approval = await handleApprovalReply(from, text ?? '');
  if (approval.handled) return { handled: true, reply: approval.reply };

  // Daydream feedback — a short verdict reply ("useful" / "not that" / "never")
  // against the most recently delivered, still-unrated thought. Sits between
  // approvals (which own their keywords) and workflow dispatch: the matcher is
  // a closed phrase list additionally gated on an awaiting thought, so it can
  // only very rarely shadow a trigger keyword — and a trigger named "useful"
  // would deserve it.
  const { interceptDaydreamFeedback } = await import('$lib/daydream/wa-feedback');
  const feedback = await interceptDaydreamFeedback(text ?? '');
  if (feedback.handled) return { handled: true, reply: feedback.reply };

  // D3 — whatsapp-trigger keyword dispatch. Runs AFTER the approval intercept so
  // approve/deny/yes/no always resolve an approval first.
  const { dispatchWhatsAppWorkflow } = await import('./workflow-dispatch');
  const dispatch = await dispatchWhatsAppWorkflow(from, text ?? '');
  if (dispatch.dispatched) return { handled: true, reply: `▶ Started ${dispatch.workflowName}` };

  return { handled: false };
}
