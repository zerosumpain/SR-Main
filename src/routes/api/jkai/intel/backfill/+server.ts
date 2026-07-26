import { json, error, type RequestHandler } from '@sveltejs/kit';
import { backfillIntelExtraction, isAutoExtractEnabled, type AutoKind } from '$lib/jkai/intel/auto-extract';

/**
 * Sweep the existing /drive + research corpus into the intel graph. Owner-gated
 * by hooks (the whole /api/jkai tree is). Auto-extraction only fires on new
 * ingest, so anything indexed before it existed needs this once.
 *
 * Sequential and idempotent: re-running only touches items whose content
 * changed. `limit` caps one run; `kinds` narrows the sweep.
 */
export const POST: RequestHandler = async ({ request }) => {
  if (!isAutoExtractEnabled()) {
    throw error(409, 'Intel auto-extraction is disabled (INTEL_AUTO_EXTRACT=0).');
  }

  const body = (await request.json().catch(() => ({}))) as { kinds?: string[]; limit?: number };
  const valid: AutoKind[] = ['file', 'research'];
  const kinds = Array.isArray(body.kinds)
    ? (body.kinds.filter((k): k is AutoKind => valid.includes(k as AutoKind)))
    : undefined;
  if (kinds && kinds.length === 0) throw error(400, 'kinds must contain "file" and/or "research"');

  const progress = await backfillIntelExtraction({
    kinds,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  });

  return json(progress);
};
