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
import type { Artefact } from './contracts';
import { RELATION_FAMILIES, familyOf, type RelationFamilyKey } from './glossary';

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
  const ownsData = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.relation !== 'owns_data' && edge.relation !== 'supplies_data_to') continue;
    ownsData.set(edge.fromId, new Set([...(ownsData.get(edge.fromId) ?? []), edge.toId]));
  }
  push(
    'marks-own-homework',
    'Measured on data it supplies itself',
    'Where the measure and the measurement come from the same body, the metric is a statement of intent rather than a control. Worth reading beside any play that involves reporting.',
    [...measured.entries()]
      .filter(([id, targets]) => targets.some((t) => ownsData.get(id)?.has(t)))
      .map(([id]) => ({ id, label: name(id), note: 'is measured by data it owns or supplies' })),
  );

  // 4 — the bodies everything runs through.
  push(
    'load-bearing',
    'The bodies the policy runs through',
    'Most relationships in the paper touch these. That makes each of them a single point of failure whether or not anyone sets out to exploit it.',
    nodes.slice(0, 5).map((n) => ({ id: n.id, label: n.label, note: `${n.degree} relationships — ${n.out} out, ${n.in} in` })),
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
