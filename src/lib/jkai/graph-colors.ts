// Colour vocabulary for the thread knowledge graph.
//
// One question the graph should answer at a glance: how much of this is
// knowledge the base already held, and how much is this conversation talking to
// itself? Provenance answers it for nodes, and the typed/co-occurrence split
// answers it for edges — an `intel_relationships` row is an established
// relation, `MENTIONED WITH` only means two things appeared in the same turn.
//
// Shared by the 324px rail and the expanded modal for the same reason the layout
// maths is (see graph-layout.ts): two copies of a legend drift, and a legend
// that disagrees with the thing it labels is worse than no legend.
//
// Palette is the site's, not invented: petrol `--accent-ink` for settled
// knowledge, burnt-orange `--accent` for what this thread is the only witness
// to, and muted ink for the thread's own artefacts, which are not claims at all.

import type { NodeProvenance, ThreadGraphNode, ThreadGraphEdge } from './thread-graph';

export interface ProvenanceStyle {
  /** Chip border + glyph colour. */
  color: string;
  /** Chip fill. Kept faint so the label stays legible on the dot grid. */
  fill: string;
  /** Legend wording — what this colour actually asserts. */
  legend: string;
  /** The 324px rail's form of the same claim. Defined here beside the long one
   *  so the two cannot drift; a legend that disagrees with what it labels is
   *  worse than no legend, and that goes for an abbreviation of it too. */
  legendShort: string;
  /** Longer form for a title attribute. */
  hint: string;
}

export const PROVENANCE_STYLE: Record<NodeProvenance, ProvenanceStyle> = {
  known: {
    color: 'var(--accent-ink)',
    fill: 'color-mix(in srgb, var(--accent-ink) 10%, var(--bg))',
    legend: 'in knowledge base',
    legendShort: 'known',
    hint: 'Already known — corroborated by a source outside this conversation.',
  },
  new: {
    color: 'var(--accent)',
    fill: 'color-mix(in srgb, var(--accent) 10%, var(--bg))',
    legend: 'new from this chat',
    legendShort: 'new here',
    hint: 'First seen here. This conversation is the only thing asserting it so far.',
  },
  thread: {
    color: 'var(--text-muted)',
    fill: 'var(--bg)',
    legend: 'thread artefact',
    legendShort: 'artefact',
    hint: 'Something this thread touched — a model, file, canvas or attachment.',
  },
};

export function nodeStyle(node: Pick<ThreadGraphNode, 'provenance'>): ProvenanceStyle {
  return PROVENANCE_STYLE[node.provenance] ?? PROVENANCE_STYLE.thread;
}

export interface EdgeStyle {
  color: string;
  /** SVG dash pattern; undefined draws solid. */
  dash: string | undefined;
  legend: string;
  legendShort: string;
  hint: string;
}

/**
 * A typed relationship is one the graph asserts; co-occurrence is one this
 * thread merely observed. Solid vs dashed carries that on its own, so the
 * colour only has to reinforce it — which keeps the graph readable for anyone
 * who can't separate the two hues.
 */
export const EDGE_STYLE: Record<'typed' | 'cooccurrence', EdgeStyle> = {
  typed: {
    color: 'var(--accent-ink)',
    dash: undefined,
    legend: 'known relation',
    legendShort: 'relation',
    hint: 'A real relationship recorded in the knowledge base.',
  },
  cooccurrence: {
    color: 'var(--accent)',
    dash: '3 3',
    legend: 'seen together here',
    legendShort: 'co-occurs',
    hint: 'These appeared in the same turn of this conversation. Not an established relation.',
  },
};

export function edgeStyle(edge: Pick<ThreadGraphEdge, 'typed'>): EdgeStyle {
  return edge.typed ? EDGE_STYLE.typed : EDGE_STYLE.cooccurrence;
}

/** Legend rows to draw, limited to the provenances actually present so a graph
 *  of three artefacts doesn't claim to show knowledge it hasn't got. */
export interface LegendRow {
  kind: 'node' | 'edge';
  color: string;
  dash?: string;
  label: string;
  /** What the rail draws — see ProvenanceStyle.legendShort. */
  short: string;
  hint: string;
}

export function legendFor(
  nodes: ReadonlyArray<Pick<ThreadGraphNode, 'provenance'>>,
  edges: ReadonlyArray<Pick<ThreadGraphEdge, 'typed'>>,
): LegendRow[] {
  const out: LegendRow[] = [];
  for (const p of ['known', 'new', 'thread'] as const) {
    if (!nodes.some((n) => n.provenance === p)) continue;
    const s = PROVENANCE_STYLE[p];
    out.push({ kind: 'node', color: s.color, label: s.legend, short: s.legendShort, hint: s.hint });
  }
  for (const [key, present] of [
    ['typed', edges.some((e) => e.typed)],
    ['cooccurrence', edges.some((e) => !e.typed)],
  ] as const) {
    if (!present) continue;
    const s = EDGE_STYLE[key];
    out.push({
      kind: 'edge',
      color: s.color,
      dash: s.dash,
      label: s.legend,
      short: s.legendShort,
      hint: s.hint,
    });
  }
  return out;
}
