/**
 * Codegraph → the Intel network payload.
 *
 * The 2D `NetworkGraph.svelte` and 3D `NetworkGraph3D.svelte` are the shipped
 * presentation library for graphs on this site, and they speak `NetNode` /
 * `NetEdge`. Those types read as intel-specific because that is where they grew
 * up, but the fields are generic — id, name, type, importance, community,
 * recency — so the right move is an ADAPTER, not a fork.
 *
 * The first cut of /jkai/codegraph hand-rolled its own SVG force layout on the
 * grounds that the intel component was "bound to intel's types". That was
 * wrong twice over: it duplicated physics that already existed and had been
 * debugged (see the 3D component's four library traps), and it shipped a map
 * with no 3D view, no cluster shells, no zoom, no path highlighting and none of
 * the encodings the rest of the site uses. Two graph idioms is one too many.
 *
 * WHAT `community` MEANS HERE
 *
 * In intel, community is a Louvain result — a fact about the graph. In a code
 * graph the interesting groupings are not emergent, they are the ones you
 * already think in: which directory, which layer, which gate keeps failing,
 * whether the work stuck. So `community` is a *chosen* slicing, and `groupBy`
 * chooses it. That is the whole reason this file exists rather than a shared
 * clustering helper: the question "how should this be grouped" has a different
 * answer for code than it does for people.
 */
import type { NetNode, NetEdge, NetworkPayload } from '$lib/codegraph/types';

/** How `community` is assigned — i.e. what the colours mean. */
export type GroupBy = 'directory' | 'layer' | 'gate' | 'verdict' | 'activity';

export const GROUP_BY: Array<{ id: GroupBy; label: string; question: string }> = [
  { id: 'directory', label: 'Directory', question: 'Which part of the tree does this live in?' },
  { id: 'layer', label: 'Layer', question: 'Routes, lib, scripts, tests — what kind of code is it?' },
  { id: 'gate', label: 'Gate', question: 'Which gate has failed most often on this file?' },
  { id: 'verdict', label: 'Outcome', question: 'Did the work on this file stick, or get repaired?' },
  { id: 'activity', label: 'Activity', question: 'How much recorded history does it carry?' },
];

export interface NodeRow {
  id: string;
  canonicalPath: string;
  kind: string;
  displayName: string | null;
  summary: string | null;
  episodeCount: number;
  lessonCount: number;
  existsOnHead: boolean;
  lastSeenAt: Date | null;
  /** Dominant gate across this file's episodes, if any. */
  gate?: string | null;
  /** Worst verdict across this file's episodes (repaired beats verified). */
  verdict?: string | null;
  /** Distinct fingerprints seen on this file. */
  fingerprints?: string[];
  /** True when every lesson naming this file is stale. */
  stale?: boolean;
}

export interface EdgeRow {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  weight: number;
  lastSeenAt: Date | null;
}

export interface NetworkFilters {
  groupBy: GroupBy;
  /** Substring match over path — the literal hits become `matched`. */
  q?: string;
  /** Only these edge kinds are drawn. Empty means all. */
  edgeKinds?: string[];
  /** Only files carrying at least this much history. */
  minHistory?: number;
  /** Only gates in this list (empty = all). */
  gates?: string[];
  /** Only verdicts in this list (empty = all). */
  verdicts?: string[];
  /** 'all' | 'live' | 'deleted' — files present at git HEAD. */
  liveness?: 'all' | 'live' | 'deleted';
  /** Drop files with no episodes AND no lessons — the silent majority. */
  onlyWithHistory?: boolean;
  /** Hard cap on drawn nodes. */
  limit?: number;
}

/** A file with no recorded history is a dot with nothing to say; past this many
 *  the layout is a hairball and the question stops being answerable. Matches the
 *  intel graph's own trim. */
export const MAX_NODES = 600;

const LAYERS: Array<[RegExp, string]> = [
  [/^src\/routes\/api\//, 'API routes'],
  [/^src\/routes\//, 'Pages'],
  [/^src\/lib\/components\//, 'Components'],
  [/^src\/lib\/workflows\//, 'Workflows'],
  [/^src\/lib\//, 'Library'],
  [/^scripts\//, 'Scripts'],
  [/^packages\//, 'Packages'],
  [/^(tests|.*\.test\.[tj]s)/, 'Tests'],
  [/^docs\//, 'Docs'],
  [/^\.github\//, 'CI'],
  [/^static\//, 'Static'],
];

export function layerOf(path: string): string {
  // Gate nodes are not code and have no path. Without this they fall through to
  // 'Other' and, in the directory view, to '(root)' — filed alongside the repo's
  // top-level files, which reads as a bug in the map rather than a node kind.
  if (path.startsWith('gate:')) return 'Gates';
  if (/\.(test|spec)\.[tj]sx?$/.test(path)) return 'Tests';
  for (const [re, name] of LAYERS) if (re.test(path)) return name;
  return 'Other';
}

/** The directory a file is filed under — two segments deep, which is where this
 *  repo's meaning lives (`src/lib/jkai` says something; `src` does not). */
export function directoryOf(path: string): string {
  if (path.startsWith('gate:')) return 'Gates';
  const parts = path.split('/');
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, Math.min(3, parts.length - 1)).join('/');
}

/** History carried, used for size and for the activity banding. */
export function historyOf(n: { episodeCount: number; lessonCount: number }): number {
  return (n.episodeCount ?? 0) + (n.lessonCount ?? 0);
}

function activityBandOf(history: number): string {
  if (history === 0) return 'No history';
  if (history === 1) return 'Touched once';
  if (history <= 3) return 'Some history';
  if (history <= 8) return 'Well-trodden';
  return 'Hot path';
}

/**
 * The group label for a node under the chosen slicing. Returned as a string so
 * the caller can assign stable community NUMBERS in one pass — the components
 * colour by `community`, and a label→index map keeps the same group the same
 * colour across every node.
 */
export function groupLabelOf(n: NodeRow, by: GroupBy): string {
  switch (by) {
    case 'layer':
      return layerOf(n.canonicalPath);
    case 'gate':
      return n.gate ? n.gate : 'No gate failure';
    case 'verdict':
      return n.verdict ? n.verdict : 'No episodes';
    case 'activity':
      return activityBandOf(historyOf(n));
    case 'directory':
    default:
      return directoryOf(n.canonicalPath);
  }
}

/**
 * Recency as a 0..1 fade, from when the file was last seen in a session.
 *
 * The components dim stale nodes rather than hiding them, with a floor — a file
 * nobody has touched in months is still part of the shape of the codebase, and
 * removing it would answer a different question.
 */
export function recencyOf(lastSeenAt: Date | null, now = Date.now()): number {
  if (!lastSeenAt) return 0.5;
  const days = (now - lastSeenAt.getTime()) / 86_400_000;
  if (days <= 7) return 1;
  if (days >= 180) return 0.35;
  return 1 - ((days - 7) / 173) * 0.65;
}

/** Icon per node kind. The components render this as the node glyph. */
function iconOf(n: NodeRow): string {
  if (n.kind === 'gate') return '⛨';
  const p = n.canonicalPath;
  if (/\.svelte$/.test(p)) return '◆';
  if (/\.(test|spec)\.[tj]sx?$/.test(p)) return '✓';
  if (/^scripts\//.test(p)) return '▸';
  if (/^src\/routes\/api\//.test(p)) return '⇄';
  if (/^src\/routes\//.test(p)) return '▤';
  if (/\.(sql|ts)$/.test(p) && /schema/.test(p)) return '▦';
  return '·';
}

/** Verdict ordering — the worst outcome on a file is the one worth surfacing. */
const VERDICT_RANK: Record<string, number> = {
  abandoned: 0,
  repaired: 1,
  unverified: 2,
  landed: 3,
  verified: 4,
};

export function worstVerdict(verdicts: string[]): string | null {
  let worst: string | null = null;
  for (const v of verdicts) {
    if (!(v in VERDICT_RANK)) continue;
    if (worst === null || VERDICT_RANK[v] < VERDICT_RANK[worst]) worst = v;
  }
  return worst;
}

export interface BuildInput {
  nodes: NodeRow[];
  edges: EdgeRow[];
  filters: NetworkFilters;
  now?: number;
}

/**
 * Build the payload the graph components consume.
 *
 * PURE — no database, no clock unless you pass one. That is what makes the
 * slicing testable, and it is the same split intel uses (`analytics/*` is pure,
 * only `load.ts` touches Postgres).
 */
export function buildNetwork({ nodes, edges, filters, now = Date.now() }: BuildInput): NetworkPayload {
  const f = filters;
  const limit = Math.max(10, Math.min(MAX_NODES, f.limit ?? MAX_NODES));

  // ── Filter ────────────────────────────────────────────────────────────────
  let pool = nodes;
  if (f.liveness === 'live') pool = pool.filter((n) => n.existsOnHead);
  else if (f.liveness === 'deleted') pool = pool.filter((n) => !n.existsOnHead);
  if (f.onlyWithHistory) pool = pool.filter((n) => historyOf(n) > 0);
  if (f.minHistory && f.minHistory > 0) pool = pool.filter((n) => historyOf(n) >= f.minHistory!);
  if (f.gates?.length) pool = pool.filter((n) => n.gate && f.gates!.includes(n.gate));
  if (f.verdicts?.length) pool = pool.filter((n) => n.verdict && f.verdicts!.includes(n.verdict));

  // Keyword hits are recorded, NOT used to filter: the components dim the
  // context around a match instead of deleting it, because a keyword view with
  // no edges says nothing about a network. Same rule as intel.
  const q = (f.q ?? '').trim().toLowerCase();
  const matched = q
    ? pool.filter((n) => n.canonicalPath.toLowerCase().includes(q)).map((n) => n.id)
    : [];

  const totalNodes = pool.length;

  // ── Rank and trim ─────────────────────────────────────────────────────────
  // By history carried, then path, so the same graph draws the same way twice.
  const ranked = pool
    .slice()
    .sort((a, b) => historyOf(b) - historyOf(a) || a.canonicalPath.localeCompare(b.canonicalPath));
  const kept = ranked.slice(0, limit);
  const keptIds = new Set(kept.map((n) => n.id));

  // ── Communities from the chosen slicing ───────────────────────────────────
  const labelToId = new Map<string, number>();
  const groupSizes = new Map<number, number>();
  for (const n of kept) {
    const label = groupLabelOf(n, f.groupBy);
    if (!labelToId.has(label)) labelToId.set(label, labelToId.size);
    const id = labelToId.get(label)!;
    groupSizes.set(id, (groupSizes.get(id) ?? 0) + 1);
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  const edgeKinds = f.edgeKinds?.length ? new Set(f.edgeKinds) : null;
  const drawnEdges = edges.filter(
    (e) =>
      keptIds.has(e.sourceId) &&
      keptIds.has(e.targetId) &&
      e.sourceId !== e.targetId &&
      (!edgeKinds || edgeKinds.has(e.kind)),
  );

  const degree = new Map<string, number>();
  for (const e of drawnEdges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
  }

  const maxHistory = Math.max(1, ...kept.map(historyOf));

  const netNodes: NetNode[] = kept.map((n) => {
    const label = groupLabelOf(n, f.groupBy);
    const community = labelToId.get(label)!;
    const history = historyOf(n);
    const deg = degree.get(n.id) ?? 0;
    return {
      id: n.id,
      name: n.displayName || n.canonicalPath.split('/').pop() || n.canonicalPath,
      // `type` is what the tooltip prints; the full path is the useful fact.
      type: n.canonicalPath,
      typeId: n.kind,
      icon: iconOf(n),
      color: '#7a5aa6',
      summary: n.summary,
      // A file that no longer exists at HEAD is drawn as unconfirmed: it is
      // still real history, but nothing can act on it.
      confirmed: n.existsOnHead,
      confidence: n.existsOnHead ? 'high' : 'low',
      noteCount: n.episodeCount,
      degree: deg,
      // Size by history carried, not by degree: a file everyone imports is not
      // the same as a file that has taught us something.
      importance: history / maxHistory,
      betweenness: 0,
      brokerage: 0,
      community,
      hops: null,
      categories: [label],
      aliases: [n.canonicalPath],
      sources: [n.kind, ...(n.gate ? [n.gate] : [])],
      recency: recencyOf(n.lastSeenAt, now),
      relevance: n.stale ? 0.4 : recencyOf(n.lastSeenAt, now),
    };
  });

  const byId = new Map(netNodes.map((n) => [n.id, n]));
  const netEdges: NetEdge[] = drawnEdges.map((e) => {
    const a = byId.get(e.sourceId)!;
    const b = byId.get(e.targetId)!;
    const w = Math.max(0, Math.min(1, e.weight / 8));
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: e.kind,
      label: e.kind === 'co_change' ? 'changes with' : 'read before editing',
      strength: e.weight >= 4 ? 'strong' : e.weight >= 2 ? 'medium' : 'weak',
      confidence: 'high',
      crossCommunity: a.community !== b.community,
      weight: w,
      recency: recencyOf(e.lastSeenAt, now),
      sourceKind: e.kind,
    };
  });

  const communities = [...labelToId.entries()]
    .map(([label, id]) => ({
      id,
      size: groupSizes.get(id) ?? 0,
      label,
      key: label,
      colourIndex: id,
    }))
    .sort((a, b) => b.size - a.size);

  // Isolated = drawn but touching nothing. Worth stating: in a code graph most
  // files genuinely are isolated, and a viewer who does not know that reads the
  // scatter as a bug.
  const isolated = netNodes.filter((n) => (degree.get(n.id) ?? 0) === 0).length;

  return {
    nodes: netNodes,
    edges: netEdges,
    types: [
      { id: 'file', name: 'File', icon: '·', color: '#7a5aa6' },
      { id: 'dir', name: 'Directory', icon: '▤', color: '#2f7d4f' },
      { id: 'gate', name: 'Gate', icon: '⛨', color: '#b4632e' },
    ],
    categories: communities.map((c) => ({
      id: String(c.id),
      slug: String(c.id),
      name: c.label,
      color: '#7a5aa6',
    })),
    sources: [],
    matched,
    trimmed: totalNodes > kept.length,
    filtering: Boolean(
      q || f.gates?.length || f.verdicts?.length || f.onlyWithHistory || f.liveness !== 'all',
    ),
    stats: {
      totalNodes,
      totalEdges: edges.length,
      shown: netNodes.length,
      communities: communities.length,
      modularity: 0,
      components: 0,
      largestComponent: 0,
      isolated,
      selectedNodes: totalNodes,
      selectedEdges: netEdges.length,
      selectedCommunities: communities.length,
    },
    communities,
  };
}
