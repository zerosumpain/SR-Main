// Duplicate entities — detection, and the merge that fixes them.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  findDuplicates,
  mergeEntities,
  unmergeEntity,
  autoMergeDuplicates,
  mergeEntityTypes,
  listProposedTypes,
} from '$lib/jkai/intel/resolve/merge';
import { AUTO_MERGE_THRESHOLD } from '$lib/jkai/intel/resolve/match';

export const GET: RequestHandler = async ({ url }) => {
  const minConfidence = Math.min(Math.max(Number(url.searchParams.get('min') ?? 0.35), 0), 1);
  const [reports, proposedTypes] = await Promise.all([
    findDuplicates(minConfidence),
    listProposedTypes(),
  ]);

  return json({
    threshold: AUTO_MERGE_THRESHOLD,
    proposedTypes,
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

  // Dispose of a reviewed batch in one request. The per-pair endpoint above
  // meant clearing a review queue was one round trip per pair, which is the
  // bulk of the burden in a mailbox-fed graph — a sweep can surface dozens of
  // the same person. Each pair is applied independently so one stale pair
  // (already merged by another tab, or by the post-sweep auto-merge) cannot
  // fail the whole batch.
  if (action === 'merge-batch') {
    const raw = Array.isArray(body.pairs) ? body.pairs : [];
    if (!raw.length) throw error(400, 'pairs is required');
    if (raw.length > 200) throw error(400, 'at most 200 pairs per batch');

    const merged: Array<{ keepId: string; mergeId: string }> = [];
    const failed: Array<{ keepId: string; mergeId: string; reason: string }> = [];

    for (const entry of raw) {
      const pair = entry as Record<string, unknown>;
      const keepId = String(pair?.keepId ?? '');
      const mergeId = String(pair?.mergeId ?? '');
      if (!keepId || !mergeId) {
        failed.push({ keepId, mergeId, reason: 'keepId and mergeId are required' });
        continue;
      }
      try {
        await mergeEntities(keepId, mergeId);
        merged.push({ keepId, mergeId });
      } catch (err) {
        failed.push({ keepId, mergeId, reason: err instanceof Error ? err.message : 'merge failed' });
      }
    }

    return json({ ok: true, merged: merged.length, failed, pairs: merged });
  }

  if (action === 'unmerge') {
    const entityId = String(body.entityId ?? '');
    if (!entityId) throw error(400, 'entityId is required');
    await unmergeEntity(entityId);
    return json({ ok: true });
  }

  if (action === 'auto') {
    // Clamped, and never below AUTO_MERGE_THRESHOLD. Taken raw, a body of
    // `{"action":"auto","threshold":0}` — or a NaN from any non-numeric value —
    // would merge every candidate pair in the graph in one unrecoverable sweep.
    const raw = Number(body.threshold);
    const threshold = Number.isFinite(raw)
      ? Math.min(1, Math.max(AUTO_MERGE_THRESHOLD, raw))
      : AUTO_MERGE_THRESHOLD;
    const dryRun = Boolean(body.dryRun);
    return json({ ok: true, result: await autoMergeDuplicates(threshold, { dryRun }) });
  }

  // Proposed-type governance. Extraction now HOLDS a model-coined type rather
  // than admitting it, so these are how a proposal becomes real or goes away.
  if (action === 'admit-type' || action === 'reject-type') {
    const typeId = String(body.typeId ?? '');
    if (!typeId) throw error(400, 'typeId is required');
    const { admitProposedType, rejectProposedType } = await import('$lib/jkai/intel/resolve/merge');
    return json({
      ok: true,
      result:
        action === 'admit-type'
          ? await admitProposedType(typeId)
          : await rejectProposedType(typeId, typeof body.intoTypeId === 'string' ? body.intoTypeId : undefined),
    });
  }

  if (action === 'merge-types') {
    const fromTypeId = String(body.fromTypeId ?? '');
    const intoTypeId = String(body.intoTypeId ?? '');
    if (!fromTypeId || !intoTypeId) throw error(400, 'fromTypeId and intoTypeId are required');
    return json({ ok: true, moved: await mergeEntityTypes(fromTypeId, intoTypeId) });
  }

  throw error(400, `unknown action "${action}"`);
};
