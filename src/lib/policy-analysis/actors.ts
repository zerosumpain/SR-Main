/**
 * The actor atlas — every body the policy runs through, on five measures.
 *
 * The board this replaces answered one question: who could do the worst thing.
 * That is the right FIRST question and the wrong only one, because the reader
 * arrives with several — who has the most ways in, who is the paper actually
 * built around, who does it keep naming, who is wired to everything. All five
 * are already in the data; none of them needed asking for.
 *
 * Everything here is derived. `role` is the only composite and it is stated
 * rather than tuned: how often the paper names a body, multiplied by how much of
 * the machinery runs through it. Both halves are counts, so a reader can check
 * it, and it is normalised across the cast so the bar means "compared with the
 * others in this policy" rather than "out of some absolute".
 *
 * The measures are magnitudes, one per body, which is why the visual is a ranked
 * bar and not a scatter: a scatter would force two of the five on the reader
 * when the ask was to pick one.
 */
import type { Artefact } from './contracts';
import type { ActorView, Play } from './view';
import { edgesOf } from './network';

export const ACTOR_MEASURES = [
  { key: 'worst', label: 'Biggest risk', unit: 'exposure', note: 'The highest-ranked play this body could run.' },
  { key: 'plays', label: 'Exposures', unit: 'plays', note: 'How many exploitation plays name it as the actor.' },
  { key: 'role', label: 'Role in the policy', unit: 'index', note: 'How often the paper names it, weighted by the relationships running through it.' },
  { key: 'mentions', label: 'Times referenced', unit: 'mentions', note: 'Passages of the paper that mention it.' },
  { key: 'degree', label: 'Relationships', unit: 'links', note: 'Relationships in the knowledge graph that touch it.' },
] as const;

export type MeasureKey = (typeof ACTOR_MEASURES)[number]['key'];

export type AtlasRow = {
  view: ActorView;
  id: string;
  label: string;
  entityType: string;
  /** Every measure, so switching one never recomputes the others. */
  measures: Record<MeasureKey, number>;
  /** The worst band this body can reach, for the word beside its bar. */
  band: string | null;
  /** How many of the graph's relationships name it. */
  degree: number;
  /** Passages naming it. */
  mentions: number;
  /** True when the library already holds a dossier for this body. */
  known: boolean;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * How many relationships touch each entity.
 *
 * Counted over `edgesOf()`, the SAME derivation the network panel draws from,
 * because the two appear on one page and must agree. Counting raw `edge`
 * artefacts here instead gave a body sitting on an edge with a dangling
 * counterpart "7 relationships" in the atlas and 5 in the network — one
 * quantity, two numbers, and the `role` composite multiplied by the wrong one.
 */
export function degrees(artefacts: Artefact[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edgesOf(artefacts)) {
    for (const end of [edge.fromId, edge.toId]) counts.set(end, (counts.get(end) ?? 0) + 1);
  }
  return counts;
}

/**
 * Build the atlas.
 *
 * `board` is `view.actorBoard()` — the profiled cast, already joined to its
 * plays — so this adds measures rather than re-deriving membership. Two
 * derivations of "which actors count" would drift, and the one that already
 * exists is the one the report cites.
 */
export function atlas(
  artefacts: Artefact[],
  board: ActorView[],
  personas: { actorId: string | null }[] = [],
): AtlasRow[] {
  const degree = degrees(artefacts);
  const known = new Set(personas.map((p) => p.actorId).filter((id): id is string => Boolean(id)));

  const raw = board.map((view) => {
    const mentions = strings(view.actor.data.mentions).length;
    const links = degree.get(view.actor.id) ?? 0;
    return { view, mentions, links };
  });

  // `role` is normalised across the cast, so the tallest bar is always 1 and the
  // rest are read against it. An absolute scale would make every policy with a
  // large cast look busier than one with a small one, which is not a finding.
  const peak = Math.max(1, ...raw.map((r) => r.mentions * Math.max(1, r.links)));

  return raw.map(({ view, mentions, links }) => ({
    view,
    id: view.actor.id,
    label: view.actor.label,
    entityType: String(view.actor.data.entityType ?? '').replaceAll('_', ' '),
    band: view.plays[0]?.band ?? null,
    degree: links,
    mentions,
    known: known.has(view.actor.id),
    measures: {
      worst: view.worst,
      plays: view.plays.length,
      role: (mentions * Math.max(1, links)) / peak,
      mentions,
      degree: links,
    },
  }));
}

/**
 * Sort the atlas on one measure, worst first, and drop the bodies that score
 * nothing at all on it.
 *
 * A body with no plays does not belong on the "biggest risk" chart — an empty
 * bar with a name beside it reads as a zero the assessment measured, when it is
 * an absence it never looked for. It stays in the table underneath.
 */
export function rank(rows: AtlasRow[], measure: MeasureKey): AtlasRow[] {
  return rows
    .filter((r) => r.measures[measure] > 0)
    .sort((a, b) => b.measures[measure] - a.measures[measure] || a.label.localeCompare(b.label));
}

/** The bar scale for a measure: the top score, never zero. */
export function ceiling(rows: AtlasRow[], measure: MeasureKey): number {
  return Math.max(...rows.map((r) => r.measures[measure]), 0) || 1;
}

/**
 * How a measure is printed beside its bar.
 *
 * Exposure and the role index are fractions of one and read as a 0–100 score;
 * the other three are counts and must never gain a decimal point.
 */
export function formatMeasure(measure: MeasureKey, value: number): string {
  if (measure === 'worst' || measure === 'role') return String(Math.round(value * 100));
  return String(Math.round(value));
}

/**
 * A one-line reading of the cast, for the strap above the chart.
 *
 * Written as a sentence rather than four tiles because it is the sentence a
 * reader would say out loud: the shape of the cast, then the thing worth
 * knowing about it.
 */
export function castSummary(rows: AtlasRow[]): string {
  if (!rows.length) return 'No body has been profiled yet.';
  const withPlays = rows.filter((r) => r.measures.plays > 0);
  const severe = rows.filter((r) => r.band === 'severe');
  const parts = [`${rows.length} ${rows.length === 1 ? 'body' : 'bodies'} profiled`];
  parts.push(
    withPlays.length
      ? `${withPlays.length} of them can run at least one play`
      : 'none of them has an exploitation play against it',
  );
  if (severe.length) parts.push(`${severe.length} can run a severe one`);
  return `${parts.join('; ')}.`;
}
