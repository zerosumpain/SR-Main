import { db } from '$lib/db';
import { jkaiEvidenceResults } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { ToolResult, ToolExecContext } from '$lib/workflows/site-tools/registry-internal';
import { sourceReferences, type EvidenceEnvelope } from './evidence';
export async function retainEvidence(tool: string, result: ToolResult, ctx?: ToolExecContext): Promise<ToolResult> {
  if (!ctx?.conversationId || !result.success) return result;
  const id = crypto.randomUUID();
  const data = result.data as Record<string, unknown> | undefined;
  const evidence: EvidenceEnvelope = { id, tool, retrievedAt: new Date().toISOString(),
    completeness: data?.partial || data?.truncated || (data?.coverage && data.coverage !== 'complete') ? 'partial' : 'unknown',
    sourceRefs: sourceReferences(result.data),
  };
  try {
    await db.insert(jkaiEvidenceResults).values({ id, conversationId: ctx.conversationId, tool, result: result as unknown as Record<string, unknown> });
    evidence.resultHandle = id;
  } catch { /* Return the observed result even if retention failed. */ }
  return { ...result, evidence };
}
export async function readEvidence(id: string, conversationId: string, offset = 0, limit = 16000) {
  const [row] = await db.select().from(jkaiEvidenceResults).where(and(eq(jkaiEvidenceResults.id, id), eq(jkaiEvidenceResults.conversationId, conversationId))).limit(1);
  if (!row) throw new Error('No evidence in this conversation with that handle');
  const text = JSON.stringify(row.result);
  const start = Math.max(0, Math.floor(offset));
  const end = Math.min(text.length, start + Math.max(100, Math.min(16000, limit)));
  return { tool: row.tool, retrievedAt: row.createdAt, text: text.slice(start, end), offset: start,
    totalCharacters: text.length, nextOffset: end < text.length ? end : null, resultHandle: row.id };
}
