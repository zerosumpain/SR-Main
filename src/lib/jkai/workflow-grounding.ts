import { db } from '$lib/db';
import { workflows, workflowNodes } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

export interface DeliveryEntry {
  workflowId: string;
  runId: string;
  source: string;
  output: unknown;
}

export async function buildAttachedWorkflowGrounding(workflowIds: string[]): Promise<string> {
  if (workflowIds.length === 0) return '';
  const wfRows = await db.select().from(workflows).where(inArray(workflows.id, workflowIds));
  if (wfRows.length === 0) return '';
  const allNodes = await db.select().from(workflowNodes).where(inArray(workflowNodes.workflowId, workflowIds));

  const lines: string[] = [
    '--- Primary workflows (attached to this build) ---',
    'You can call workflow_run with `id` set to one of these workflow IDs.',
    'Pass `awaitMs` (max 600000) to block on the run and receive the result inline.',
    'Other workflows in the system are discoverable via workflow_list.',
    '',
  ];
  for (const wf of wfRows) {
    const wfNodes = allNodes.filter((n) => n.workflowId === wf.id);
    const trigger = wfNodes.find((n) => n.type === 'trigger' || n.type.endsWith('-trigger') || n.type === 'manual-trigger');
    lines.push(`• ${wf.name} (id: ${wf.id})`);
    if (wf.description) lines.push(`  ${wf.description}`);
    lines.push(`  trigger: ${trigger?.type ?? 'unknown'} | nodes: ${wfNodes.length}`);
  }
  return lines.join('\n');
}

export function buildDeliveriesBlock(deliveries: DeliveryEntry[]): string {
  if (deliveries.length === 0) return '';
  const lines: string[] = [
    '--- New workflow results since last iteration ---',
    'These workflows fired (subscription or manual trigger) and their results are available below.',
    'Call workflow_get_run with the runId for full detail.',
    '',
  ];
  for (const d of deliveries) {
    lines.push(`• workflowId=${d.workflowId} runId=${d.runId} source=${d.source}`);
    let body: string;
    try {
      body = JSON.stringify(d.output, null, 2);
    } catch {
      body = String(d.output);
    }
    if (body.length > 4000) body = body.slice(0, 4000) + '\n…(truncated; use workflow_get_run for the full payload)';
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n');
}
