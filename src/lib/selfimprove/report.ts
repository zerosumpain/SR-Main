// src/lib/selfimprove/report.ts
//
// REPORT phase. Builds the human-readable run report, persists the final
// `improvement_runs` record, and sends a short (<=600 char) WhatsApp summary to
// the owner via the existing `whatsapp_send` site tool.

import { upsertRecord } from '$lib/datastore';
import {
  COLLECTIONS,
  OWNER_PHONE,
  SYSTEM_ACTOR,
  asData,
  errMsg,
  type ImprovementRunData,
} from './types';

const ADMIN_LINK = 'https://strangeramblings.com/admin/ai/improvement';

function countActions(data: ImprovementRunData, kinds: string[]): number {
  return data.actions.filter((a) => kinds.includes(a.kind)).length;
}

/** Full markdown-ish report stored on the run record. */
export function buildReportText(data: ImprovementRunData): string {
  const lines: string[] = [];
  lines.push(`# Self-improvement run (${data.trigger})`);
  lines.push(`Status: ${data.status}`);
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

/** Short WhatsApp summary, hard-capped at 600 chars. */
export function buildWhatsappSummary(data: ImprovementRunData): string {
  const learned = countActions(data, ['insight']);
  const apis = countActions(data, ['api_registered', 'api_verified']);
  const built = countActions(data, ['tool_created']);
  const proposed = countActions(data, ['proposal']);
  const msg =
    `sr. nightly self-improve (${data.status}): ` +
    `${learned} insight(s), ${apis} API(s) added, ${built} tool(s) built, ${proposed} proposal(s). ` +
    `~$${data.costUsd.toFixed(2)}, ${data.llmCalls} LLM calls.\n${ADMIN_LINK}`;
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
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    await executeTool('whatsapp_send', { to: OWNER_PHONE, message: buildWhatsappSummary(data) });
  } catch (err) {
    console.error('[selfimprove] whatsapp summary failed:', errMsg(err));
  }
}
