// The cluster roster — named, durable, and describable.
//
//   GET                             the roster, ranked, with the cluster-level map
//   POST { action: 'recalculate' }  re-tune, re-detect, reconcile, return the roster
//   POST { action: 'rename', … }    name a cluster, or clear the name
//   POST { action: 'narrate', key } write (or rewrite) a cluster's narrative
//
// The roster is deliberately NOT part of /network: that route ships the entity
// graph trimmed to its 600 most central nodes, and cluster-level questions are
// about all 9,000. Keeping them apart is what lets the cluster surfaces describe
// the whole graph while the entity views stay a readable size.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { buildClusterRoster, recalculateClusterRoster } from '$lib/jkai/intel/cluster-roster';
import { renameCluster, loadClusters, setClusterNarrative } from '$lib/jkai/intel/cluster-store';
import { assembleClusterBriefContext, generateBrief } from '$lib/jkai/intel/brief';
import type { StoredCluster } from '$lib/jkai/intel/analytics/cluster-identity';

export const GET: RequestHandler = async ({ url }) => {
  const requested = url.searchParams.get('resolution');
  const resolution = requested === null ? undefined : Number(requested);
  if (resolution !== undefined && (!Number.isFinite(resolution) || resolution <= 0)) {
    throw error(400, 'resolution must be a positive number');
  }
  const analysis = await getGraphAnalysis();
  return json(await buildClusterRoster(analysis, resolution));
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  if (action === 'recalculate') {
    const requested = body.resolution === undefined ? undefined : Number(body.resolution);
    if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
      throw error(400, 'resolution must be a positive number');
    }
    return json(await recalculateClusterRoster(requested));
  }

  if (action === 'rename') {
    const key = String(body.key ?? '').trim();
    if (!key) throw error(400, 'key is required');
    const raw = body.name === null || body.name === undefined ? '' : String(body.name);
    if (raw.length > 120) throw error(400, 'a cluster name must be 120 characters or fewer');
    const updated: StoredCluster | null = await renameCluster(key, raw);
    if (!updated) throw error(404, 'no such cluster');
    return json({
      key: updated.key,
      name: updated.name,
      label: updated.name ?? updated.autoLabel,
      namedAt: updated.namedAt,
    });
  }

  if (action === 'narrate') {
    const key = String(body.key ?? '').trim();
    if (!key) throw error(400, 'key is required');

    const analysis = await getGraphAnalysis();
    const roster = await buildClusterRoster(analysis);
    const view = roster.clusters.find((c) => c.key === key);
    if (!view) throw error(404, 'no such cluster');

    const stored = (await loadClusters()).find((c) => c.key === key);
    if (!stored) throw error(404, 'no such cluster');

    // Served from store unless the membership has moved or a rewrite is asked
    // for. A narrative costs a model call and does not go stale with time — only
    // when the cluster it describes stops being the same set of entities.
    if (stored.narrative && !view.narrativeStale && body.force !== true) {
      return json({
        key,
        narrative: stored.narrative,
        narrativeAt: stored.narrativeAt,
        cached: true,
      });
    }

    const ranked = [...stored.members].sort(
      (a, b) => (analysis.centrality.pagerank.get(b) ?? 0) - (analysis.centrality.pagerank.get(a) ?? 0),
    );

    const context = await assembleClusterBriefContext(ranked, {
      label: view.label,
      size: view.size,
      types: view.composition.types,
      sources: view.composition.sources,
      sourceless: view.composition.sourceless,
      noteTotal: view.composition.noteTotal,
      diversity: view.composition.diversity,
      span: view.span,
      bridges: view.bridges.map((b) => ({ name: b.name, reaches: b.reaches })),
    });

    const result = await generateBrief(context);
    // Persisted against the membership it was written for, so the card can tell
    // "written about this cluster" from "written about what this cluster was".
    await setClusterNarrative(key, result.markdown, stored.members);

    return json({
      key,
      narrative: result.markdown,
      narrativeAt: new Date().toISOString(),
      cached: false,
      citations: result.citations,
      droppedMarkers: result.droppedMarkers,
    });
  }

  throw error(400, `unknown action: ${action || '(none)'}`);
};
