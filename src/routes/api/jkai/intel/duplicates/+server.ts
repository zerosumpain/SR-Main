// Duplicate entities — detection, and the merge that fixes them.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  findDuplicates,
  mergeEntities,
  unmergeEntity,
  autoMergeDuplicates,
  mergeEntityTypes,
} from '$lib/jkai/intel/resolve/merge';
import { AUTO_MERGE_THRESHOLD } from '$lib/jkai/intel/resolve/match';

export const GET: RequestHandler = async ({ url }) => {
  const minConfidence = Math.min(Math.max(Number(url.searchParams.get('min') ?? 0.35), 0), 1);
  const reports = await findDuplicates(minConfidence);

  return json({
    threshold: AUTO_MERGE_THRESHOLD,
    total: reports.length,
    autoMergeable: reports.filter((r) => r.autoMergeable).length,
    duplicates: reports.slice(0, 200).map((r) => ({
      confidence: Number(r.candidate.confidence.toFixed(3)),
      signals: r.candidate.signals,
      reason: r.candidate.reason,
      autoMergeable: r.autoMergeable,
      keep: {
        id: r.keep.id,
        name: r.keep.name,
        type: r.keep.typeName,
        degree: r.keep.degree,
        noteCount: r.keep.noteCount,
      },
      merge: {
        id: r.merge.id,
        name: r.merge.name,
        type: r.merge.typeName,
        degree: r.merge.degree,
        noteCount: r.merge.noteCount,
      },
    })),
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? 'merge');

  if (action === 'merge') {
    const keepId = String(body.keepId ?? '');
    const mergeId = String(body.mergeId ?? '');
    if (!keepId || !mergeId) throw error(400, 'keepId and mergeId are required');
    try {
      return json({ ok: true, result: await mergeEntities(keepId, mergeId) });
    } catch (err) {
      throw error(400, err instanceof Error ? err.message : 'merge failed');
    }
  }

  if (action === 'unmerge') {
    const entityId = String(body.entityId ?? '');
    if (!entityId) throw error(400, 'entityId is required');
    await unmergeEntity(entityId);
    return json({ ok: true });
  }

  if (action === 'auto') {
    const threshold = Number(body.threshold ?? AUTO_MERGE_THRESHOLD);
    const dryRun = Boolean(body.dryRun);
    return json({ ok: true, result: await autoMergeDuplicates(threshold, { dryRun }) });
  }

  if (action === 'merge-types') {
    const fromTypeId = String(body.fromTypeId ?? '');
    const intoTypeId = String(body.intoTypeId ?? '');
    if (!fromTypeId || !intoTypeId) throw error(400, 'fromTypeId and intoTypeId are required');
    return json({ ok: true, moved: await mergeEntityTypes(fromTypeId, intoTypeId) });
  }

  throw error(400, `unknown action "${action}"`);
};
