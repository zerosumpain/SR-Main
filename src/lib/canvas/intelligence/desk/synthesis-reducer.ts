// src/lib/canvas/intelligence/desk/synthesis-reducer.ts
//
// Pure reducer for synthesis.* SSE events → desk-side category + edge state.
// Mirrors the synthesis event shape emitted by src/lib/deepdive/synthesis.ts:
//   { type:'synthesis', data:{ seq, runId, stage, ... } }
// The shell feeds each event through applySynthesisEvent and applies the newly
// produced cardPatches (file + categorise) and newEdges (header → fact). The
// reducer accumulates, is idempotent on re-emit, and drops late events from a
// superseded run.

export interface SynthesisEvent {
  seq: number;
  runId: string;
  stage: 'started' | 'progress' | 'cluster' | 'done';
  token?: string;
  cluster?: { id: string; title: string; summary?: string; fact_ids: string[] };
  summary?: string;
  clusters?: unknown[];
  scope?: unknown;
  factCount?: number;
  tokensUsed?: number;
}

export interface SynthCategory {
  id: string;
  title: string;
  summary: string;
}
export interface SynthEdge {
  id: string; // 'syn:<clusterId>:<factId>'
  fromId: string; // 'cat:<clusterId>'
  toId: string; // factId
  kind: 'cluster';
}
export interface CardPatch {
  id: string;
  patch: {
    deskCategory: string;
    deskState: 'synthesized';
    synthesisRunId: string;
  };
}

export interface SynthesisState {
  runId: string | null;
  status: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
  streamedText: string;
  factCount: number;
  summary: string | null;
  tokensUsed: number | null;
  categories: SynthCategory[];
  /** Card mutations to apply to the store (filed + categorised). Accumulates. */
  cardPatches: CardPatch[];
  /** Synthesized connector edges (header → fact). Accumulates. */
  newEdges: SynthEdge[];
  /** Internal: fact ids already filed, to keep the reducer idempotent. */
  _filed: Set<string>;
}

export function initSynthesisState(): SynthesisState {
  return {
    runId: null,
    status: 'idle',
    streamedText: '',
    factCount: 0,
    summary: null,
    tokensUsed: null,
    categories: [],
    cardPatches: [],
    newEdges: [],
    _filed: new Set<string>(),
  };
}

export function applySynthesisEvent(state: SynthesisState, ev: SynthesisEvent): SynthesisState {
  // A new run supersedes the old one: reset accumulation, adopt the new runId.
  if (ev.stage === 'started') {
    return {
      ...initSynthesisState(),
      runId: ev.runId,
      status: 'running',
      factCount: ev.factCount ?? 0,
    };
  }

  // Drop late events from a superseded run.
  if (state.runId !== null && ev.runId !== state.runId) return state;

  if (ev.stage === 'progress') {
    return { ...state, streamedText: state.streamedText + (ev.token ?? '') };
  }

  if (ev.stage === 'cluster' && ev.cluster) {
    const { id: cid, title, summary, fact_ids } = ev.cluster;
    const categories = state.categories.some((c) => c.id === cid)
      ? state.categories
      : [...state.categories, { id: cid, title, summary: summary ?? '' }];

    const filed = new Set(state._filed);
    const newPatches: CardPatch[] = [];
    const newEdges: SynthEdge[] = [];
    for (const fid of fact_ids ?? []) {
      if (filed.has(fid)) continue;
      filed.add(fid);
      newPatches.push({
        id: fid,
        patch: { deskCategory: cid, deskState: 'synthesized', synthesisRunId: state.runId! },
      });
      newEdges.push({ id: `syn:${cid}:${fid}`, fromId: `cat:${cid}`, toId: fid, kind: 'cluster' });
    }

    return {
      ...state,
      categories,
      cardPatches: [...state.cardPatches, ...newPatches],
      newEdges: [...state.newEdges, ...newEdges],
      _filed: filed,
    };
  }

  if (ev.stage === 'done') {
    return {
      ...state,
      status: 'complete',
      summary: ev.summary ?? state.summary,
      tokensUsed: ev.tokensUsed ?? state.tokensUsed,
    };
  }

  return state;
}
