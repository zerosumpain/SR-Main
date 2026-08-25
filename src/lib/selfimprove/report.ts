// src/lib/selfimprove/report.ts
//
// REPORT phase. Builds the human-readable run report, persists the final
// `improvement_runs` record, and sends a short (<=600 char) WhatsApp summary to
// the owner via the existing `whatsapp_send` site tool.

import { ownerPhone } from '$lib/config/owner';
import { upsertRecord } from '$lib/datastore';
import {
  COLLECTIONS,
  SYSTEM_ACTOR,
  asData,
  errMsg,
  type ImprovementRunData,
} from './types';

const ADMIN_LINK = 'https://strangeramblings.com/admin/ai/improvement';

function countActions(data: ImprovementRunData, kinds: string[]): number {
  return data.actions.filter((a) => kinds.includes(a.kind)).length;
}

/** The prime-outcome line, or null when the phase couldn't measure. */
export function primeOutcomeLine(data: ImprovementRunData): string | null {
  const measured = data.actions.find((a) => a.kind === 'efficiency_measured');
  return measured ? measured.detail : null;
}

/** Full markdown-ish report stored on the run record. */
export function buildReportText(data: ImprovementRunData): string {
  const lines: string[] = [];
  lines.push(`# Self-improvement run (${data.trigger})`);
  lines.push(`Status: ${data.status}`);
  // The prime outcome leads: every other action is a means to this end.
  const prime = primeOutcomeLine(data);
  if (prime) lines.push(`Prime outcome — tool calls per answered question: ${prime}`);
  lines.push(`Started: ${data.startedAt}${data.finishedAt ? ` · Finished: ${data.finishedAt}` : ''}`);
  lines.push(
    `Budget: ${data.llmCalls} LLM call(s), ${data.tokensIn}+${data.tokensOut} tokens, ~$${data.costUsd.toFixed(3)}`,
  );
  lines.push('');
  lines.push('## Phases');
  for (const [name, p] of Object.entries(data.phases)) {
    lines.push(`- ${name}: ${p.status}${p.detail ? ` — ${p.detail}` : ''}${p.ms ? ` (${p.ms}ms)` : ''}`);
  }
  lines.push('');
  lines.push('## Actions');
  if (data.actions.length === 0) {
    lines.push('- (none)');
  } else {
    for (const a of data.actions) lines.push(`- [${a.kind}] ${a.detail}`);
  }
  return lines.join('\n');
}

/**
 * Short WhatsApp summary, hard-capped at 600 chars.
 *
 * Leads with SHIPPED work and names each tool. The old summary reported
 * "1 tool(s) built" for something staged disabled and therefore not callable —
 * which read as progress on a night that delivered none. Anything the engine
 * enabled by itself is named here, because that is the message worth waking up
 * to and the trigger for turning something off if it looks wrong.
 */
export function buildWhatsappSummary(data: ImprovementRunData): string {
  const shipped = data.actions.filter((a) => a.kind === 'tool_shipped');
  const repaired = data.actions.filter((a) => a.kind === 'tool_repaired');
  const prs = data.actions.filter((a) => a.kind === 'pr_opened');
  const apis = countActions(data, ['api_registered', 'api_verified']);
  const rejected = countActions(data, ['tool_rejected']);
  const queued = countActions(data, ['backlog_added']);

  const names = (list: typeof shipped) =>
    list
      .map((a) => a.detail.split(':')[0])
      .filter(Boolean)
      .join(', ');

  const policyPublished = data.actions.filter((a) => a.kind === 'policy_published');
  const policyKept = data.actions.filter((a) => a.kind === 'policy_kept');
  const policyReverted = data.actions.filter((a) => a.kind === 'policy_reverted');

  const parts: string[] = [`sr. nightly self-improve (${data.status}):`];
  // Calls-per-turn leads the message — it is the number the engine exists to
  // move, and a rollback is the one event worth waking up to.
  const efficiency = data.actions.find((a) => a.kind === 'efficiency_measured');
  if (efficiency) parts.push(efficiency.detail.split(';')[0].trim() + '.');
  if (policyKept.length) parts.push(`Call policy KEPT: ${policyKept[0].detail}.`);
  if (policyReverted.length) parts.push(`Call policy ROLLED BACK: ${policyReverted[0].detail}.`);
  if (policyPublished.length) parts.push(`New call policy on trial: ${policyPublished[0].detail.split('—')[0].trim()}.`);
  if (shipped.length) parts.push(`SHIPPED ${shipped.length} live tool(s): ${names(shipped)}.`);
  if (repaired.length) parts.push(`Repaired ${repaired.length}: ${names(repaired)}.`);
  if (prs.length) parts.push(`${prs.length} draft PR(s) awaiting review.`);
  if (apis) parts.push(`${apis} API(s) added.`);
  if (!shipped.length && !repaired.length && !prs.length && !policyPublished.length && !policyKept.length && !policyReverted.length)
    parts.push('Nothing shipped.');
  if (rejected) parts.push(`${rejected} rejected.`);
  if (queued) parts.push(`${queued} queued.`);
  parts.push(`~$${data.costUsd.toFixed(2)}, ${data.llmCalls} calls.`);

  const msg = `${parts.join(' ')}\n${ADMIN_LINK}`;
  return msg.length > 600 ? msg.slice(0, 597) + '...' : msg;
}

/**
 * Finalise a run: stamp the report text, persist the record, and (best-effort)
 * notify over WhatsApp. Persistence errors propagate so the caller can mark the
 * report phase failed; the WhatsApp send never throws.
 */
export async function finalizeAndNotify(runId: string, data: ImprovementRunData): Promise<void> {
  data.report = buildReportText(data);
  await upsertRecord(COLLECTIONS.improvementRuns, { key: runId, data: asData(data) }, SYSTEM_ACTOR);

  try {
    const to = ownerPhone();
    if (!to) throw new Error('WORKFLOW_NOTIFY_PHONE is not set');
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    await executeTool('whatsapp_send', { to, message: buildWhatsappSummary(data) });
  } catch (err) {
    console.error('[selfimprove] whatsapp summary failed:', errMsg(err));
  }
}
