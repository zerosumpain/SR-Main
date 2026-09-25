// "How is X connected to Y?" — the question a link chart exists to answer.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { findPaths } from '$lib/jkai/intel/analytics/paths';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const GET: RequestHandler = async (event) => {
  const { url } = event;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) throw error(400, 'from and to are required');

  const maxHops = Math.min(Math.max(Number(url.searchParams.get('maxHops') ?? 4), 1), 6);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 3), 1), 6);

  // The reader's scoped graph: an endpoint outside it is the same 404 as an
  // unknown one, and no path is routed through another space's entities.
  const { index } = await getGraphAnalysis(false, { scope: await resolveRequestScope(event) });
  if (!index.byId.has(from)) throw error(404, 'unknown source entity');
  if (!index.byId.has(to)) throw error(404, 'unknown target entity');

  const paths = findPaths(index, from, to, { maxHops, limit });

  return json({
    from: { id: from, name: index.byId.get(from)!.name },
    to: { id: to, name: index.byId.get(to)!.name },
    found: paths.length > 0,
    paths: paths.map((p) => ({
      hops: p.hops,
      nodes: p.nodes.map((id) => {
        const n = index.byId.get(id)!;
        return { id, name: n.name, type: n.typeName, icon: n.icon, color: n.color };
      }),
      steps: p.steps.map((s) => ({
        from: s.from,
        to: s.to,
        // The clearest label available for how these two are connected.
        label: s.edges[0]?.label ?? s.edges[0]?.type ?? 'related to',
        type: s.edges[0]?.type ?? 'related_to',
        edgeCount: s.edges.length,
      })),
    })),
  });
};
