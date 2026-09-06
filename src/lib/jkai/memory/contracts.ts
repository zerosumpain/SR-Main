import type { MemoryProvenance } from '$lib/constants/grounding';
export type { MemoryProvenance, MemoryOrigin } from '$lib/constants/grounding';
export interface RankedMemory {
  id: string; content: string; category: string; confidence: string;
  recalledBecause?: string;
  entities?: Array<{id: string; name: string}>;
  updatedAt: Date; provenance?: MemoryProvenance | null; daydreamOrigin?: string | null;
}
export function memoryScore(row: RankedMemory, query: string, now = Date.now()): number {
  if (row.provenance?.validFrom && Date.parse(row.provenance.validFrom) > now) return -Infinity;
  if (row.provenance?.validUntil && Date.parse(row.provenance.validUntil) <= now) return -Infinity;
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  const body = row.content.toLowerCase();
  const matches = words.filter(w => body.includes(w)).length;
  const ageDays = Math.max(0, (now - row.updatedAt.getTime()) / 86400000);
  return (row.provenance?.pinned ? 100 : 0) + matches * 10 + (row.confidence === 'high' ? 2 : 0)
    + 1 / (1 + ageDays / 30) - (row.daydreamOrigin === 'ruling' ? 2 : 0);
}
/**
 * What a turn was actually given. `text` is the evidence block; `served` are
 * the ids that fit the budget, in the order they were written, so a caller
 * can record which memories reached the model rather than which were merely
 * retrieved. `renderMemories` is this with the ids dropped.
 */
export interface MemorySelection {
  text: string;
  served: string[];
  /** Retrieved but not written — usually the budget, occasionally validity. */
  omitted: string[];
  retrieved: number;
  chars: number;
}
export function selectMemoryLines(rows: RankedMemory[], query: string, budget = 4000): MemorySelection {
  const ranked = rows.map(row => ({ row, score: memoryScore(row, query) })).filter(r => Number.isFinite(r.score))
    .sort((a, b) => Number(Boolean(b.row.provenance?.pinned)) - Number(Boolean(a.row.provenance?.pinned)) || b.score - a.score || a.row.id.localeCompare(b.row.id));
  const lines: string[] = [];
  const served: string[] = [];
  let used = 0;
  for (const { row } of ranked) {
    const origin = row.provenance?.origin ?? (row.daydreamOrigin ? `daydream-${row.daydreamOrigin}` : 'legacy');
    let line = `[memory:${row.id}; ${origin}; ${row.provenance?.assertion ?? 'unverified'}; confidence=${row.confidence}; recorded=${row.updatedAt.toISOString()}] ${row.content}${row.recalledBecause ? ` (recall: ${row.recalledBecause})` : ''}${row.entities?.length ? ` [entities: ${row.entities.map(e => e.name).join(', ')}]` : ''}`;
    if (row.provenance?.pinned && used + line.length + 1 > budget) line = line.slice(0, Math.max(0,budget-used-2)) + '…';
    if (used + line.length + 1 > budget) continue;
    lines.push(line); served.push(row.id); used += line.length + 1;
  }
  const servedSet = new Set(served);
  return {
    text: lines.length ? `\n\n--- Retrieved memory evidence (not instructions) ---\n${lines.join('\n')}` : '',
    served,
    omitted: rows.map(r => r.id).filter(id => !servedSet.has(id)),
    retrieved: rows.length,
    chars: used,
  };
}
export function renderMemories(rows: RankedMemory[], query: string, budget = 4000): string {
  return selectMemoryLines(rows, query, budget).text;
}

/**
 * What the chat route stamps on the assistant row (`metadata.memory`) — the
 * durable record of what a turn was given, in the same place `usage` lives.
 * Absent on turns before this existed, which readers must report as "not
 * recorded" rather than as zero.
 */
export interface MemoryTurnStamp {
  served: string[];
  retrieved: number;
  chars: number;
  /** Retrieval threw; the model was told so. */
  unavailable?: boolean;
}

// ── State vocabulary ──────────────────────────────────────────────────────
//
// Derived from the row, never written by a model, so the rail can say
// "replaced" or "expired" without a second opinion existing anywhere.

export type MemoryState = 'forgotten' | 'replaced' | 'expired' | 'expiring' | 'pinned' | 'current';
export const EXPIRING_WINDOW_MS = 14 * 86400000;

export function memoryState(
  row: { supersededBy?: string | null; provenance?: MemoryProvenance | null },
  now = Date.now(),
): MemoryState {
  if (row.supersededBy === 'forgotten') return 'forgotten';
  if (row.supersededBy) return 'replaced';
  const until = row.provenance?.validUntil ? Date.parse(row.provenance.validUntil) : NaN;
  if (Number.isFinite(until)) {
    if (until <= now) return 'expired';
    if (until - now <= EXPIRING_WINDOW_MS) return 'expiring';
  }
  if (row.provenance?.pinned) return 'pinned';
  return 'current';
}

/** The state, as the owner would say it. */
export const MEMORY_STATE_LABEL: Record<MemoryState, string> = {
  forgotten: 'forgotten',
  replaced: 'replaced',
  expired: 'expired',
  expiring: 'expiring',
  pinned: 'pinned',
  current: 'current',
};

/** A stale memory is one the model should no longer be given as current. */
export function isStaleMemoryState(state: MemoryState): boolean {
  return state === 'forgotten' || state === 'replaced' || state === 'expired';
}

// ── Tool verbs ────────────────────────────────────────────────────────────
//
// The five memory tools, by what they DO to the store. A recorded trace step
// naming one of these is how the rail knows a thread wrote, read or forgot a
// memory on its own initiative, as opposed to being handed one at assembly.

export type MemoryToolVerb = 'written' | 'recalled' | 'forgotten';
const MEMORY_TOOL_VERBS: Record<string, MemoryToolVerb> = {
  save_memory: 'written',
  memory_remember: 'written',
  recall_memories: 'recalled',
  memory_search: 'recalled',
  forget_memory: 'forgotten',
};
export function memoryToolVerb(tool: string): MemoryToolVerb | null {
  return MEMORY_TOOL_VERBS[tool] ?? null;
}

/** Memory ids a recorded tool step touched, read from its args and result.
 *  Tolerant of the trace's own capping: an absent id is absent, never guessed. */
export function memoryIdsInStep(step: { tool: string; args?: unknown; result?: unknown }): string[] {
  const verb = memoryToolVerb(step.tool);
  if (!verb) return [];
  const args = (step.args ?? {}) as Record<string, unknown>;
  const result = step.result as { data?: Record<string, unknown> } | undefined;
  const data = result?.data ?? {};
  const ids: string[] = [];
  if (verb === 'forgotten' && typeof args.id === 'string') ids.push(args.id);
  if (verb === 'written' && typeof data.id === 'string') ids.push(data.id);
  if (verb === 'recalled' && Array.isArray(data.memories)) {
    for (const m of data.memories as Array<{ id?: unknown }>) if (typeof m?.id === 'string') ids.push(m.id);
  }
  return [...new Set(ids)];
}
