import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';
import { llmCallRow } from '$lib/llm/usage-log';
import { parseUsageEvent, type ModelServiceApp } from '$lib/llm/model-service-contract';

export interface UsageIngestResult {
  accepted: number;
  duplicates: number;
  rejected: { index: number; id: string | null; error: string }[];
}

/**
 * Write extracted applications' LLM usage into the cost ledger.
 *
 * Each valid event becomes exactly the row `$lib/llm/usage-log` builds for a
 * call made in Main (`llmCallRow`), with three differences that all follow from
 * the call having happened elsewhere:
 *
 *  - `id` is the sender's event id, and the insert does nothing on conflict, so
 *    a batch retried after a lost response cannot double-count spend;
 *  - `created_at` is when the call finished, not when Main heard about it, so a
 *    batch held back by an outage lands on the right day;
 *  - `input.app` names the application, taken from its credential.
 *
 * A null cost stays null: Codex quota and unpriced models are not free.
 */
export async function ingestUsageEvents(app: ModelServiceApp, raw: unknown[], now = Date.now()): Promise<UsageIngestResult> {
  const rejected: UsageIngestResult['rejected'] = [];
  const rows: (ReturnType<typeof llmCallRow> & { id: string; createdAt: Date })[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  raw.forEach((item, index) => {
    const parsed = parseUsageEvent(item, now);
    if (!parsed.ok) {
      const id = item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        ? ((item as { id: string }).id).slice(0, 64)
        : null;
      rejected.push({ index, id, error: parsed.error });
      return;
    }
    const { id, occurredAt, ...call } = parsed.event;
    if (seen.has(id)) {
      duplicates++;
      return;
    }
    seen.add(id);
    const row = llmCallRow(call);
    rows.push({ ...row, id, createdAt: new Date(occurredAt), input: { ...(row.input ?? {}), app } });
  });

  let accepted = 0;
  if (rows.length) {
    const inserted = await db
      .insert(agentActions)
      .values(rows)
      .onConflictDoNothing({ target: agentActions.id })
      .returning({ id: agentActions.id });
    accepted = inserted.length;
    duplicates += rows.length - inserted.length;
  }
  return { accepted, duplicates, rejected };
}
