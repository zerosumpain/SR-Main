// Automated insights — what the graph noticed that you didn't ask about.
//
// Each detector is a pure function over the analysis snapshot returning zero or
// more findings. They are deliberately RULE-BASED rather than LLM-generated:
// a detector that fires on a measurable structural condition can be trusted,
// explained, and tested, whereas "ask a model what's interesting" produces
// confident prose about things that aren't there. The LLM's job comes later —
// phrasing a confirmed finding, and proposing what to do about it.
//
// Every insight carries `evidence` (the entity ids it is about) so the UI can
// jump straight to the relevant subgraph, and a `suggestion` describing the
// action worth commissioning.
import type { GraphAnalysis } from './load';
import { brokerageScore } from './centrality';
import { scoreSurprisingLinks, predictMissingLinks, findBridges } from './surprise';
import { components } from './model';

export type InsightKind =
  | 'broker'
  | 'unlikely_relation'
  | 'missing_link'
  | 'orphan'
  | 'isolated_cluster'
  | 'emerging_hub'
  | 'stale_hub'
  | 'thin_evidence'
  | 'type_outlier'
  | 'dominant_cluster';

export type SuggestedAction =
  | 'research'
  | 'ask'
  | 'workflow'
  | 'briefing'
  | 'review'
  | 'canvas'
  | 'confirm_link'
  | 'reject_link';

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  detail: string;
  /** 0..1. Drives ordering and the visual weight on the dashboard. */
  score: number;
  entityIds: string[];
  action: SuggestedAction;
  /** Pre-filled prompt/topic for the action, so commissioning is one click. */
  actionLabel: string;
  actionPayload: string;
}

const DAY_MS = 86_400_000;

function nameOf(a: GraphAnalysis, id: string): string {
  return a.index.byId.get(id)?.name ?? id;
}

/** Entities in a broker position between clusters. */
function detectBrokers(a: GraphAnalysis): Insight[] {
  const bridges = findBridges({ index: a.index, membership: a.community.membership }, { limit: 6 });
  return bridges
    .filter((b) => b.communitiesJoined.length >= 2)
    .map((b) => {
      const name = nameOf(a, b.id);
      const score = Math.min(1, brokerageScore(b.id, a.centrality, a.index) * 12);
      return {
        id: `broker:${b.id}`,
        kind: 'broker' as const,
        title: `${name} connects ${b.communitiesJoined.length} separate parts of your graph`,
        detail:
          `${name} is the link between ${b.communitiesJoined.length} otherwise separate clusters. ` +
          `Whatever it touches propagates across domains — and if this entity is wrong or thin, so is the connection between them.`,
        score,
        entityIds: [b.id],
        action: 'research' as const,
        actionLabel: `Deep dive on ${name}`,
        actionPayload: `${name} — full profile, affiliations, and why it connects otherwise unrelated areas`,
      };
    });
}

/** Connections that exist but look like they shouldn't. */
async function detectUnlikelyRelations(a: GraphAnalysis): Promise<Insight[]> {
  const links = await scoreSurprisingLinks(
    { index: a.index, membership: a.community.membership, embeddings: a.embeddings },
    { maxHops: 2, limit: 8, minScore: 0.12 },
  );
  return links.map((l) => {
    const an = nameOf(a, l.a);
    const bn = nameOf(a, l.b);
    return {
      id: `unlikely:${l.a}:${l.b}`,
      kind: 'unlikely_relation' as const,
      title: `Unexpected: ${an} ↔ ${bn}`,
      detail: `${an} and ${bn} are ${l.hops === 1 ? 'directly connected' : `${l.hops} hops apart`} — ${l.reasons.join(', ')}.`,
      score: Math.min(1, l.score * 2.5),
      entityIds: [l.a, l.b],
      action: 'ask' as const,
      actionLabel: 'Ask jkai why',
      actionPayload: `In my intel graph, ${an} and ${bn} are connected but sit in different clusters and share little context. What is the real relationship between them, and is it significant?`,
    };
  });
}

/** Pairs that ought to be linked and aren't. */
function detectMissingLinks(a: GraphAnalysis): Insight[] {
  const preds = predictMissingLinks(
    { index: a.index, membership: a.community.membership, suppressedPairs: a.suppressedPairs },
    { limit: 6, minScore: 0.9 },
  );
  return preds.map((p) => {
    const an = nameOf(a, p.a);
    const bn = nameOf(a, p.b);
    return {
      id: `missing:${p.a}:${p.b}`,
      kind: 'missing_link' as const,
      title: `${an} and ${bn} are probably connected`,
      detail: `${p.reason}. Either the extractor missed the relationship, or it is real and undocumented.`,
      score: Math.min(1, p.score / 3),
      entityIds: [p.a, p.b],
      // Records the relationship rather than asking jkai about it. This was
      // 'ask', which meant the button labelled "Confirm the link" deep-linked
      // to chat with a prefilled question and the graph learned nothing.
      action: 'confirm_link' as const,
      actionLabel: 'Confirm the link',
      actionPayload: `Confirmed from a predicted link — ${an} and ${bn} share ${p.sharedNeighbours.length} connections`,
    };
  });
}

/** Entities with no relationships at all — extraction dead ends. */
function detectOrphans(a: GraphAnalysis): Insight[] {
  const orphans = a.index.ids.filter((id) => (a.index.degree.get(id) ?? 0) === 0);
  if (orphans.length < 3) return [];
  const sample = orphans
    .map((id) => a.index.byId.get(id)!)
    .sort((x, y) => y.noteCount - x.noteCount)
    .slice(0, 8);
  return [
    {
      id: 'orphans',
      kind: 'orphan',
      title: `${orphans.length} entities have no connections`,
      detail:
        `These were extracted but never linked to anything: ${sample.map((n) => n.name).join(', ')}` +
        `${orphans.length > sample.length ? `, and ${orphans.length - sample.length} more` : ''}. ` +
        `They add nothing to the graph until something connects them.`,
      score: Math.min(0.75, orphans.length / Math.max(1, a.index.ids.length) + 0.2),
      entityIds: sample.map((n) => n.id),
      action: 'review',
      actionLabel: 'Review unconnected entities',
      actionPayload: '/jkai/intel/review',
    },
  ];
}

/** A whole component sitting apart from the main graph. */
function detectIsolatedClusters(a: GraphAnalysis): Insight[] {
  const comps = components(a.index);
  if (comps.length < 2) return [];
  const main = comps[0].length;
  return comps
    .slice(1)
    .filter((c) => c.length >= 3)
    .slice(0, 3)
    .map((c) => {
      const names = c.map((id) => nameOf(a, id));
      return {
        id: `isolated:${c[0]}`,
        kind: 'isolated_cluster' as const,
        title: `A ${c.length}-entity cluster is completely separate from the rest`,
        detail:
          `${names.slice(0, 5).join(', ')}${c.length > 5 ? ` and ${c.length - 5} more` : ''} form an island ` +
          `with no path to your main graph of ${main} entities. Worth knowing whether that isolation is real.`,
        score: Math.min(0.8, 0.3 + c.length / 40),
        entityIds: c.slice(0, 12),
        action: 'research' as const,
        actionLabel: 'Research the connection',
        actionPayload: `How do ${names.slice(0, 3).join(', ')} relate to my wider work in UK education data and policy?`,
      };
    });
}

/**
 * Well-connected entities that arrived recently.
 *
 * Recency is measured RELATIVE to the rest of the graph, not against a fixed
 * 30-day window. A knowledge graph built over a few weeks has every entity
 * inside any absolute window, so the absolute test fired on the whole graph and
 * called the largest hub "emerging" — the opposite of the intended signal.
 * "Newest fifth of the graph" holds its meaning however old the graph is.
 */
function detectEmergingHubs(a: GraphAnalysis, now: number): Insight[] {
  const nodes = a.index.ids.map((id) => a.index.byId.get(id)!).filter((n) => n.createdAt > 0);
  if (nodes.length < 10) return [];

  const times = nodes.map((n) => n.createdAt).sort((x, y) => x - y);
  const recentCutoff = times[Math.floor(times.length * 0.8)];
  // Degree threshold is also relative: the 90th percentile of the graph, with a
  // floor so a tiny graph doesn't flag everything.
  const degrees = nodes.map((n) => a.index.degree.get(n.id) ?? 0).sort((x, y) => x - y);
  const degreeCutoff = Math.max(4, degrees[Math.floor(degrees.length * 0.9)]);

  return nodes
    .filter((n) => n.createdAt >= recentCutoff)
    .map((n) => ({ node: n, degree: a.index.degree.get(n.id) ?? 0 }))
    .filter((x) => x.degree >= degreeCutoff)
    .sort((x, y) => y.degree - x.degree)
    .slice(0, 4)
    .map(({ node, degree }) => ({
      id: `emerging:${node.id}`,
      kind: 'emerging_hub' as const,
      title: `${node.name} is new and already well connected`,
      detail:
        `${node.name} is among the most recently added entities, yet already has ${degree} connections — ` +
        `top-decile for this graph. Something is happening around it.`,
      score: Math.min(0.9, 0.35 + degree / 25),
      entityIds: [node.id],
      action: 'briefing' as const,
      actionLabel: `Brief me on ${node.name}`,
      actionPayload: `Everything my intel graph knows about ${node.name}, and what changed recently`,
    }));
}

/** Important entities nobody has mentioned in a long time. */
function detectStaleHubs(a: GraphAnalysis, now: number): Insight[] {
  const stale = a.index.ids
    .map((id) => ({ node: a.index.byId.get(id)!, degree: a.index.degree.get(id) ?? 0 }))
    .filter((x) => x.degree >= 5 && x.node.lastSeenAt > 0 && now - x.node.lastSeenAt > 90 * DAY_MS)
    .sort((x, y) => x.node.lastSeenAt - y.node.lastSeenAt)
    .slice(0, 3);

  return stale.map(({ node, degree }) => ({
    id: `stale:${node.id}`,
    kind: 'stale_hub' as const,
    title: `${node.name} is well-connected but has gone quiet`,
    detail:
      `${degree} connections, but nothing new in ${Math.round((now - node.lastSeenAt) / DAY_MS)} days. ` +
      `Either it has genuinely dropped away, or your picture of it is going stale.`,
    score: Math.min(0.7, 0.25 + degree / 30),
    entityIds: [node.id],
    action: 'research' as const,
    actionLabel: `Refresh ${node.name}`,
    actionPayload: `Latest developments on ${node.name} — what has changed in the last three months?`,
  }));
}

/** Entities the graph is asserting on almost no evidence. */
function detectThinEvidence(a: GraphAnalysis): Insight[] {
  const thin = a.index.ids
    .map((id) => ({ node: a.index.byId.get(id)!, degree: a.index.degree.get(id) ?? 0 }))
    .filter((x) => x.degree >= 4 && x.node.noteCount <= 1 && !x.node.confirmed)
    .sort((x, y) => y.degree - x.degree)
    .slice(0, 4);

  return thin.map(({ node, degree }) => ({
    id: `thin:${node.id}`,
    kind: 'thin_evidence' as const,
    title: `${node.name} has ${degree} connections from a single source`,
    detail:
      `Everything the graph believes about ${node.name} comes from one note. ` +
      `That is a single point of failure for ${degree} relationships.`,
    score: Math.min(0.65, 0.2 + degree / 30),
    entityIds: [node.id],
    action: 'research' as const,
    actionLabel: `Corroborate ${node.name}`,
    actionPayload: `Independent corroboration for ${node.name} — who else reports on this and do they agree?`,
  }));
}

/** A type holding so few entities it is probably an extraction artefact. */
function detectTypeOutliers(a: GraphAnalysis): Insight[] {
  const byType = new Map<string, string[]>();
  for (const id of a.index.ids) {
    const t = a.index.byId.get(id)!.typeName;
    const list = byType.get(t);
    if (list) list.push(id);
    else byType.set(t, [id]);
  }
  const tiny = [...byType.entries()].filter(([, ids]) => ids.length <= 2);
  if (tiny.length < 3) return [];

  return [
    {
      id: 'type-outliers',
      kind: 'type_outlier',
      title: `${tiny.length} entity types hold two entities or fewer`,
      detail:
        `${tiny.map(([t, ids]) => `${t} (${ids.length})`).join(', ')}. ` +
        `Over-specific types fragment the taxonomy and make type filters useless — these are candidates for merging.`,
      score: Math.min(0.6, 0.2 + tiny.length / 20),
      entityIds: tiny.flatMap(([, ids]) => ids).slice(0, 12),
      action: 'review',
      actionLabel: 'Tidy entity types',
      // /jkai/intel/types has never existed — this button 404'd. Type
      // governance (proposed types, merging one type into another) lives on the
      // quality page.
      actionPayload: '/jkai/intel/quality#types',
    },
  ];
}

/** One cluster swallowing the graph means the clustering says little. */
function detectDominantCluster(a: GraphAnalysis): Insight[] {
  const total = a.index.ids.length;
  if (total < 20) return [];
  const largest = a.community.communities.get(0)?.length ?? 0;
  if (largest / total < 0.7) return [];
  return [
    {
      id: 'dominant-cluster',
      kind: 'dominant_cluster',
      title: `${Math.round((largest / total) * 100)}% of your graph is one undifferentiated cluster`,
      detail:
        `Modularity is ${a.community.modularity.toFixed(2)} — the graph has not separated into meaningful communities. ` +
        `Usually this means relationships are too generic, or too many entities hang off a handful of hubs.`,
      score: 0.55,
      entityIds: [],
      action: 'review',
      actionLabel: 'Review relationship quality',
      actionPayload: '/jkai/intel/review',
    },
  ];
}

/**
 * Run every detector and return findings ranked by score.
 *
 * `now` is injected so the time-sensitive detectors are testable.
 */
export async function generateInsights(a: GraphAnalysis, now = Date.now()): Promise<Insight[]> {
  const all = [
    ...detectBrokers(a),
    ...(await detectUnlikelyRelations(a)),
    ...detectMissingLinks(a),
    ...detectOrphans(a),
    ...detectIsolatedClusters(a),
    ...detectEmergingHubs(a, now),
    ...detectStaleHubs(a, now),
    ...detectThinEvidence(a),
    ...detectTypeOutliers(a),
    ...detectDominantCluster(a),
  ];

  // Deduplicate by id — a broker can also be an emerging hub, and the higher
  // score wins rather than the dashboard showing the same entity twice.
  const best = new Map<string, Insight>();
  for (const i of all) {
    const prev = best.get(i.id);
    if (!prev || i.score > prev.score) best.set(i.id, i);
  }

  return [...best.values()].sort((x, y) => y.score - x.score);
}
