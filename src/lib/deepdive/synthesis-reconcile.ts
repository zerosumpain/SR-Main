// Pure index→UUID reconciliation for synthesis clustering.
//
// The clustering LLM is asked to reference facts by their 1-based bracket number
// ([1] <content>, [2] <content>, …) rather than their full UUID, because GLM-class
// models truncate/reformat/hallucinate long UUIDs — which silently breaks the
// downstream join (cluster fact_ids never match any card id, so nothing files on
// the desk). Here we map the model's integer indices back to the real fact UUIDs
// server-side, dropping anything out of range or non-integer, and fall back to a
// single "all findings" cluster if the model produced nothing usable.

/** A cluster as returned by the LLM: members are 1-based indices, not UUIDs. */
export interface LlmCluster {
  title: string;
  summary: string;
  /** 1-based indices into the presented fact list. */
  facts: number[];
}

/** A reconciled cluster with REAL fact UUIDs, ready for the downstream emit. */
export interface ReconciledCluster {
  id: string;
  title: string;
  summary: string;
  fact_ids: string[];
}

const FALLBACK_SUMMARY = 'All scoped findings grouped together.';

/** Coerce an unknown value to a positive 1-based integer index, or null. */
function toIndex(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Reconcile LLM-returned index clusters into clusters keyed on REAL fact UUIDs.
 *
 * - Maps each valid 1-based index back to its UUID via `idByIndex`.
 * - Drops out-of-range / non-integer / unknown indices, and de-dupes within a
 *   cluster (preserving first-seen order).
 * - Drops clusters that end up empty, but renumbers surviving cluster ids by
 *   their surviving position (`<runId>-c0`, `<runId>-c1`, …) so ordering is
 *   preserved and ids stay stable/contiguous.
 * - All-empty fallback: if NOTHING survives (total LLM failure), returns a single
 *   `{ title:'All Findings', summary, fact_ids: allIds }` cluster so the desk
 *   still organises instead of showing nothing.
 *
 * Pure: no I/O, no global state.
 */
export function reconcileClusters(
  llmClusters: LlmCluster[],
  idByIndex: Map<number, string>,
  allIds: string[],
  runId: string,
  execSummary?: string,
): ReconciledCluster[] {
  const out: ReconciledCluster[] = [];

  for (const c of llmClusters ?? []) {
    const seen = new Set<string>();
    const fact_ids: string[] = [];
    const members = Array.isArray((c as { facts?: unknown }).facts)
      ? (c as { facts: unknown[] }).facts
      : [];
    for (const raw of members) {
      const idx = toIndex(raw);
      if (idx === null) continue;
      const uuid = idByIndex.get(idx);
      if (uuid === undefined || seen.has(uuid)) continue;
      seen.add(uuid);
      fact_ids.push(uuid);
    }
    if (fact_ids.length === 0) continue; // drop empty clusters
    out.push({
      id: `${runId}-c${out.length}`,
      title: c?.title ?? 'Untitled',
      summary: c?.summary ?? '',
      fact_ids,
    });
  }

  if (out.length === 0) {
    // Total failure: keep the desk usable with one all-encompassing cluster.
    return [
      {
        id: `${runId}-c0`,
        title: 'All Findings',
        summary: execSummary && execSummary.trim().length > 0 ? execSummary : FALLBACK_SUMMARY,
        fact_ids: [...allIds],
      },
    ];
  }

  return out;
}
