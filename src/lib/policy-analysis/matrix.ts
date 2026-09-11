/**
 * THE ASSESSMENT AS GRIDS, NOT AS CARDS.
 *
 * The dashboard rebuild of 2026-09-10 put a depth gradient over the content and
 * left the content itself as full-size stacked cards. Measured at 1440px on a
 * nine-body assessment: the playbook was 5,321px tall, the cast 3,541px and the
 * network 4,481px, because eleven plays meant eleven cards and nine bodies meant
 * nine cards each repeating the same six field labels. A reader comparing two
 * bodies had to hold one in their head and scroll.
 *
 * A comparison wants a GRID. Rows are the subjects, columns are the same
 * question asked of each, and every cell is short enough that the eye can run
 * down a column — the long text lives one hover and one click away, which is
 * where the depth gradient already put it. So this module is three derivations,
 * all pure, all testable without mounting anything:
 *
 *  * `traitGrid`   — bodies × what moves them (the cast, as an x-by-y table)
 *  * `playGrid`    — plays × the four factors behind their rank
 *  * `adjacency`   — bodies × bodies, cells naming the relationship families
 *
 * Nothing here asks a model for anything: every column is a field the pipeline
 * already emitted. The clipping is the only new judgement, and it is one
 * function so the three grids clip alike.
 */
import { PROFILE_FIELDS, type Artefact } from './contracts';
import { familyOf, RELATION_FAMILIES, type RelationFamilyKey } from './glossary';
import type { Edge, Network } from './network';
import type { ActorView, Play } from './view';

/**
 * How long a cell may be before it is clipped.
 *
 * A grid stops being readable the moment one cell wraps to four lines and drags
 * its whole row with it. 46 characters is about five words of policy prose —
 * enough to tell two bodies apart in a 10rem column — and the full sentence is
 * on the hover card and in the drill, so nothing is lost, only deferred.
 */
export const CELL_CHARS = 46;

/** Clip on a word boundary, never mid-word, and say that it was clipped. */
export function clip(text: string, limit = CELL_CHARS): { text: string; clipped: boolean } {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return { text: flat, clipped: false };
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return { text: `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`, clipped: true };
}

export type Cell = {
  /** What the grid draws. */
  text: string;
  /** What the hover card and the drill show. */
  full: string;
  /** `extracted_fact`, `behavioural_hypothesis`, … — the epistemic status. */
  origin: string;
  clipped: boolean;
} | null;

/**
 * THE CAST, AS A TABLE.
 *
 * Six columns out of the profile's twenty-one, chosen because they are the six a
 * reader compares BODIES on. The other fifteen are not dropped — they are in the
 * drill, behind the row's own name — but putting twenty-one columns on screen
 * would be the same wall of text turned ninety degrees.
 *
 * `gainFromFailure` is last and is the one the page emphasises, because it is
 * the question an assurance review never asks.
 */
export const TRAIT_COLUMNS = [
  { key: 'accountableTo', head: 'Answers to', asks: 'Who can call this body to account?' },
  { key: 'successCriteria', head: 'Judged on', asks: 'What does this body get measured by?' },
  { key: 'timeHorizon', head: 'Looks ahead', asks: 'How far ahead can it afford to care?' },
  { key: 'informationControlled', head: 'Controls', asks: 'What does it know that others do not?' },
  { key: 'outsideOption', head: 'Does instead', asks: 'What does it do if it declines to play along?' },
  { key: 'gainFromFailure', head: 'Gains if it fails', asks: 'Who around it is better off if this policy fails?' },
] as const satisfies readonly { key: (typeof PROFILE_FIELDS)[number]; head: string; asks: string }[];

export type TraitRow = {
  id: string;
  label: string;
  entityType: string;
  /** The profile artefact, for the drill. Null when no profile was built. */
  profileId: string | null;
  /** The worst play this body can run, 0–100, and its band. */
  worst: number;
  band: string | null;
  playCount: number;
  /** The single worst play, so the row can name it rather than score it. */
  topPlay: { id: string; label: string; band: string } | null;
  /** One per `TRAIT_COLUMNS`, in that order. Null where the profile is silent. */
  cells: Cell[];
  /** True when this body has a dossier in the reader's library. */
  known: boolean;
};

const profileField = (profile: Artefact | null, key: string): Cell => {
  const raw = profile?.data?.[key];
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as { value?: string; origin?: string };
  if (!f.value) return null;
  const { text, clipped } = clip(f.value);
  return { text, full: f.value, origin: String(f.origin ?? ''), clipped };
};

/**
 * Build the cast grid.
 *
 * Ordered by the worst play each body can run, then by name — the same order the
 * cards used, because it is the order the reader asked for ("who should I worry
 * about"). A body with no play still appears: an absence of plays is a finding,
 * and dropping the row would hide it.
 */
export function traitGrid(board: ActorView[], personas: { actorId: string | null }[] = []): TraitRow[] {
  const known = new Set(personas.map((p) => p.actorId).filter((id): id is string => Boolean(id)));
  return board
    .map((view) => ({
      id: view.actor.id,
      label: view.actor.label,
      entityType: String(view.actor.data.entityType ?? '').replaceAll('_', ' '),
      profileId: view.profile?.id ?? null,
      worst: Math.round(view.worst * 100),
      band: view.plays[0]?.band ?? null,
      playCount: view.plays.length,
      topPlay: view.plays[0]
        ? { id: view.plays[0].artefact.id, label: view.plays[0].artefact.label, band: view.plays[0].band }
        : null,
      cells: TRAIT_COLUMNS.map((column) => profileField(view.profile, column.key)),
      known: known.has(view.actor.id),
    }))
    .sort((a, b) => b.worst - a.worst || a.label.localeCompare(b.label));
}

/**
 * How much of the grid the assessment could actually fill.
 *
 * A cast table with two thirds of its cells empty is not a thin design, it is a
 * thin assessment, and the page must say which. Reported as a count so the
 * caller can render "34 of 54 cells filled" rather than leaving the reader to
 * wonder whether the blanks are a bug.
 */
export function traitCoverage(rows: TraitRow[]): {
  filled: number;
  total: number;
  silent: string[];
  /** The origin almost every cell carries, when one dominates. */
  dominantOrigin: string | null;
  /** How many cells differ from it. */
  exceptions: number;
} {
  const total = rows.length * TRAIT_COLUMNS.length;
  const cells = rows.flatMap((row) => row.cells.filter((c): c is NonNullable<Cell> => Boolean(c)));
  const silent = TRAIT_COLUMNS.filter((_, i) => rows.every((row) => !row.cells[i])).map((c) => c.head);

  // WHY THIS EXISTS: every one of 54 cells on the live assessment carried the
  // words "structural inference" under it, because that is what a profile field
  // derived from the graph IS. Fifty-four repetitions of one true label is
  // noise that hides the values it annotates. So the dominant origin is stated
  // ONCE, in the caption, and a cell only labels itself when it differs — which
  // is exactly when the label carries information.
  const counts = new Map<string, number>();
  for (const cell of cells) counts.set(cell.origin, (counts.get(cell.origin) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0] ?? null;
  const dominant = top && cells.length >= 4 && top[1] / cells.length >= 0.6 ? top[0] : null;

  return {
    filled: cells.length,
    total,
    silent,
    dominantOrigin: dominant,
    exceptions: dominant ? cells.length - (counts.get(dominant) ?? 0) : 0,
  };
}

/**
 * THE PLAYBOOK, AS A TABLE.
 *
 * One row per play: rank, what it is, who would run it, the four factors, the
 * one figure computed from them, and whether it breaks any rule. Eleven rows
 * where eleven cards stood.
 *
 * The factors stay as numbers AND as a bar — a bar alone cannot be read off
 * precisely enough to argue with, and a number alone cannot be scanned down a
 * column. `PLAY_FACTORS` is the column order and it matches
 * `exposure.EXPOSURE_FACTORS`, deliberately: the reader should be able to see
 * the arithmetic being done left to right.
 */
export const PLAY_FACTORS = ['incentive', 'ease', 'impact', 'concealment'] as const;

export type PlayRow = {
  rank: number;
  id: string;
  label: string;
  /** The play in one sentence, clipped. */
  summary: string;
  full: string;
  actor: { id: string; label: string } | null;
  factors: { key: (typeof PLAY_FACTORS)[number]; value: number }[];
  exposure: number;
  band: string;
  legality: string;
  /** What the play defeats — the mechanisms and measures it aims at. */
  targets: number;
};

export function playGrid(plays: Play[]): PlayRow[] {
  return plays.map((play, index) => {
    const data = play.artefact.data;
    const summary = clip(String(data.play ?? play.artefact.statement ?? ''), 96);
    return {
      rank: index + 1,
      id: play.artefact.id,
      label: play.artefact.label,
      summary: summary.text,
      full: String(data.play ?? play.artefact.statement ?? ''),
      actor: play.actor ? { id: play.actor.id, label: play.actor.label } : null,
      factors: PLAY_FACTORS.map((key) => ({ key, value: Math.round(Number(data[key] ?? 0) * 100) })),
      exposure: Math.round(Number(data.exposure ?? 0) * 100),
      band: play.band,
      legality: String(data.legality ?? ''),
      targets: Array.isArray(data.targets) ? data.targets.length : 0,
    };
  });
}

/**
 * BODIES × BODIES.
 *
 * The network panel drew six family small-multiples and a 37-row list of
 * "A REGULATES B" and never once drew the shape of the thing. An adjacency grid
 * does: a row of full cells is a body everything runs through, an empty column
 * is a body nothing answers to, and the diagonal's two halves show which
 * relationships the paper states in one direction only — which is the reading
 * the insights already compute in prose.
 *
 * It is capped. A grid is only legible while both axes fit, so the busiest
 * `limit` bodies are drawn and the remainder is counted and named. Ranked by
 * degree, so the cap keeps the bodies the policy runs through.
 */
export type AdjacencyCell = {
  /** Families present on this ordered pair, in the canonical family order. */
  families: RelationFamilyKey[];
  /** The relation types themselves, for the hover. */
  relations: string[];
  /** Edge artefact ids, so a cell can open the drill on the relationship. */
  ids: string[];
};

export type Adjacency = {
  /** Both axes; rows are the "from" end. */
  bodies: { id: string; label: string; entityType: string; degree: number }[];
  /** `rows[i][j]` is the relationship from `bodies[i]` to `bodies[j]`, or null. */
  rows: (AdjacencyCell | null)[][];
  /** Bodies not drawn, because the grid was capped. */
  omitted: { id: string; label: string; degree: number }[];
  /** Edges whose ends are both drawn — the share of the graph the grid shows. */
  shown: number;
  total: number;
  /** Pairs the paper states in one direction only. */
  oneWay: number;
  /** Pairs stated in both. */
  reciprocal: number;
};

const FAMILY_ORDER = RELATION_FAMILIES.map((f) => f.key) as RelationFamilyKey[];

export function adjacency(net: Network, limit = 12): Adjacency {
  // Only bodies, never mechanisms or measures: an adjacency grid of mixed kinds
  // reads as a matrix of everything against everything, which is not a question
  // anybody asks. `nodesOf` keeps the artefact kind for exactly this.
  const candidates = net.nodes
    .filter((n) => n.kind === 'actor' || n.kind === 'node')
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
  const drawn = candidates.slice(0, limit);
  const omitted = candidates.slice(limit).map((n) => ({ id: n.id, label: n.label, degree: n.degree }));
  const index = new Map(drawn.map((n, i) => [n.id, i]));

  const rows: (AdjacencyCell | null)[][] = drawn.map(() => drawn.map(() => null));
  let shown = 0;
  for (const edge of net.edges) {
    const from = index.get(edge.fromId);
    const to = index.get(edge.toId);
    if (from === undefined || to === undefined) continue;
    shown++;
    const cell = (rows[from][to] ??= { families: [], relations: [], ids: [] });
    const family = edge.family ?? familyOf(edge.relation);
    if (family && !cell.families.includes(family)) cell.families.push(family);
    if (!cell.relations.includes(edge.relation)) cell.relations.push(edge.relation);
    cell.ids.push(edge.artefact.id);
  }
  for (const row of rows) {
    for (const cell of row) {
      if (cell) cell.families.sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
    }
  }

  // Counted over the drawn grid only, so the figure agrees with what is on
  // screen. A total over the whole graph beside a capped picture is the "two
  // numbers for one quantity" defect this feature has already paid for once.
  let oneWay = 0;
  let reciprocal = 0;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const there = Boolean(rows[i][j]);
      const back = Boolean(rows[j][i]);
      if (there && back) reciprocal++;
      else if (there || back) oneWay++;
    }
  }

  return {
    bodies: drawn.map((n) => ({ id: n.id, label: n.label, entityType: n.entityType, degree: n.degree })),
    rows,
    omitted,
    shown,
    total: net.edges.length,
    oneWay,
    reciprocal,
  };
}

/**
 * Shorten a body's name for a grid axis.
 *
 * A column header in an adjacency grid gets about twelve characters before the
 * grid stops fitting, and a policy body's name is "Department for Levelling Up,
 * Housing and Communities". Initials are wrong — "DLUHC" is a real abbreviation
 * and inventing one for "Large registered providers" is not — so this keeps the
 * leading words and the full name stays on the axis's own hover.
 */
export function axisLabel(label: string, limit = 16): string {
  return clip(label, limit).text;
}

/** Relation type as a reader would say it: `has_authority_over` → "has authority over". */
export function relationWords(relation: string): string {
  return relation.replaceAll('_', ' ');
}

/**
 * The relationship rows behind one cell, for the hover and the drill.
 *
 * Kept here rather than in the component so the sentence a cell explains itself
 * with is asserted in a test: "Regulator of Social Housing regulates Large
 * registered providers, and two more".
 */
export function cellSentence(fromLabel: string, toLabel: string, cell: AdjacencyCell): string {
  const [first, ...rest] = cell.relations;
  const opening = `${fromLabel} ${relationWords(first)} ${toLabel}`;
  if (!rest.length) return `${opening}.`;
  return `${opening}, and ${rest.length === 1 ? 'one more relationship' : `${rest.length} more relationships`}.`;
}

/** Every edge the grid could not place, so the caller can say so honestly. */
export function unplacedEdges(net: Network, grid: Adjacency): Edge[] {
  const drawn = new Set(grid.bodies.map((b) => b.id));
  return net.edges.filter((e) => !drawn.has(e.fromId) || !drawn.has(e.toId));
}
