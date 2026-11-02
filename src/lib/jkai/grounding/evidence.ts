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
/**
 * A tool result's `display` is for John's screen, never the model: the photo
 * tools put their thumbnails there (`{success, data, display}`), and the chat
 * card and the desk draw them while the model reads only `data`. A
 * `JSON.stringify` replacer, so it also clears `display` from stored steps
 * replayed as prior evidence (`{_truncated, display, preview}` included).
 * Only an envelope loses it; a `display` field inside `data` is left alone.
 */
export function withoutDisplay(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('display' in value)) return value;
  const v = value as Record<string, unknown>;
  if (typeof v.success !== 'boolean' && v._truncated !== true) return value;
  const { display: _drop, ...rest } = v;
  void _drop;
  return rest;
}
export function contextResult(result: unknown, budget = 32000): string {
  const text = JSON.stringify(result, withoutDisplay);
  if (text.length <= budget) return text;
  const data = result as { evidence?: EvidenceEnvelope };
  return JSON.stringify({ partial: true, evidence: data.evidence,
    instruction: 'Partial preview; use evidence_read with resultHandle before asserting exhaustive counts or omitted details.',
    preview: text.slice(0, Math.max(1000, budget - 1500)),
  });
}
