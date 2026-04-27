import { db } from '$lib/db';
import { workflowAuditLog, nodeExecutions } from '$lib/db/schema';
import { gte, desc } from 'drizzle-orm';
import { getOpenAIClient, getModel } from '$lib/deepdive/keys';
import type { NewPulseEvent } from '$lib/db/schema';

const WINDOW_MS = 4 * 60 * 60 * 1000;

const PROMPT = `You are an SRE summariser. Given the last 4h of workflow audit events and node executions, produce ONE concise sentence (max 200 chars) calling out anomalies (failed runs, repeated retries, unusual config changes). If everything looks healthy, say "No anomalies in the last 4h."

Output JSON ONLY: {"summary":"...","severity":"info"|"warn","anomalies":[{"kind":"...","detail":"..."}]}`;

export async function runAuditDigest(): Promise<NewPulseEvent[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [auditRows, execRows] = await Promise.all([
    db
      .select()
      .from(workflowAuditLog)
      .where(gte(workflowAuditLog.at, since))
      .orderBy(desc(workflowAuditLog.at))
      .limit(200),
    db
      .select()
      .from(nodeExecutions)
      .where(gte(nodeExecutions.startedAt, since))
      .orderBy(desc(nodeExecutions.startedAt))
      .limit(200),
  ]);

  if (auditRows.length === 0 && execRows.length === 0) {
    return [
      {
        kind: 'audit_digest',
        severity: 'info',
        summary: 'No audit/execution activity in the last 4h.',
        details: { auditCount: 0, execCount: 0 },
      } satisfies NewPulseEvent,
    ];
  }

  const failed = execRows.filter((r) => r.status === 'error' || r.status === 'failed');
  const condensed = {
    audits: auditRows.slice(0, 50).map((r) => ({ entity: r.entity, action: r.action, at: r.at })),
    execs: execRows
      .slice(0, 50)
      .map((r) => ({ status: r.status, nodeId: r.nodeId, error: r.error?.slice(0, 80) })),
  };

  try {
    const client = getOpenAIClient();
    const model = getModel();
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: JSON.stringify(condensed) },
      ],
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? '{}';
    const parsed = JSON.parse(text) as {
      summary?: string;
      severity?: 'info' | 'warn';
      anomalies?: unknown[];
    };
    return [
      {
        kind: 'audit_digest',
        severity: parsed.severity ?? 'info',
        summary: (parsed.summary ?? 'Digest unavailable').slice(0, 280),
        details: {
          ...parsed,
          failedCount: failed.length,
          totalAudits: auditRows.length,
          totalExecs: execRows.length,
        },
      } satisfies NewPulseEvent,
    ];
  } catch (e) {
    return [
      {
        kind: 'audit_digest',
        severity: 'warn',
        summary: `LLM digest unavailable; ${failed.length} failed exec(s) in 4h.`,
        details: { error: (e as Error).message, failedCount: failed.length },
      } satisfies NewPulseEvent,
    ];
  }
}
