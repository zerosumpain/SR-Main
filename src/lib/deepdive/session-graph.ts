/**
 * A research session's entity network, expressed in the shape the Intel graph
 * already speaks.
 *
 * The dashboard had its own force layout — a second, thinner implementation of
 * something this codebase already does properly. Intel's graph sizes by
 * PageRank, colours by detected community, draws cross-community edges in
 * accent, labels only what matters and supports selection; the research one
 * sized by raw degree, coloured by a single ramp and did nothing on click.
 *
 * Rather than port those features across, this module translates a session's
 * `entity` and `relationship` rows into the `GraphSnapshot` that
 * `$lib/jkai/intel/analytics` operates on. Everything downstream — `buildIndex`,
 * `pagerank`, `detectCommunities`, `brokerageScore`, and `NetworkGraph.svelte`
 * itself — is then reused verbatim, which is the point: one graph
 * implementation, two sets of data.
 *
 * The translation has to invent a few fields the intel model carries and a
 * research session has no equivalent for (staleness, confirmation, note counts).
 * Those are filled with honest constants and documented below rather than
 * guessed at — a research entity is as current as the run that produced it, so
 * `recency` and `relevance` are 1 and the renderers' fade never fires.
 */
import type { GraphNode, GraphEdge, GraphSnapshot } from '$lib/jkai/intel/analytics/model';

export interface SessionEntityRow {
  id: string;
  name: string;
  type: string;
  description?: string | null;
}

export interface SessionRelationshipRow {
  id: string;
  fromEntityId: string | null;
  toEntityId: string | null;
  relationshipType: string;
  strength: number | null;
  sentiment?: string | null;
}

/**
 * A glyph per research entity type.
 *
 * The 2D renderer shows the icon in its tooltip and carries type in the label;
 * colour comes from the detected community, not the type. So this is a legend
 * aid, not a colour scheme — which is deliberate, and the same conclusion the
 * intel graph reached ("type-coloured nodes told you nothing you couldn't read
 * from the label").
 */
export const ENTITY_TYPE_ICONS: Record<string, string> = {
  person: '◉',
  organisation: '▣',
  organization: '▣',
  location: '⌖',
  event: '◈',
  product: '⬡',
  concept: '○',
  other: '·',
};

export function iconForType(type: string): string {
  return ENTITY_TYPE_ICONS[type?.toLowerCase()] ?? ENTITY_TYPE_ICONS.other;
}

/**
 * Edge weight from the extractor's `strength`.
 *
 * Intel derives weight from observation count and confidence; a research
 * relationship is asserted once, with a strength the extraction model set. That
 * number IS the weight — mapping it through intel's `weightFor` would be
 * inventing a second definition of a value that already exists.
 */
function bucketFor(weight: number): string {
  if (weight >= 0.75) return 'strong';
  if (weight >= 0.45) return 'medium';
  return 'weak';
}

export interface BuildSnapshotOptions {
  /** `report.entity_centrality`, keyed by entity id. Used only for trimming. */
  centrality?: Record<string, number>;
  /**
   * Cap on nodes drawn. A finished investigation averages 253 entities and 151
   * relationships; past a couple of hundred a force layout is a hairball that
   * answers no question. Trimming keeps the best-connected.
   */
  maxNodes?: number;
  /** Fixed clock, so two nodes of identical age cannot get different values. */
  now?: number;
}

export interface SessionSnapshot extends GraphSnapshot {
  /** Entities in the session before any trimming. */
  totalNodes: number;
  /** Relationships in the session before any trimming. */
  totalEdges: number;
  trimmed: boolean;
}

/**
 * Turn session rows into an intel-shaped snapshot.
 *
 * Self-loops and edges with a missing end are dropped: the extractor
 * occasionally emits a relationship whose target never made it to the entity
 * table, and `buildIndex` would silently discard it later anyway — doing it here
 * keeps the reported edge total honest.
 */
export function buildSessionSnapshot(
  entityRows: SessionEntityRow[],
  relationshipRows: SessionRelationshipRow[],
  opts: BuildSnapshotOptions = {},
): SessionSnapshot {
  const { centrality = {}, maxNodes = 220, now = 0 } = opts;

  const known = new Set(entityRows.map((e) => e.id));
  const usable = relationshipRows.filter(
    (r) =>
      r.fromEntityId &&
      r.toEntityId &&
      r.fromEntityId !== r.toEntityId &&
      known.has(r.fromEntityId) &&
      known.has(r.toEntityId),
  );

  const degree = new Map<string, number>();
  for (const r of usable) {
    degree.set(r.fromEntityId!, (degree.get(r.fromEntityId!) ?? 0) + 1);
    degree.set(r.toEntityId!, (degree.get(r.toEntityId!) ?? 0) + 1);
  }

  // Best-connected first, centrality breaking ties. An isolated entity carries
  // no structure, so it is the first thing to go when trimming.
  const ordered = [...entityRows].sort(
    (a, b) =>
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      (centrality[b.id] ?? 0) - (centrality[a.id] ?? 0) ||
      a.name.localeCompare(b.name),
  );
  const trimmed = ordered.length > maxNodes;
  const keep = new Set(ordered.slice(0, maxNodes).map((e) => e.id));

  const nodes: GraphNode[] = ordered
    .filter((e) => keep.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      typeId: e.type,
      typeName: e.type,
      icon: iconForType(e.type),
      color: 'var(--accent)',
      summary: e.description ?? null,
      // A research entity has no confidence column and no confirmation
      // workflow. It exists because this run's extractor asserted it, so it is
      // treated as asserted-and-current rather than given a fabricated score.
      confidenceScore: null,
      confidence: 'medium',
      confirmed: false,
      createdAt: now,
      updatedAt: now,
      noteCount: degree.get(e.id) ?? 0,
      lastSeenAt: now,
      evidenceAt: now,
      aliases: [],
      categories: [],
      sources: ['research'],
    }));

  const edges: GraphEdge[] = usable
    .filter((r) => keep.has(r.fromEntityId!) && keep.has(r.toEntityId!))
    .map((r) => {
      const weight = Math.max(0, Math.min(1, r.strength ?? 0.5));
      return {
        id: r.id,
        source: r.fromEntityId!,
        target: r.toEntityId!,
        type: r.relationshipType,
        label: r.relationshipType?.replace(/_/g, ' ') ?? null,
        confidence: 'medium',
        strength: bucketFor(weight),
        createdAt: now,
        weight,
        lastSeenAt: now,
        sourceKind: 'research',
      };
    });

  return {
    nodes,
    edges,
    totalNodes: entityRows.length,
    totalEdges: usable.length,
    trimmed,
  };
}
