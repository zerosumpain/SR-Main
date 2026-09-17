/**
 * One model of the estate, assembled from feeds, projected into many views.
 *
 * This replaces `$lib/architecture/topology.ts`, which was 107 hand-written
 * lines describing 16 nodes. By 2026-09 the VPS ran 30 containers and seven
 * repositories, and the file knew about none of the extracted ones. It had no
 * way to be wrong out loud: nothing compared it to anything, so it simply aged.
 *
 * The rule here is that every node says where it came from and whether that
 * source can go stale without anyone noticing:
 *
 *  - `generated` — regenerated from something that changes when the estate
 *    changes: the build-time route manifest, the vendored SR-Infra registry, the
 *    Drizzle schema, a live container probe. A generated node cannot rot,
 *    because nothing hand-maintains it.
 *  - `declared` — hand-written, because scraping it produced a dangerous lie or
 *    there is nothing to scrape. Every declared feed MUST have a drift test that
 *    fails when reality moves, in the shape `estate.test.ts` already uses
 *    against `hooks.server.ts`. A declared node with no guard is exactly
 *    topology.ts again.
 *  - `observed` — a live measurement. True when taken, and stamped, so a stale
 *    reading is visible as stale rather than as fact.
 *
 * And where a declared claim and an observed or generated one disagree, that
 * disagreement is CONTENT. `EXTRACTED_TRIGGERS` listing one trigger while the
 * registry declares two is a real question about whether a worker is live — not
 * a bug in the model to be smoothed over by trusting one side.
 */

export type Provenance = 'generated' | 'declared' | 'observed';

export type Layer =
  | 'edge' // DNS, tunnel, ingress ordering
  | 'app' // an application: a repo, a deploy target, a set of URLs
  | 'repo' // a git repository
  | 'container' // a running process on a host
  | 'host' // a machine
  | 'route' // a page or an API path this codebase serves
  | 'table' // a database relation
  | 'activity' // a recurring or triggered thing the system does on its own
  | 'external'; // a third party we depend on

export type EdgeKind =
  | 'routes' // edge → app: cloudflared sends these paths there
  | 'runs' // host/container → app
  | 'builds' // repo → app
  | 'serves' // app → route
  | 'reads' // activity → table
  | 'writes' // activity → repo or table
  | 'owns-worker' // app → activity, via a queue trigger its worker claims
  | 'calls' // route → route, from a URL literal in the source
  | 'depends'; // anything → external

export interface EstateNode {
  /** `<layer>:<key>` — stable, and the join key for every edge. */
  id: string;
  layer: Layer;
  label: string;
  provenance: Provenance;
  /** Which feed produced it, for the freshness ledger. */
  feed: string;
  /** Free-form, rendered as the node's detail rows. */
  facts?: Record<string, string | number | boolean | null>;
  /** A URL this node is reachable at, when it has one. */
  url?: string;
  /** Set when a node is present but not serving — e.g. staged, never promoted. */
  warning?: string;
}

export interface EstateEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  provenance: Provenance;
  feed: string;
}

/**
 * A place the model knows it cannot see, or where two sources disagree.
 *
 * Rendering these is the whole point. A map that draws only what it is sure of
 * reads as complete, and the previous one read as complete for months while
 * missing 24 of 30 containers.
 */
export interface EstateFinding {
  kind: 'mismatch' | 'gap' | 'stale';
  title: string;
  detail: string;
  /** Node ids the finding is about, so the view can anchor it. */
  nodes?: string[];
  severity: 'high' | 'medium' | 'low';
}

export interface FeedStamp {
  feed: string;
  provenance: Provenance;
  /** What this feed describes, one line. */
  describes: string;
  /** How it refreshes — 'every build', 'live probe', 'vendored + gate', … */
  refresh: string;
  /** null when the feed could not run; the view must say so rather than showing zero. */
  count: number | null;
  error?: string;
  /** ISO date the underlying source was last known good, where that is knowable. */
  asOf?: string;
}

export interface EstateModel {
  nodes: EstateNode[];
  edges: EstateEdge[];
  findings: EstateFinding[];
  /** One row per feed. This is the page's honesty: it says what it could not read. */
  ledger: FeedStamp[];
  builtAt: string;
}

export function nodeId(layer: Layer, key: string): string {
  return `${layer}:${key}`;
}
