// Client-side cache for entity cards and the chat mention index.
//
// Hovering entity mentions in a chat produces a burst of repeat requests for
// the same handful of entities, so cards are memoised for the page's lifetime
// and concurrent requests for one id share a single fetch. The mention index is
// fetched once and reused by every message on the page.

export interface EntityCardData {
  entity: {
    id: string;
    name: string;
    summary: string | null;
    properties: Record<string, unknown>;
    confidence: string;
    confirmed: boolean;
    /** On the watchlist. Carried on the card so the star draws without a second
     *  request, and so the mail gate's foreground — the thing its topical admit
     *  rule keys on — is reachable from the graph, not only from
     *  /jkai/intel/entities. */
    watched: boolean;
    type: { id: string; name: string; icon: string; color: string };
    createdAt: string;
    updatedAt: string;
    /** 0..1. The numeric confidence every other surface reads; see staleness.ts. */
    confidenceScore: number | null;
  };
  metrics: {
    degree: number;
    importance: number;
    betweenness: number;
    brokerage: number;
    community: number | null;
    noteCount: number;
    /** When this entity was last OBSERVED (not when its row was written), ISO. */
    evidenceAt: string | null;
    relevance: { score: number; confidence: number; freshness: number; ageDays: number | null };
  };
  neighbours: Array<{
    id: string;
    name: string;
    type: string;
    icon: string;
    color: string;
    degree: number;
    relationship: string;
    crossCommunity: boolean;
  }>;
  notes: Array<{
    id: string;
    title: string;
    source: string;
    createdAt: string;
    relevance: string | null;
    excerpt: string | null;
    /** When the note's subject matter happened; null when nothing dated it. */
    observedAt: string | null;
    href: string;
    /** True for the note this entity was first extracted from. */
    firstSeen?: boolean;
  }>;
  /** Evidence per month across ALL sources, for the volume sparkline. */
  histogram: Array<{ month: string; count: number }>;
  timeline: Array<{
    id: string;
    date: string;
    dateEnd: string | null;
    type: string;
    title: string;
    description: string | null;
  }>;
}

export interface MentionTarget {
  id: string;
  name: string;
  typeName: string;
  aliases: string[];
}

const cards = new Map<string, Promise<EntityCardData>>();

export function fetchEntityCard(id: string): Promise<EntityCardData> {
  const hit = cards.get(id);
  if (hit) return hit;

  const req = fetch(`/api/jkai/intel/entity-card?id=${encodeURIComponent(id)}`)
    .then((res) => {
      if (!res.ok) throw new Error(`entity card ${res.status}`);
      return res.json() as Promise<EntityCardData>;
    })
    .catch((err) => {
      // A failed fetch must not poison the cache — the next hover retries.
      cards.delete(id);
      throw err;
    });

  cards.set(id, req);
  return req;
}

/**
 * Forget one entity's cached card.
 *
 * The cache holds a PROMISE per id and never expires, so a card whose data
 * changed under it — starring it, say — would keep rendering the old answer
 * until a full reload. Dropping the one entry is enough; the next open refetches.
 */
export function invalidateEntityCard(id: string): void {
  cards.delete(id);
}

let mentionsPromise: Promise<MentionTarget[]> | null = null;

/**
 * The entity name index.
 *
 * Memoised, because a long thread asks for it once per message render. Pass
 * `{ refresh: true }` after extraction lands: the index is what turns a name in
 * a reply into a hoverable reference, so a stale one means an already-rendered
 * reply never gains its links — which used to need a full page reload to fix.
 * A refresh also drops the per-entity card cache, since an entity that just
 * gained neighbours would otherwise serve its pre-extraction card.
 */
export function fetchMentionIndex(opts?: { refresh?: boolean }): Promise<MentionTarget[]> {
  if (opts?.refresh) {
    mentionsPromise = null;
    cards.clear();
  }
  if (mentionsPromise) return mentionsPromise;
  mentionsPromise = fetch('/api/jkai/intel/entity-card?mentions=1')
    .then((res) => {
      if (!res.ok) throw new Error(`mentions ${res.status}`);
      return res.json() as Promise<{ mentions: MentionTarget[] }>;
    })
    .then((body) => body.mentions ?? [])
    .catch(() => {
      // Chat must keep working with no intel graph at all.
      mentionsPromise = null;
      return [];
    });
  return mentionsPromise;
}

/** Commission work from a card or insight. Returns where to go next. */
export async function commission(
  kind: string,
  payload: string,
  entityIds: string[] = [],
): Promise<{ kind: string; url: string; id?: string; label: string; started: boolean }> {
  const res = await fetch('/api/jkai/intel/commission', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, payload, entityIds }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => 'commission failed'));
  return res.json();
}
