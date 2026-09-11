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
import { isBody, type Edge, type Network } from './network';
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
  bodies: { id: string; label: string; entityType: string; degree: number; links: number }[];
  /** `rows[i][j]` is the relationship from `bodies[i]` to `bodies[j]`, or null. */
  rows: (AdjacencyCell | null)[][];
  /** Bodies not drawn, because the grid was capped. */
  omitted: { id: string; label: string; degree: number }[];
  /** Edges whose ends are both drawn — the share of the graph the grid shows. */
  shown: number;
  total: number;
  /**
   * Relationships with a body at BOTH ends — the most a bodies-against-bodies
   * grid could ever place, however the cap is set.
   *
   * Reported because `shown` against `total` is not the reader's question and
   * on a star-shaped policy it is actively misleading: "0 of 452 (0%)" invites
   * the conclusion that the extraction failed, when 420 of those 452 run from a
   * body to a piece of machinery and were never grid material.
   */
  placeable: number;
  /** Pairs the paper states in one direction only. */
  oneWay: number;
  /** Pairs stated in both. */
  reciprocal: number;
  /** False when the drawn grid holds too little structure to read as a shape. */
  legible: boolean;
};

/**
 * How many relationships a grid must place before it is a picture rather than
 * an empty frame.
 *
 * Measured on the Best Start in Life assessment of 2026-09-11: 452 stated
 * relationships, of which 32 run body-to-body, spread thinly enough that the
 * best possible twelve-by-twelve grid places four of them. The page drew 144
 * empty cells under a caption reading "0 of 452 (0%)", which reads as a broken
 * chart rather than as the finding it is — a strategy written as beneficiaries
 * and machinery has no mesh to draw.
 *
 * Six is two rows' worth of structure. Below it there is nothing for the eye to
 * run down and the ranked list carries the same content without the frame.
 */
export const MIN_GRID_EDGES = 6;

const FAMILY_ORDER = RELATION_FAMILIES.map((f) => f.key) as RelationFamilyKey[];

/** One ordered pair of bodies, with every relationship the paper states between them. */
export type BodyLink = {
  fromId: string;
  fromLabel: string;
  toId: string;
  toLabel: string;
  families: RelationFamilyKey[];
  relations: string[];
  ids: string[];
  /** True when the paper also states the return leg. */
  reciprocated: boolean;
};

/**
 * Every body-to-body relationship, one row per ordered pair.
 *
 * What the grid degrades to when there is no mesh to draw. Same content, same
 * ordering question — busiest pair first — without asking the reader to find
 * five live cells in a hundred and forty-four.
 */
export function bodyLinks(net: Network): BodyLink[] {
  const bodies = new Set(net.nodes.filter(isBody).map((n) => n.id));
  const label = new Map(net.nodes.map((n) => [n.id, n.label]));
  const pairs = new Map<string, BodyLink>();
  for (const edge of net.edges) {
    if (!bodies.has(edge.fromId) || !bodies.has(edge.toId) || edge.fromId === edge.toId) continue;
    const key = `${edge.fromId}|${edge.toId}`;
    let link = pairs.get(key);
    if (!link) {
      link = {
        fromId: edge.fromId,
        fromLabel: label.get(edge.fromId) ?? edge.fromId,
        toId: edge.toId,
        toLabel: label.get(edge.toId) ?? edge.toId,
        families: [],
        relations: [],
        ids: [],
        reciprocated: false,
      };
      pairs.set(key, link);
    }
    const family = edge.family ?? familyOf(edge.relation);
    if (family && !link.families.includes(family)) link.families.push(family);
    if (!link.relations.includes(edge.relation)) link.relations.push(edge.relation);
    link.ids.push(edge.artefact.id);
  }
  for (const link of pairs.values()) {
    link.reciprocated = pairs.has(`${link.toId}|${link.fromId}`);
    link.families.sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
  }
  return [...pairs.values()].sort(
    (a, b) => b.ids.length - a.ids.length || a.fromLabel.localeCompare(b.fromLabel) || a.toLabel.localeCompare(b.toLabel),
  );
}

export function adjacency(net: Network, limit = 12): Adjacency {
  // Only bodies, never mechanisms or measures: an adjacency grid of mixed kinds
  // reads as a matrix of everything against everything, which is not a question
  // anybody asks. `nodesOf` keeps the artefact kind for exactly this.
  //
  // RANKED BY THE DEGREE THE GRID CAN DRAW, not by total degree, and the
  // difference is the whole cap. Total degree is dominated by the edges this
  // grid throws away — on Best Start in Life, 420 of 452 relationships run from
  // a body to a piece of machinery — so ranking on it selects the twelve bodies
  // busiest at pointing AT machinery, which are close to the twelve least likely
  // to point at each other. It chose "Children" (27 relationships, 26 of them
  // benefits received) and "Nesta" over "Local authorities" and "Government",
  // and placed none of the 32 body-to-body links: the first would have needed a
  // cap of 20, all 32 a cap of 263.
  const bodies = new Set(net.nodes.filter(isBody).map((n) => n.id));
  const placeableEdges = net.edges.filter((e) => bodies.has(e.fromId) && bodies.has(e.toId) && e.fromId !== e.toId);
  const links = new Map<string, number>();
  for (const edge of placeableEdges) {
    links.set(edge.fromId, (links.get(edge.fromId) ?? 0) + 1);
    links.set(edge.toId, (links.get(edge.toId) ?? 0) + 1);
  }
  const candidates = net.nodes
    .filter(isBody)
    .sort(
      (a, b) =>
        (links.get(b.id) ?? 0) - (links.get(a.id) ?? 0) || b.degree - a.degree || a.label.localeCompare(b.label),
    );
  const drawn = candidates.slice(0, limit);
  const omitted = candidates.slice(limit).map((n) => ({ id: n.id, label: n.label, degree: n.degree }));
  const index = new Map(drawn.map((n, i) => [n.id, i]));

  const rows: (AdjacencyCell | null)[][] = drawn.map(() => drawn.map(() => null));
  let shown = 0;
  // Walks the PLACEABLE edges, not every edge: a body related to itself would
  // otherwise land on the diagonal and count towards `shown`, which the caption
  // then reports against a `placeable` that excluded it — two numbers for one
  // quantity, in the one place the grid promises the diagonal is empty.
  for (const edge of placeableEdges) {
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
    bodies: drawn.map((n) => ({
      id: n.id,
      label: n.label,
      entityType: n.entityType,
      degree: n.degree,
      links: links.get(n.id) ?? 0,
    })),
    rows,
    omitted,
    shown,
    total: net.edges.length,
    placeable: placeableEdges.length,
    oneWay,
    reciprocal,
    legible: shown >= MIN_GRID_EDGES,
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

/**
 * Body-to-body relationships the cap left off the grid, so the caller can say so
 * honestly.
 *
 * Narrowed to the placeable ones on purpose: counting the 420 body-to-machinery
 * relationships as "unplaced" describes the grid's subject rather than its cap,
 * and reads as a much bigger omission than the one the reader can do anything
 * about.
 */
export function unplacedEdges(net: Network, grid: Adjacency): Edge[] {
  const drawn = new Set(grid.bodies.map((b) => b.id));
  const bodies = new Set(net.nodes.filter(isBody).map((n) => n.id));
  return net.edges.filter(
    (e) => bodies.has(e.fromId) && bodies.has(e.toId) && e.fromId !== e.toId && (!drawn.has(e.fromId) || !drawn.has(e.toId)),
  );
}
