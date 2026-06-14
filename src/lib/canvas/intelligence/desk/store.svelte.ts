// src/lib/canvas/intelligence/desk/store.svelte.ts
//
// Hydrate-then-stream desk store. On mount: GET /api/deepdive/[id]/data to
// seed existing artefacts, THEN subscribe to /api/deepdive/[id]/stream for
// deltas. Cards are deduped by id; out-of-order deltas (lower seq) are dropped.
// Collections are $state.raw and replaced wholesale on a ~5ms debounced flush.

import {
  initSynthesisState,
  applySynthesisEvent,
  type SynthesisEvent,
  type SynthesisState,
  type SynthCategory,
  type SynthEdge,
} from './synthesis-reducer';

export type CardKind = 'source' | 'fact' | 'entity';

export interface DeskCard {
  id: string;
  kind: CardKind;
  seq: number;
  phase: number; // 1|2|3, 'post' folded to 4 by the caller
  fields: Record<string, unknown>;
  // persisted desk geometry (null/undefined → auto-layout)
  canvasX?: number | null;
  canvasY?: number | null;
  pinned?: boolean;
  deskState?: string;
  deskCategory?: string | null;
}

export interface DeskEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType?: string | null;
  sentiment?: string | null;
}

export interface SynthesisCluster {
  id: string;
  title: string;
  summary: string;
  fact_ids: string[];
}

/** Seed payload for a quick-answer desk: a handful of sources + the streamed
 *  answer text, handed in by the page load so the small desk renders
 *  immediately without a /data hydrate. */
export interface QuickInitial {
  status: string;
  answer: string;
  sources: Array<Record<string, unknown>>;
  errorMessage: string;
  durationMs: number;
  createdAt: string;
}

export interface DeskStoreOptions {
  /** 'deep' (default) hydrates+streams from /api/deepdive; 'quick' seeds from
   *  quickInitial and streams from /quickanswer/[id]/stream. */
  mode?: 'deep' | 'quick';
  /** Seed for quick mode. Ignored when mode !== 'quick'. */
  quickInitial?: QuickInitial;
}

// ——— pure merge core (unit-tested) ———

/** Build the initial id→card map from a hydrate batch (last write wins). */
export function dedupHydrate(cards: DeskCard[]): Map<string, DeskCard> {
  const m = new Map<string, DeskCard>();
  for (const c of cards) m.set(c.id, c);
  return m;
}

/**
 * Return a NEW map with `card` merged in. Dedups by id; an existing card is
 * only overwritten by a delta with a strictly higher seq (so reconnect /
 * replay can't clobber fresher state). Never mutates `base`.
 */
export function mergeArtefact(
  base: Map<string, DeskCard>,
  card: DeskCard,
): Map<string, DeskCard> {
  const existing = base.get(card.id);
  if (existing && card.seq <= existing.seq) return base; // stale / replay — no-op
  const next = new Map(base);
  next.set(card.id, existing ? { ...existing, ...card } : card);
  return next;
}

// ——— normalisers: shape the /data + SSE payloads into DeskCards/Edges ———

function phaseToNum(phase: unknown): number {
  if (phase === 'post') return 4;
  const n = Number(phase);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Map a /data artefact row (source|fact|entity) into a DeskCard. */
export function rowToCard(kind: CardKind, row: Record<string, unknown>): DeskCard {
  const { id, canvasX, canvasY, pinned, deskState, deskCategory, ...rest } = row as any;
  return {
    id: String(id),
    kind,
    seq: 0,
    phase: phaseToNum((row as any).phase),
    fields: rest,
    canvasX: canvasX ?? null,
    canvasY: canvasY ?? null,
    pinned: pinned ?? false,
    deskState: deskState ?? 'unfiled',
    deskCategory: deskCategory ?? null,
  };
}

/** Map a quick-answer source (QuickAnswerSource shape) into a source DeskCard.
 *  Quick sources have no DB id; we synthesise a stable id from the citation
 *  index / url so reconnect dedups cleanly. */
export function quickSourceToCard(src: Record<string, unknown>, idx: number): DeskCard {
  const citation = (src as any).citationIndex;
  const id = `qs-${citation ?? idx}`;
  return {
    id,
    kind: 'source',
    seq: 0,
    phase: 1,
    fields: {
      url: (src as any).url ?? '',
      title: (src as any).title ?? null,
      domain: (src as any).domain ?? '',
      credibilityType: (src as any).credibilityType ?? null,
      credibilityScore: (src as any).credibilityScore ?? null,
      snippet: (src as any).snippet ?? '',
      citationIndex: citation ?? idx,
    },
    canvasX: null,
    canvasY: null,
    pinned: false,
    deskState: 'unfiled',
    deskCategory: null,
  };
}

/** Map an SSE artefact event's `data` into a DeskCard. */
export function eventToCard(data: Record<string, unknown>): DeskCard {
  const { seq, artefactType, id, phase, ...fields } = data as any;
  return {
    id: String(id),
    kind: artefactType as CardKind,
    seq: Number(seq) || 0,
    phase: phaseToNum(phase),
    fields,
    canvasX: null,
    canvasY: null,
    pinned: false,
    deskState: 'unfiled',
    deskCategory: null,
  };
}

// ——— the rune store factory ———

export interface DeskLog {
  message: string;
  timestamp: number;
}

export interface DeskStore {
  cards: ReadonlyArray<DeskCard>;
  edges: ReadonlyArray<DeskEdge>;
  clusters: ReadonlyArray<SynthesisCluster>;
  synthesisToken: string;
  /** SSE stream connection status — NOT the session status */
  status: 'idle' | 'hydrating' | 'live' | 'error';
  /** Session status from the worker (phase1/phase2/phase3/post_processing/complete/failed/draft) */
  sessionStatus: string;
  /** Activity log entries from the stream */
  logs: ReadonlyArray<DeskLog>;
  /** Live synthesis run status (drives the ModeToggle pulse + headers/edges). */
  synthStatus: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
  /** Categories discovered this run (id/title/summary) — column headers. */
  synthCategories: ReadonlyArray<SynthCategory>;
  /** Header→fact connector edges drawn in SYNTHESIZE. */
  synthEdges: ReadonlyArray<SynthEdge>;
  /** Streamed executive-summary text for the current run. */
  synthSummary: string;
  /** Fact count the current run is scoped over. */
  synthFactCount: number;
  start(): Promise<void>;
  applyLocalPosition(id: string, x: number, y: number, pinned?: boolean): void;
  /** Merge an arbitrary partial into an existing card (wholesale $state.raw
   *  replace). Used by the synthesis consumer to file + categorise cards live;
   *  the server persists the same desk_state, so a later stream delta that
   *  re-overwrites is self-healed on reload from /data. No-op if id unknown. */
  patchCard(id: string, patch: Partial<DeskCard>): void;
  dispose(): void;
}

const STREAM_FLUSH_MS = 5;

export function createDeskStore(
  sessionId: string,
  opts: DeskStoreOptions = {},
): DeskStore {
  const deskMode = opts.mode ?? 'deep';
  const quickInitial = opts.quickInitial;
  // $state.raw — whole-container replacement keeps derived recompute bounded.
  let cardMap = $state.raw(new Map<string, DeskCard>());
  let edgeMap = $state.raw(new Map<string, DeskEdge>());
  let clusterList = $state.raw<SynthesisCluster[]>([]);
  let synthesisTokenBuf = $state('');
  let status = $state<'idle' | 'hydrating' | 'live' | 'error'>('idle');
  let sessionStatus = $state('draft');
  let logList = $state.raw<DeskLog[]>([]);
  // Synthesis reducer state — folds synthesis.* events into categories,
  // header→fact edges and card patches (file + categorise).
  let synth = $state.raw<SynthesisState>(initSynthesisState());

  // Plain (non-$state) handles — read inside SSE callback / flush.
  let es: EventSource | null = null;
  let flushHandle: ReturnType<typeof setTimeout> | null = null;
  const pendingCards = new Map<string, DeskCard>(); // staged deltas
  const pendingEdges = new Map<string, DeskEdge>();

  function scheduleFlush() {
    if (flushHandle === null) flushHandle = setTimeout(flush, STREAM_FLUSH_MS);
  }

  function flush() {
    flushHandle = null;
    if (pendingCards.size > 0) {
      let next = cardMap;
      for (const c of pendingCards.values()) next = mergeArtefact(next, c);
      pendingCards.clear();
      cardMap = next;
    }
    if (pendingEdges.size > 0) {
      const next = new Map(edgeMap);
      for (const e of pendingEdges.values()) next.set(e.id, e);
      pendingEdges.clear();
      edgeMap = next;
    }
  }

  /** Feed one synthesis.* event through the reducer and apply only the newly
   *  produced card patches (file + categorise) to the card map. The reducer
   *  accumulates, so we diff against the prior length. */
  function applySynth(ev: SynthesisEvent) {
    const prev = synth;
    const next = applySynthesisEvent(prev, ev);
    if (next === prev) return; // late/stale event — no change
    // Apply the patches produced since the previous state.
    if (next.cardPatches.length > prev.cardPatches.length) {
      let cm = cardMap;
      for (let i = prev.cardPatches.length; i < next.cardPatches.length; i++) {
        const cp = next.cardPatches[i];
        const existing = cm.get(cp.id);
        if (!existing) continue;
        if (cm === cardMap) cm = new Map(cardMap); // copy-on-first-write
        cm.set(cp.id, { ...existing, ...cp.patch });
      }
      if (cm !== cardMap) cardMap = cm;
    }
    synth = next;
  }

  async function hydrate() {
    status = 'hydrating';
    const res = await fetch(`/api/deepdive/${sessionId}/data`);
    if (!res.ok) {
      status = 'error';
      return;
    }
    const body = await res.json();
    const seeded = new Map<string, DeskCard>();
    for (const s of body.sources ?? []) seeded.set(String(s.id), rowToCard('source', s));
    for (const f of body.facts ?? []) seeded.set(String(f.id), rowToCard('fact', f));
    for (const e of body.entities ?? []) seeded.set(String(e.id), rowToCard('entity', e));
    cardMap = seeded;
    const edges = new Map<string, DeskEdge>();
    for (const r of body.relationships ?? []) {
      edges.set(String(r.id), {
        id: String(r.id),
        fromEntityId: String(r.fromEntityId),
        toEntityId: String(r.toEntityId),
        relationshipType: r.relationshipType ?? null,
        sentiment: r.sentiment ?? null,
      });
    }
    edgeMap = edges;
  }

  function subscribe() {
    es = new EventSource(`/api/deepdive/${sessionId}/stream`);
    es.onmessage = (msg) => {
      let evt: any;
      try {
        evt = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (evt.type === 'artefact' && evt.data) {
        if (evt.data.artefactType === 'relationship') {
          const d = evt.data;
          pendingEdges.set(String(d.id), {
            id: String(d.id),
            fromEntityId: String(d.fromEntityId),
            toEntityId: String(d.toEntityId),
            relationshipType: d.relationshipType ?? null,
            sentiment: d.sentiment ?? null,
          });
        } else {
          const c = eventToCard(evt.data);
          // Stage with dedup-by-id; a later delta for the same id overwrites the staged one.
          pendingCards.set(c.id, c);
        }
        scheduleFlush();
      } else if (evt.type === 'synthesis' && evt.data) {
        const d = evt.data;
        // Legacy buffers (kept for clusters / synthesisToken getters).
        if (d.stage === 'progress' && typeof d.token === 'string') {
          synthesisTokenBuf = synthesisTokenBuf + d.token;
        } else if (d.stage === 'cluster' && d.cluster) {
          clusterList = [...clusterList, d.cluster as SynthesisCluster];
        } else if (d.stage === 'done') {
          if (Array.isArray(d.clusters)) clusterList = d.clusters as SynthesisCluster[];
        } else if (d.stage === 'started') {
          synthesisTokenBuf = '';
        }
        applySynth(d as SynthesisEvent);
      } else if (evt.type === 'error' && evt.data?.stage) {
        // synthesis failure / cancellation surfaces as an error envelope whose
        // data carries the run stage ('failed' | 'cancelled').
        const stage = String(evt.data.stage);
        if (stage === 'failed' || stage === 'cancelled') {
          synth = { ...synth, status: stage };
        }
      } else if (evt.type === 'status' && evt.data?.status) {
        sessionStatus = String(evt.data.status);
      } else if (evt.type === 'log') {
        // emitLog formats as `${icon}  ${message}` in the top-level `message` field;
        // timestamp is in `data.timestamp`.
        const msg = (evt as any).message ?? evt.data?.message ?? '';
        const ts = Number((evt as any).data?.timestamp ?? Date.now());
        logList = [...logList.slice(-199), { message: String(msg), timestamp: ts }];
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; on reconnect the next hydrate-on-mount or
      // replayed deltas re-dedup by id. Leave status 'live'.
    };
  }

  // ——— quick-answer variant: seed from quickInitial, stream from
  //     /quickanswer/[id]/stream (token/sources/status/complete/error). ———
  function quickHydrate() {
    status = 'hydrating';
    const seeded = new Map<string, DeskCard>();
    const srcs = quickInitial?.sources ?? [];
    for (let i = 0; i < srcs.length; i++) {
      const c = quickSourceToCard(srcs[i], i);
      seeded.set(c.id, c);
    }
    cardMap = seeded;
    edgeMap = new Map();
    if (quickInitial?.answer) synthesisTokenBuf = quickInitial.answer;
    if (quickInitial?.status) sessionStatus = quickInitial.status;
  }

  function quickSubscribe() {
    es = new EventSource(`/quickanswer/${sessionId}/stream`);
    es.onmessage = (msg) => {
      let evt: any;
      try {
        evt = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (evt.type === 'token' && evt.data?.token) {
        synthesisTokenBuf = synthesisTokenBuf + String(evt.data.token);
      } else if (evt.type === 'sources' && Array.isArray(evt.data?.sources)) {
        const srcs = evt.data.sources as Array<Record<string, unknown>>;
        let next = cardMap;
        for (let i = 0; i < srcs.length; i++) {
          const c = quickSourceToCard(srcs[i], i);
          next = mergeArtefact(next, c);
        }
        cardMap = next;
      } else if (evt.type === 'status' && evt.data?.status) {
        sessionStatus = String(evt.data.status);
      } else if (evt.type === 'complete') {
        sessionStatus = 'complete';
        es?.close();
      } else if (evt.type === 'error') {
        sessionStatus = 'failed';
      } else if (evt.type === 'log') {
        const m = (evt as any).message ?? '';
        logList = [...logList.slice(-199), { message: String(m), timestamp: Date.now() }];
      }
    };
    es.onerror = () => {
      // auto-reconnect; deltas re-dedup by synthetic source id.
    };
  }

  return {
    get cards() {
      return Array.from(cardMap.values());
    },
    get edges() {
      return Array.from(edgeMap.values());
    },
    get clusters() {
      return clusterList;
    },
    get synthesisToken() {
      return synthesisTokenBuf;
    },
    get sessionStatus() {
      return sessionStatus;
    },
    get logs() {
      return logList;
    },
    get synthStatus() {
      return synth.status;
    },
    get synthCategories() {
      return synth.categories;
    },
    get synthEdges() {
      return synth.newEdges;
    },
    get synthSummary() {
      return synth.streamedText || (synth.summary ?? '');
    },
    get synthFactCount() {
      return synth.factCount;
    },
    get status() {
      return status;
    },
    async start() {
      if (deskMode === 'quick') {
        quickHydrate();
        // Only open the live stream while the quick answer is still running;
        // a finished answer is fully seeded from quickInitial.
        const liveStatuses = ['pending', 'searching', 'synthesising'];
        if (liveStatuses.includes(sessionStatus)) quickSubscribe();
        status = 'live';
        return;
      }
      await hydrate();
      if (status === 'error') return; // don't clobber a failed hydrate with 'live'
      subscribe();
      status = 'live';
    },
    applyLocalPosition(id, x, y, pinned) {
      const existing = cardMap.get(id);
      if (!existing) return;
      const next = new Map(cardMap);
      next.set(id, { ...existing, canvasX: x, canvasY: y, pinned: pinned ?? existing.pinned });
      cardMap = next;
    },
    patchCard(id, patch) {
      const existing = cardMap.get(id);
      if (!existing) return;
      const next = new Map(cardMap);
      next.set(id, { ...existing, ...patch });
      cardMap = next;
    },
    dispose() {
      es?.close();
      es = null;
      if (flushHandle !== null) {
        clearTimeout(flushHandle);
        flushHandle = null;
      }
    },
  };
}
