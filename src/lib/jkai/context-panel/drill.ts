// Drill targets — what a double-click on the thread inspector opens.
//
// PURE. The keys are opaque strings the card composer attaches to tiles and
// rows (`entity:<uuid>`, `research-run:<id>`, `thoughts:new`…). The client
// never interprets them beyond "is there one"; the server parses them here
// and resolves them in `drill.server.ts`. Keeping the grammar in one tested
// place is what lets a row in the rail, a row inside a manifest and a
// section in the Memory mode all point at the same drill.

export type DrillTarget =
  | { kind: 'entities'; filter: 'all' | 'known' | 'new' }
  | { kind: 'relations' }
  | { kind: 'entity'; id: string }
  | { kind: 'research-desk'; filter: 'all' | 'active' | 'complete' }
  | { kind: 'research-run'; id: string }
  | { kind: 'thoughts'; filter: 'all' | 'new' | 'reviewed' }
  | { kind: 'thought'; id: string }
  | { kind: 'places'; filter: 'all' | 'named' }
  | { kind: 'place'; id: string }
  | { kind: 'memories'; filter: 'served' | 'relevant' | 'thread' | 'changed' }
  | { kind: 'memory'; id: string }
  /** The generic drill: a card, or one metric on it, under a given lens. */
  | { kind: 'card'; lens: string; cardId: string; metric: string | null };

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** Parse a key. Null for anything malformed — the API answers 400. */
export function parseDrillTarget(key: string): DrillTarget | null {
  const parts = key.split(':');
  const head = parts[0];
  const rest = parts.slice(1);
  switch (head) {
    case 'entities': {
      const f = rest[0] ?? 'all';
      return f === 'all' || f === 'known' || f === 'new' ? { kind: 'entities', filter: f } : null;
    }
    case 'relations':
      return rest.length === 0 ? { kind: 'relations' } : null;
    case 'entity':
      return rest.length === 1 && ID.test(rest[0]) ? { kind: 'entity', id: rest[0] } : null;
    case 'research-desk': {
      const f = rest[0] ?? 'all';
      return f === 'all' || f === 'active' || f === 'complete' ? { kind: 'research-desk', filter: f } : null;
    }
    case 'research-run':
      return rest.length === 1 && ID.test(rest[0]) ? { kind: 'research-run', id: rest[0] } : null;
    case 'thoughts': {
      const f = rest[0] ?? 'all';
      return f === 'all' || f === 'new' || f === 'reviewed' ? { kind: 'thoughts', filter: f } : null;
    }
    case 'thought':
      return rest.length === 1 && ID.test(rest[0]) ? { kind: 'thought', id: rest[0] } : null;
    case 'places': {
      const f = rest[0] ?? 'all';
      return f === 'all' || f === 'named' ? { kind: 'places', filter: f } : null;
    }
    case 'place':
      return rest.length === 1 && ID.test(rest[0]) ? { kind: 'place', id: rest[0] } : null;
    case 'memories': {
      const f = rest[0];
      return f === 'served' || f === 'relevant' || f === 'thread' || f === 'changed'
        ? { kind: 'memories', filter: f }
        : null;
    }
    case 'memory':
      return rest.length === 1 && ID.test(rest[0]) ? { kind: 'memory', id: rest[0] } : null;
    case 'card': {
      // card:<lens>:<cardId>[:<metric label, URI-encoded>]
      if (rest.length < 2 || rest.length > 3) return null;
      const [lens, cardId, metric] = rest;
      if (!ID.test(lens) || !ID.test(cardId)) return null;
      let label: string | null = null;
      if (metric !== undefined) {
        try {
          label = decodeURIComponent(metric);
        } catch {
          return null;
        }
        if (!label) return null;
      }
      return { kind: 'card', lens, cardId, metric: label };
    }
    default:
      return null;
  }
}

/** The inverse — used by composers so a key is never hand-assembled. */
export function drillKey(target: DrillTarget): string {
  switch (target.kind) {
    case 'entities':
      return target.filter === 'all' ? 'entities' : `entities:${target.filter}`;
    case 'relations':
      return 'relations';
    case 'entity':
      return `entity:${target.id}`;
    case 'research-desk':
      return target.filter === 'all' ? 'research-desk' : `research-desk:${target.filter}`;
    case 'research-run':
      return `research-run:${target.id}`;
    case 'thoughts':
      return target.filter === 'all' ? 'thoughts' : `thoughts:${target.filter}`;
    case 'thought':
      return `thought:${target.id}`;
    case 'places':
      return target.filter === 'all' ? 'places' : `places:${target.filter}`;
    case 'place':
      return `place:${target.id}`;
    case 'memories':
      return `memories:${target.filter}`;
    case 'memory':
      return `memory:${target.id}`;
    case 'card':
      return target.metric === null
        ? `card:${target.lens}:${target.cardId}`
        : `card:${target.lens}:${target.cardId}:${encodeURIComponent(target.metric)}`;
  }
}

/** Graph node ids are `entity:<uuid>` for concepts; the drill key is the same
 *  string, so a topics row can carry the node id straight through. */
export function entityDrillKey(nodeId: string): string | null {
  return nodeId.startsWith('entity:') && nodeId.length > 'entity:'.length ? nodeId : null;
}

/** A short "3m ago / 2d ago / 12 Aug" for event rows. Deterministic given `now`. */
export function relativeStamp(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
