// src/lib/canvas/intelligence/desk/store.svelte.ts
//
// Hydrate-then-stream desk store. On mount: GET /api/deepdive/[id]/data to
// seed existing artefacts, THEN subscribe to /api/deepdive/[id]/stream for
// deltas. Cards are deduped by id; out-of-order deltas (lower seq) are dropped.
// Collections are $state.raw and replaced wholesale on a ~5ms debounced flush.

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

export interface DeskStore {
  cards: ReadonlyArray<DeskCard>;
  edges: ReadonlyArray<DeskEdge>;
  clusters: ReadonlyArray<SynthesisCluster>;
  synthesisToken: string;
  status: 'idle' | 'hydrating' | 'live' | 'error';
  start(): Promise<void>;
  applyLocalPosition(id: string, x: number, y: number, pinned?: boolean): void;
  dispose(): void;
}

const STREAM_FLUSH_MS = 5;

export function createDeskStore(sessionId: string): DeskStore {
  // $state.raw — whole-container replacement keeps derived recompute bounded.
  let cardMap = $state.raw(new Map<string, DeskCard>());
  let edgeMap = $state.raw(new Map<string, DeskEdge>());
  let clusterList = $state.raw<SynthesisCluster[]>([]);
  let synthesisTokenBuf = $state('');
  let status = $state<'idle' | 'hydrating' | 'live' | 'error'>('idle');

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
        if (d.stage === 'progress' && typeof d.token === 'string') {
          synthesisTokenBuf = synthesisTokenBuf + d.token;
        } else if (d.stage === 'cluster' && d.cluster) {
          clusterList = [...clusterList, d.cluster as SynthesisCluster];
        } else if (d.stage === 'done') {
          if (Array.isArray(d.clusters)) clusterList = d.clusters as SynthesisCluster[];
        } else if (d.stage === 'started') {
          synthesisTokenBuf = '';
        }
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; on reconnect the next hydrate-on-mount or
      // replayed deltas re-dedup by id. Leave status 'live'.
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
    get status() {
      return status;
    },
    async start() {
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
