import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { buildClusterRoster } from '$lib/jkai/intel/cluster-roster';
import { loadClusters } from '$lib/jkai/intel/cluster-store';

/**
 * Members shown in the table. The rail card shows six; this page is where the
 * rest of a two-hundred-entity cluster is meant to be readable, so the cap is
 * generous rather than absent — a cluster is occasionally very large, and a
 * table of four hundred rows is not more legible than one of two hundred.
 */
const MAX_MEMBERS = 200;

export const load: PageServerLoad = async ({ params }) => {
  const analysis = await getGraphAnalysis();
  const roster = await buildClusterRoster(analysis);
  const cluster = roster.clusters.find((c) => c.key === params.key);
  if (!cluster) throw error(404, 'no such cluster');

  const stored = (await loadClusters()).find((c) => c.key === params.key);

  const now = Date.now();
  const { index, centrality } = analysis;
  const { entityRelevance } = await import('$lib/jkai/intel/staleness');

  // The full membership, which the roster's card preview deliberately does not
  // carry — six names is a card, and this is the page you open to see the rest.
  const members = (stored?.members ?? [])
    .map((id) => {
      const node = index.byId.get(id);
      if (!node) return null;
      return {
        id: node.id,
        name: node.name,
        type: node.typeName,
        icon: node.icon,
        degree: index.degree.get(id) ?? 0,
        noteCount: node.noteCount,
        sources: node.sources,
        importance: centrality.pagerank.get(id) ?? 0,
        relevance: Number(
          entityRelevance(
            { confidence: node.confidenceScore, evidenceAt: node.evidenceAt || node.lastSeenAt },
            now,
          ).score.toFixed(3),
        ),
        evidenceAt: node.evidenceAt || node.lastSeenAt || null,
      };
    })
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .sort((a, b) => b.importance - a.importance);

  // Evidence per month across the whole cluster, dated by OBSERVATION. Using the
  // ingest clock would put every email-derived member on the night its sweep
  // ran, which is one tall bar and no shape at all.
  const histogram = new Map<string, number>();
  for (const member of members) {
    if (!member.evidenceAt) continue;
    const month = new Date(member.evidenceAt).toISOString().slice(0, 7);
    histogram.set(month, (histogram.get(month) ?? 0) + 1);
  }

  // Sibling clusters, so "what is this next to" is answerable from here.
  const neighbours = roster.clusterGraph.links
    .filter((l) => l.source === params.key || l.target === params.key)
    .map((l) => {
      const otherKey = l.source === params.key ? l.target : l.source;
      const other = roster.clusters.find((c) => c.key === otherKey);
      return other ? { key: other.key, label: other.label, colourIndex: other.colourIndex, count: l.count } : null;
    })
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .sort((a, b) => b.count - a.count);

  return {
    cluster,
    members: members.slice(0, MAX_MEMBERS),
    memberTotal: members.length,
    histogram: [...histogram.entries()].sort().map(([month, count]) => ({ month, count })),
    neighbours,
  };
};
