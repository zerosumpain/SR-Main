// Automated insights — what the graph noticed without being asked.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { generateInsights } from '$lib/jkai/intel/analytics/insights';
import { scoreSurprisingLinks, predictMissingLinks } from '$lib/jkai/intel/analytics/surprise';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 60);
  const kind = url.searchParams.get('kind');

  const analysis = await getGraphAnalysis();
  const { index, community, embeddings } = analysis;

  const decorate = (ids: string[]) =>
    ids
      .map((id) => index.byId.get(id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .map((n) => ({ id: n.id, name: n.name, type: n.typeName, icon: n.icon, color: n.color }));

  let insights = generateInsights(analysis);
  if (kind) insights = insights.filter((i) => i.kind === kind);

  const surprising = scoreSurprisingLinks(
    { index, membership: community.membership, embeddings },
    { maxHops: 3, limit: 20, minScore: 0.08 },
  );

  const predicted = predictMissingLinks(
    { index, membership: community.membership },
    { limit: 15, minScore: 0.8 },
  );

  return json({
    insights: insights.slice(0, limit).map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      detail: i.detail,
      score: Number(i.score.toFixed(3)),
      action: i.action,
      actionLabel: i.actionLabel,
      actionPayload: i.actionPayload,
      entities: decorate(i.entityIds),
    })),
    unlikelyRelations: surprising.map((l) => ({
      score: Number(l.score.toFixed(3)),
      hops: l.hops,
      reasons: l.reasons,
      crossCommunity: l.crossCommunity,
      sharedNeighbours: l.sharedNeighbours,
      semanticDistance: l.semanticDistance === null ? null : Number(l.semanticDistance.toFixed(3)),
      entities: decorate([l.a, l.b]),
    })),
    predictedLinks: predicted.map((p) => ({
      score: Number(p.score.toFixed(2)),
      reason: p.reason,
      entities: decorate([p.a, p.b]),
      via: decorate(p.sharedNeighbours.slice(0, 5)),
    })),
    computedAt: analysis.computedAt,
  });
};
