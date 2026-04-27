import { db } from '$lib/db';
import { nodeExecutions } from '$lib/db/schema';
import { gte, desc } from 'drizzle-orm';
import type { NewPulseEvent } from '$lib/db/schema';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runWorkflowEfficiency(): Promise<NewPulseEvent[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await db
    .select()
    .from(nodeExecutions)
    .where(gte(nodeExecutions.startedAt, since))
    .orderBy(desc(nodeExecutions.startedAt))
    .limit(2000);

  if (rows.length === 0) return [];

  // nodeExecutions has no nodeType column; group by nodeId instead.
  const byNode = new Map<string, { count: number; durations: number[]; errors: number }>();
  for (const r of rows) {
    const key = r.nodeId;
    const slot = byNode.get(key) ?? { count: 0, durations: [], errors: 0 };
    slot.count += 1;
    if (r.completedAt && r.startedAt) {
      const start = new Date(r.startedAt as unknown as string | Date).getTime();
      const end = new Date(r.completedAt as unknown as string | Date).getTime();
      const d = end - start;
      if (Number.isFinite(d) && d >= 0) slot.durations.push(d);
    }
    if (r.status === 'error' || r.status === 'failed') slot.errors += 1;
    byNode.set(key, slot);
  }

  const flagged: Array<{ nodeId: string; p95Ms: number; errorRate: number; count: number }> = [];
  for (const [nodeId, slot] of byNode) {
    const sorted = [...slot.durations].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const errRate = slot.errors / Math.max(1, slot.count);
    if (p95 > 30_000 || errRate > 0.1) {
      flagged.push({ nodeId, p95Ms: p95, errorRate: Number(errRate.toFixed(2)), count: slot.count });
    }
  }

  if (flagged.length === 0) {
    return [
      {
        kind: 'workflow_efficiency',
        severity: 'info',
        summary: `No slow or error-prone nodes in the last 24h (${rows.length} executions).`,
        details: { totalExecs: rows.length },
      } satisfies NewPulseEvent,
    ];
  }

  return [
    {
      kind: 'workflow_efficiency',
      severity: 'warn',
      summary: `${flagged.length} node(s) flagged: ${flagged
        .slice(0, 3)
        .map((f) => f.nodeId)
        .join(', ')}.`,
      details: { flagged, totalExecs: rows.length },
    } satisfies NewPulseEvent,
  ];
}
