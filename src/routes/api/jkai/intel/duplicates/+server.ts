// Duplicate entities — detection, and the merge that fixes them.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  sweepDuplicates,
  mergeEntities,
  unmergeEntity,
  autoMergeDuplicates,
  mergeEntityTypes,
} from '$lib/jkai/intel/resolve/merge';
import { AUTO_MERGE_THRESHOLD } from '$lib/jkai/intel/resolve/match';
import { recordDecision, clearDecision } from '$lib/jkai/intel/resolve/decisions';
import {
  adjudicateCandidates,
  ADJUDICATION_BAND,
  ADJUDICATION_NIGHTLY_LIMIT,
} from '$lib/jkai/intel/resolve/adjudicate';

/** Rows sent to the page. The sweep itself is unbounded; the payload is not. */
const PAGE_LIMIT = 200;

export const GET: RequestHandler = async ({ url }) => {
  const minConfidence = Math.min(Math.max(Number(url.searchParams.get('min') ?? 0.35), 0), 1);
  // The ruled-out view. It exists because a filter that hides its own decisions
  // is indistinguishable from one that is broken — the source filter on this
  // same subsystem was trusted for weeks while it was silently wrong.
  const includeRuledOut = url.searchParams.get('ruledOut') === '1';

  // `listProposedTypes` went with the taxonomy panel: proposals are governed at
  // /jkai/intel/categories now, and returning them here was one query per load
  // for a list nothing rendered.
  const sweep = await sweepDuplicates(minConfidence, { includeRuledOut });
  const reports = includeRuledOut ? sweep.reports.filter((r) => r.decision) : sweep.reports;

  return json({
    threshold: AUTO_MERGE_THRESHOLD,
    band: ADJUDICATION_BAND,
    total: reports.length,
    autoMergeable: reports.filter((r) => r.autoMergeable).length,
    // What the sweep DID, not just what it is showing. `ruledOut` is the number
    // of pairs a human has already answered; `semanticPairs` is how many
    // candidates the vector pass contributed that no shared word could have.
    ruledOut: sweep.ruledOut,
    adjudicatedApart: sweep.adjudicatedApart,
    semanticPairs: sweep.semanticPairs,
    seriesVariants: sweep.seriesVariants,
    undecidedInBand: reports.filter(
      (r) =>
        !r.decision &&
        r.candidate.confidence >= ADJUDICATION_BAND.min &&
        r.candidate.confidence <= ADJUDICATION_BAND.max,
    ).length,
    duplicates: reports.slice(0, PAGE_LIMIT).map((r) => ({
      confidence: Number(r.candidate.confidence.toFixed(3)),
      signals: r.candidate.signals,
      reason: r.candidate.reason,
      autoMergeable: r.autoMergeable,
      decision: r.decision
        ? {
            verdict: r.decision.verdict,
            decidedBy: r.decision.decidedBy,
            rationale: r.decision.rationale,
            model: r.decision.model,
            at: r.decision.createdAt,
          }
        : null,
      keep: {
        id: r.keep.id,
        name: r.keep.name,
        type: r.keep.typeName,
        degree: r.keep.degree,
        noteCount: r.keep.noteCount,
        aliases: (r.keep.aliases ?? []).slice(0, 6),
        summary: r.keep.summary,
      },
      merge: {
        id: r.merge.id,
        name: r.merge.name,
        type: r.merge.typeName,
        degree: r.merge.degree,
        noteCount: r.merge.noteCount,
        aliases: (r.merge.aliases ?? []).slice(0, 6),
        summary: r.merge.summary,
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

  // A verdict that OUTLIVES the tab. "Dismiss" used to write to a client-side
  // Set, so every rejection this graph has ever received was thrown away and
  // re-proposed on the next sweep.
  if (action === 'not-duplicate' || action === 'same') {
    const aId = String(body.aId ?? body.keepId ?? '');
    const bId = String(body.bId ?? body.mergeId ?? '');
    if (!aId || !bId) throw error(400, 'aId and bId are required');
    await recordDecision({
      aId,
      bId,
      verdict: action === 'same' ? 'same' : 'different',
      decidedBy: 'human',
      confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : null,
      verdictConfidence: 1,
      signals: Array.isArray(body.signals) ? (body.signals as string[]).map(String) : [],
      rationale: typeof body.rationale === 'string' ? body.rationale.slice(0, 400) : null,
      aName: typeof body.aName === 'string' ? body.aName : null,
      bName: typeof body.bName === 'string' ? body.bName : null,
    });
    return json({ ok: true });
  }

  /** Put a pair back in the queue — the undo for the two actions above. */
  if (action === 'undecide') {
    const aId = String(body.aId ?? '');
    const bId = String(body.bId ?? '');
    if (!aId || !bId) throw error(400, 'aId and bId are required');
    await clearDecision(aId, bId);
    return json({ ok: true });
  }

  // Read the evidence and rule on the undecided middle. Never merges: it writes
  // decision rows, which move a pair's score and can carry it over the existing
  // auto-merge threshold — the threshold, its chain guard and its nightly cap
  // are all unchanged.
  if (action === 'adjudicate') {
    const min = Math.min(Math.max(Number(body.min ?? ADJUDICATION_BAND.min), 0), 1);
    const limitRaw = Number(body.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(ADJUDICATION_NIGHTLY_LIMIT, Math.max(1, Math.round(limitRaw)))
      : ADJUDICATION_NIGHTLY_LIMIT;
    const only = Array.isArray(body.pairs)
      ? new Set((body.pairs as Array<Record<string, unknown>>).map((p) => `${p.aId}|${p.bId}`))
      : null;

    const sweep = await sweepDuplicates(min);
    const reports = only
      ? sweep.reports.filter(
          (r) => only.has(`${r.keep.id}|${r.merge.id}`) || only.has(`${r.merge.id}|${r.keep.id}`),
        )
      : sweep.reports;

    const run = await adjudicateCandidates(reports, {
      limit,
      // An explicit request about named pairs is a request, not a sweep: it may
      // re-ask a question the model has already answered. A blanket run may not.
      force: Boolean(only),
    });
    return json({ ok: true, result: run });
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
