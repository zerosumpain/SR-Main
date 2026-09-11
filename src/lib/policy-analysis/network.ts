/**
 * The relationship map, read as a policy person would read it.
 *
 * The graph stage emits a `node` and an `edge` per assertion, and the page used
 * to render them as a flat list of "A → relates_to → B" with a dropdown. That is
 * the data, not a reading: twenty-six relation types is a vocabulary, and a
 * reader arriving at a policy graph is asking six or seven questions, not
 * twenty-six.
 *
 * So the edges fold into FAMILIES (`glossary.ts` owns the mapping), and each
 * family gets its own small multiple. Identity comes from the panel heading
 * rather than a hue: the site has exactly four validated categorical colours and
 * seven families would mean inventing three, which is the one thing the chart
 * rules forbid outright.
 *
 * The six structural insights below are the point of the whole exercise. Every
 * one of them is a question about a MISSING counterpart — authority with nobody
 * answering for it, cost with no benefit, a body measured on data it supplies
 * itself — and every one is computed by walking edges the paper itself asserted.
 * No model runs here, which is why the answers are stable across runs.
 */
import { AUTO_MERGE_THRESHOLD, findDuplicateCandidates, type ResolvableEntity } from '$lib/jkai/intel/resolve/match';
import type { Artefact } from './contracts';
import { RELATION_FAMILIES, familyOf, type RelationFamilyKey } from './glossary';

/**
 * Which edge endpoints are BODIES, as opposed to the machinery they point at.
 *
 * `nodesOf` keeps every endpoint whatever its kind, because an edge list is
 * about relationships and not about kinds. Everything downstream that says
 * "bodies" has to narrow it again, and for a while nothing did: the network
 * header counted 420 "Bodies" on an assessment holding 267 of them, and the
 * reading headlined "the bodies the policy runs through" named two mechanisms
 * among its five.
 *
 * `node` was admitted here while the graph contract still had a `node` kind —
 * a record the stage emitted per entity, which nothing rendered and no edge
 * ever pointed at. The kind is retired, so only `actor` remains; assessments
 * written before the retirement still hold their node rows, and they are
 * endpoints of nothing there either.
 */
export const BODY_KINDS = new Set(['actor']);
export const isBody = (node: { kind: string }) => BODY_KINDS.has(node.kind);

export type Edge = {
  artefact: Artefact;
  fromId: string;
  toId: string;
  relation: string;
  family: RelationFamilyKey | null;
  temporal: string | null;
};

export type EntityNode = {
  id: string;
  label: string;
  kind: string;
  entityType: string;
  /** Relationships touching it, in and out. */
  degree: number;
  out: number;
  in: number;
  /** Which families it takes part in at all. */
  families: RelationFamilyKey[];
};

export type FamilyPanel = {
  key: RelationFamilyKey;
  label: string;
  what: string;
  count: number;
  /** The busiest ends of this family, for the panel's own bars. */
  top: { id: string; label: string; count: number }[];
  /** Relation types actually present, with counts — the family opened up. */
  relations: { relation: string; count: number }[];
};

export type Insight = {
  key: string;
  headline: string;
  /** What it means, in the reader's terms. */
  reading: string;
  /** The bodies it names — always openable. */
  subjects: { id: string; label: string; note: string }[];
};

export type Network = {
  edges: Edge[];
  nodes: EntityNode[];
  families: FamilyPanel[];
  insights: Insight[];
  /** Relations the vocabulary has gained since the families were written. */
  unfamilied: number;
};

const label = (byId: Map<string, Artefact>, id: string) => byId.get(id)?.label ?? id;

/** Edges whose two ends both resolve. A dangling end is a reference, not a relationship. */
export function edgesOf(artefacts: Artefact[]): Edge[] {
  const known = new Set(artefacts.map((a) => a.id));
  return artefacts
    .filter((a) => a.kind === 'edge' && a.fromId && a.toId && a.relation)
    .filter((a) => known.has(a.fromId as string) && known.has(a.toId as string))
    .map((a) => ({
      artefact: a,
      fromId: a.fromId as string,
      toId: a.toId as string,
      relation: a.relation as string,
      family: familyOf(a.relation),
      temporal: a.temporal,
    }));
}

/** Everything an edge touches, with its degree split by direction. */
export function nodesOf(artefacts: Artefact[], edges: Edge[]): EntityNode[] {
  const byId = new Map(artefacts.map((a) => [a.id, a]));
  const seen = new Map<string, EntityNode>();
  const touch = (id: string, direction: 'out' | 'in', family: RelationFamilyKey | null) => {
    const artefact = byId.get(id);
    const node =
      seen.get(id) ??
      {
        id,
        label: artefact?.label ?? id,
        kind: artefact?.kind ?? 'unknown',
        entityType: String(artefact?.data?.entityType ?? '').replaceAll('_', ' '),
        degree: 0,
        out: 0,
        in: 0,
        families: [] as RelationFamilyKey[],
      };
    node.degree++;
    node[direction]++;
    if (family && !node.families.includes(family)) node.families.push(family);
    seen.set(id, node);
    return node;
  };
  for (const edge of edges) {
    touch(edge.fromId, 'out', edge.family);
    touch(edge.toId, 'in', edge.family);
  }
  return [...seen.values()].sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));
}

/** How many ends a family panel draws before it becomes a hairball. */
export const FAMILY_TOP = 6;

function panels(artefacts: Artefact[], edges: Edge[]): FamilyPanel[] {
  const byId = new Map(artefacts.map((a) => [a.id, a]));
  return RELATION_FAMILIES.map((family) => {
    const mine = edges.filter((e) => e.family === family.key);
    const ends = new Map<string, number>();
    const relations = new Map<string, number>();
    for (const edge of mine) {
      for (const end of [edge.fromId, edge.toId]) ends.set(end, (ends.get(end) ?? 0) + 1);
      relations.set(edge.relation, (relations.get(edge.relation) ?? 0) + 1);
    }
    return {
      key: family.key,
      label: family.label,
      what: family.what,
      count: mine.length,
      top: [...ends.entries()]
        .map(([id, count]) => ({ id, label: label(byId, id), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, FAMILY_TOP),
      relations: [...relations.entries()]
        .map(([relation, count]) => ({ relation, count }))
        .sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation)),
    };
  }).filter((p) => p.count > 0);
}

/** How many subjects an insight names before it stops being a finding and starts being a list. */
const INSIGHT_CAP = 8;

/**
 * One-entry memo, because `network()` runs in a `$derived` and the dashboard
 * replaces `data.artefacts` wholesale every six seconds while a run is active.
 *
 * MEASURED on the Best Start in Life inventory: `findDuplicateCandidates` over
 * 267 bodies is 95ms of a 100ms `network()`, against ~5ms for everything else —
 * a twentyfold regression on a hot path, for a scan whose answer only changes
 * when a body is added or renamed. `store.ts` carries the same note about the
 * same poll for the same reason.
 *
 * Keyed on the full id-and-label signature, so a hit is the same input and
 * therefore the same output; safe to share across SSR requests.
 */
let duplicateMemo: { key: string; value: Insight['subjects'] } | null = null;

function duplicateBodies(artefacts: Artefact[], nodes: EntityNode[]): Insight['subjects'] {
  const byId = new Map(artefacts.map((a) => [a.id, a]));
  const bodies = nodes.filter(isBody);
  if (bodies.length < 2) return [];
  const key = bodies.map((n) => `${n.id}\u001f${n.label}`).join('\u001e');
  if (duplicateMemo?.key === key) return duplicateMemo.value;
  const value = scanDuplicates(bodies, byId);
  duplicateMemo = { key, value };
  return value;
}

/**
 * Groups of bodies the site's own matcher says are one body recorded twice.
 *
 * `findDuplicateCandidates` is the house function for this exact defect — its
 * own header names the case, "IBCA" against "Infected Blood Compensation
 * Authority (IBCA)", where degree is split and every measure taken off the graph
 * is wrong. It blocks lexically before it scores, so this is a few hundred
 * comparisons rather than the square of the body count.
 *
 * Only pairs at or above `AUTO_MERGE_THRESHOLD` are reported: that is the
 * confidence the resolver itself calls safe to act on without review, and
 * anything looser would put a judgement call in front of the reader dressed as a
 * finding. They are unioned into groups so "Government", "The Government" and
 * "Government contribution" arrive as one row rather than three pairs.
 */
function scanDuplicates(bodies: EntityNode[], byId: Map<string, Artefact>): Insight['subjects'] {
  const entities: ResolvableEntity[] = bodies.map((n) => {
    const type = String(byId.get(n.id)?.data?.entityType ?? 'unknown');
    const aliases = byId.get(n.id)?.data?.aliases;
    return {
      id: n.id,
      name: n.label,
      typeId: type,
      typeName: type,
      degree: n.degree,
      noteCount: 1,
      aliases: Array.isArray(aliases) ? (aliases as string[]) : [],
    };
  });

  // Union-find, keeping the highest-degree member as the group's face — it is
  // the one the reader has already met on every other panel.
  const parent = new Map(entities.map((e) => [e.id, e.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    while (parent.get(id) !== root) {
      const next = parent.get(id) as string;
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const degreeOf = new Map(bodies.map((n) => [n.id, n.degree]));
  for (const pair of findDuplicateCandidates(entities)) {
    if (pair.confidence < AUTO_MERGE_THRESHOLD) continue;
    const a = find(pair.aId);
    const b = find(pair.bId);
    if (a === b) continue;
    const [keep, drop] = (degreeOf.get(a) ?? 0) >= (degreeOf.get(b) ?? 0) ? [a, b] : [b, a];
    parent.set(drop, keep);
  }

  const groups = new Map<string, string[]>();
  for (const entity of entities) {
    const root = find(entity.id);
    groups.set(root, [...(groups.get(root) ?? []), entity.id]);
  }
  const labelOf = new Map(bodies.map((n) => [n.id, n.label]));
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const combined = members.reduce((sum, id) => sum + (degreeOf.get(id) ?? 0), 0);
      // Identical names are the commonest case here, so the note says how many
      // copies there are rather than listing the same word back six times.
      const others = [...new Set(members.filter((id) => id !== root).map((id) => labelOf.get(id) ?? id))];
      const named = others.filter((name) => name !== labelOf.get(root)).slice(0, 3);
      const asWell = named.length ? `, also as ${named.join(', ')}` : '';
      return {
        id: root,
        label: labelOf.get(root) ?? root,
        note: `${members.length} separate bodies${asWell} — ${combined} relationships between them, counted apart`,
        combined,
      };
    })
    .sort((a, b) => b.combined - a.combined || a.label.localeCompare(b.label))
    .map(({ combined: _combined, ...subject }) => subject);
}

/**
 * Relations that make a body answerable for something rather than merely
 * involved in it. A body can appear all over a paper as a beneficiary without
 * that being an attribution; these two are the ones that are.
 */
const DUTY_RELATIONS = ['is_accountable_for', 'has_authority_over'];

/**
 * How many duties a body must carry before nobody pointing back at it is a
 * finding rather than a thin paper. One or two unanswered duties is the normal
 * state of a policy document; the case this exists for carried eighteen.
 */
const MIN_UNWIRED_DUTIES = 3;

/** Bodies the paper makes answerable for several things while nothing points back at them. */
function unwiredDuties(edges: Edge[], byId: Map<string, Artefact>): Insight['subjects'] {
  const inbound = new Set(edges.map((e) => e.toId));
  const duties = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!DUTY_RELATIONS.includes(edge.relation)) continue;
    if (inbound.has(edge.fromId)) continue;
    duties.set(edge.fromId, [...(duties.get(edge.fromId) ?? []), edge]);
  }
  return [...duties.entries()]
    .filter(([, held]) => held.length >= MIN_UNWIRED_DUTIES)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([id, held]) => {
      // A contiguous run of pages is the strongest tell that a name was picked
      // up from the page rather than from the sentence, so it is quoted where
      // the extraction recorded one.
      const pages = [...new Set(held.map((e) => e.artefact.page).filter((p): p is number => typeof p === 'number'))].sort((a, b) => a - b);
      const span = pages.length > 1 ? `, all from pages ${pages[0]}–${pages[pages.length - 1]}` : pages.length === 1 ? `, all from page ${pages[0]}` : '';
      return {
        id,
        label: byId.get(id)?.label ?? id,
        note: `${held.length} duties attributed${span}; nothing in the paper points back at it`,
      };
    });
}

/**
 * The six structural readings.
 *
 * Each is a MISSING counterpart, which is the only kind of finding a graph can
 * make on its own. They are deliberately phrased as observations rather than
 * verdicts: "nothing in the paper says who X answers to" is checkable, and
 * "X is unaccountable" is an accusation the graph cannot support.
 */
function insights(artefacts: Artefact[], edges: Edge[], nodes: EntityNode[]): Insight[] {
  const byId = new Map(artefacts.map((a) => [a.id, a]));
  const name = (id: string) => label(byId, id);
  const ends = (relations: string[], direction: 'from' | 'to') =>
    new Set(edges.filter((e) => relations.includes(e.relation)).map((e) => (direction === 'from' ? e.fromId : e.toId)));

  const out: Insight[] = [];
  const push = (key: string, headline: string, reading: string, subjects: Insight['subjects']) => {
    if (subjects.length) out.push({ key, headline, reading, subjects: subjects.slice(0, INSIGHT_CAP) });
  };

  // The two readings below come FIRST because they are caveats on every figure
  // under them rather than findings beside them. A degree split across six
  // copies of one body, or a duty hung on the wrong organisation, changes how
  // the six structural readings should be read — so a reader has to meet them
  // before the readings and not after. Both are conditional: a clean assessment
  // renders neither.

  // 0a — the same body, recorded more than once.
  //
  // Measured on Best Start in Life (2026-09-11): 267 bodies held 21 groups the
  // site's own matcher puts at or above its auto-merge threshold, six of them
  // literally the word "Government" and seven "Local authorities". Each copy
  // carries its own degree, so the busiest institution in the paper ranked ninth.
  //
  // REPORTED, NEVER MERGED, and that is the whole design. Folding them was
  // measured too: it moves the best possible bodies-against-bodies grid from
  // four live cells to five, while three of the eight largest groups visibly
  // conflate distinct bodies — "Schools" swallowing "early years settings". This
  // codebase has paid for a conflated hub before; it invents adjacency, which is
  // worse than a duplicate. So the reader is told, and the reader decides.
  push(
    'duplicate-bodies',
    'Bodies the paper appears to name more than once',
    'Each copy carries its own share of the relationships, so every count on this page is split between them and the busiest institutions rank lower than they are. The site’s identity rules put these at or above the confidence it treats as safe to merge — which is evidence for a look, never proof of identity.',
    duplicateBodies(artefacts, nodes),
  );

  // 0b — a duty attributed to a body the paper never wires up.
  //
  // Nesta, on the same assessment: eighteen `is_accountable_for` edges covering
  // the workforce chapter — teacher-training supply, retention incentives, the
  // qualifications checker — and an in-degree of zero. Nothing funds it, directs
  // it, depends on it or answers to it. A charity cited in the evidence had been
  // handed the department's commitments, and it was the second-busiest body on
  // the page.
  //
  // The shape is the finding, not the diagnosis: a body carrying duties that
  // nothing in the document points back at is either a real accountability gap
  // or an attribution that landed on the nearest named organisation, and both
  // are worth the reader's eye before anything downstream rests on it.
  push(
    'attributed-but-unconnected',
    'Carries duties the paper never wires up',
    'These bodies are made accountable for something, or given authority over it, and nothing in the paper runs back the other way — no money, no direction, no dependence, no reporting line. Either the document leaves the arrangement unstated, or the duty was attributed to a body that happened to be named nearby.',
    unwiredDuties(edges, byId),
  );

  // 1 — authority with nobody answering for its use.
  const wieldsAuthority = ends(['has_authority_over', 'can_veto', 'sanctions', 'appoints', 'regulates'], 'from');
  const answersToSomeone = ends(['reports_to', 'is_accountable_for'], 'from');
  push(
    'authority-without-accountability',
    'Holds authority, answers to no one in the paper',
    'These bodies can direct, veto or sanction someone, and the document never states who they answer to for doing it. That is a gap in the paper, not proof that no line exists.',
    [...wieldsAuthority]
      .filter((id) => !answersToSomeone.has(id))
      .map((id) => ({ id, label: name(id), note: 'directs or vetoes; no reporting line stated' })),
  );

  // 2 — bears the cost, receives no benefit.
  const bears = ends(['bears_cost_of'], 'from');
  const receives = ends(['receives_benefit_from'], 'from');
  push(
    'cost-without-benefit',
    'Carries a cost, gains nothing the paper names',
    'The classic source of quiet non-compliance. A body asked to absorb a cost with no stated return has every reason to do the minimum, and no rule broken.',
    [...bears]
      .filter((id) => !receives.has(id))
      .map((id) => ({ id, label: name(id), note: 'bears a cost; no benefit recorded' })),
  );

  // 3 — measured on data it owns.
  const measured = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.relation !== 'is_measured_by') continue;
    measured.set(edge.fromId, [...(measured.get(edge.fromId) ?? []), edge.toId]);
  }
  // ONLY `owns_data`. Its `toId` is the data; `supplies_data_to`'s `toId` is the
  // body receiving it, which is a different kind of thing and cannot be compared
  // against a measure.
  const ownsData = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.relation !== 'owns_data') continue;
    ownsData.set(edge.fromId, new Set([...(ownsData.get(edge.fromId) ?? []), edge.toId]));
  }
  push(
    'marks-own-homework',
    'Measured on data it supplies itself',
    'Where the measure and the data behind it come from the same body, the metric is a statement of intent rather than a control. Worth reading beside any play that involves reporting.',
    [...measured.entries()]
      .filter(([id, targets]) => targets.some((t) => ownsData.get(id)?.has(t)))
      .map(([id]) => ({ id, label: name(id), note: 'is measured by data it owns or supplies' })),
  );

  // 4 — the bodies everything runs through.
  //
  // FILTERED TO BODIES, which the headline has always claimed and the code did
  // not do. `nodes` is every endpoint of any kind, so on the Best Start in Life
  // assessment of 2026-09-11 two of the five "bodies the policy runs through"
  // were mechanisms — "Tailored support after inspections", "Enhanced reception
  // offer". Both are genuinely load-bearing and both are machinery, which is a
  // different reading and now has its own card.
  const bodies = nodes.filter(isBody);
  const machinery = nodes.filter((n) => !isBody(n));
  push(
    'load-bearing',
    'The bodies the policy runs through',
    'Most relationships in the paper touch these. That makes each of them a single point of failure whether or not anyone sets out to exploit it.',
    bodies.slice(0, 5).map((n) => ({ id: n.id, label: n.label, note: `${n.degree} relationships — ${n.out} out, ${n.in} in` })),
  );

  // 4b — and the machinery, which on a paper written as beneficiaries-and-
  // delivery is the busier half by some distance. A duty or a payment that
  // everything hangs off is a single point of failure in exactly the way a body
  // is, and the graph can see it for the same reason.
  push(
    'load-bearing-machinery',
    'The machinery the policy runs through',
    'Not bodies but duties, payments, offers and measures. Where a paper wires far more relationships into its machinery than between its institutions, these are what a play actually aims at.',
    machinery.slice(0, 5).map((n) => ({ id: n.id, label: n.label, note: `${n.degree} relationships — ${n.out} out, ${n.in} in` })),
  );

  // 5 — one-way relationships nothing answers.
  const pairs = new Set(edges.map((e) => `${e.fromId}|${e.toId}`));
  const oneWay = edges.filter(
    (e) => (e.family === 'authority' || e.family === 'money') && !pairs.has(`${e.toId}|${e.fromId}`),
  );
  push(
    'one-way',
    'Authority and money that run one way only',
    'Nothing in the paper travels back along these — no report, no return, no right of reply. Sometimes correct, and always worth knowing before an actor is asked to co-operate.',
    [...new Map(oneWay.map((e) => [`${e.fromId}|${e.toId}`, e])).values()].map((e) => ({
      id: e.artefact.id,
      label: `${name(e.fromId)} → ${name(e.toId)}`,
      note: e.relation.replaceAll('_', ' '),
    })),
  );

  // 6 — the reciprocal pairs, which are the machinery that IS complete.
  const reciprocal = edges.filter((e) => pairs.has(`${e.toId}|${e.fromId}`) && e.fromId < e.toId);
  push(
    'reciprocal',
    'Relationships the paper closes in both directions',
    'Both ends are stated. These are the parts of the machinery that do not depend on goodwill to work.',
    [...new Map(reciprocal.map((e) => [`${e.fromId}|${e.toId}`, e])).values()].map((e) => ({
      id: e.artefact.id,
      label: `${name(e.fromId)} ↔ ${name(e.toId)}`,
      note: e.relation.replaceAll('_', ' '),
    })),
  );

  return out;
}

export function network(artefacts: Artefact[]): Network {
  const edges = edgesOf(artefacts);
  const nodes = nodesOf(artefacts, edges);
  return {
    edges,
    nodes,
    families: panels(artefacts, edges),
    insights: insights(artefacts, edges, nodes),
    unfamilied: edges.filter((e) => !e.family).length,
  };
}
