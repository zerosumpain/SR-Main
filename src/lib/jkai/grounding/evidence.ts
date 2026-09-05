export interface EvidenceEnvelope {
  id: string; tool: string; retrievedAt: string;
  completeness: 'complete' | 'partial' | 'unknown';
  sourceRefs: string[]; resultHandle?: string;
}
/** Extract citation identities, never infer event times from retrieval times. */
export function sourceReferences(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== 'object' || depth > 7) return [];
  const refs: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (['url', 'sourceUrl', 'source_url', 'memoryId', 'factId', 'eventId', 'fileId'].includes(key) && typeof v === 'string') refs.push(v);
    else if (v && typeof v === 'object') refs.push(...sourceReferences(v, depth + 1));
  }
  return [...new Set(refs)].slice(0, 100);
}
export function contextResult(result: unknown, budget = 32000): string {
  const text = JSON.stringify(result);
  if (text.length <= budget) return text;
  const data = result as { evidence?: EvidenceEnvelope };
  return JSON.stringify({ partial: true, evidence: data.evidence,
    instruction: 'Partial preview; use evidence_read with resultHandle before asserting exhaustive counts or omitted details.',
    preview: text.slice(0, Math.max(1000, budget - 1500)),
  });
}
