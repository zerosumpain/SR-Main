// Sweep the existing /drive + research corpus into the intel graph. Auto-
// extraction only fires on NEW ingest, so anything indexed before it existed
// needs this once. Sequential and idempotent (content-hash gated), so it is
// safe to re-run and to drive in batches: loop POST until `scanned` is 0.
//
// Auth mirrors /api/deepdive/reindex-facts: owner session from a browser, OR a
// MAINTENANCE_SECRET header for a one-off run from the box, where a long pass
// has no user session to carry.
//
//   GET             → { enabled, files, research, alreadyExtracted }
//   POST { kinds?, limit? } → run a pass, returns progress counters
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';
import { backfillIntelExtraction, isAutoExtractEnabled, type AutoKind } from '$lib/jkai/intel/auto-extract';

const VALID_KINDS: AutoKind[] = ['file', 'research'];

export const GET: RequestHandler = async ({ locals, request }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) return json({ error: 'unauthorized' }, { status: 401 });

  const { rows } = await db.execute(sql`
    SELECT
      (SELECT count(DISTINCT file_id) FROM file_embeddings) AS files,
      (SELECT count(*) FROM research_session WHERE report IS NOT NULL) AS research,
      (SELECT count(*) FROM intel_notes WHERE metadata->>'autoKind' IS NOT NULL) AS already_extracted,
      (SELECT count(*) FROM intel_entities WHERE merged_into_id IS NULL) AS entities
  `);
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  return json({
    enabled: isAutoExtractEnabled(),
    files: Number(r.files ?? 0),
    research: Number(r.research ?? 0),
    alreadyExtracted: Number(r.already_extracted ?? 0),
    entities: Number(r.entities ?? 0),
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) return json({ error: 'unauthorized' }, { status: 401 });
  if (!isAutoExtractEnabled()) {
    return json({ error: 'Intel auto-extraction is disabled (INTEL_AUTO_EXTRACT=0).' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    kinds?: string[];
    limit?: number;
    summaries?: boolean;
    embeddings?: boolean;
    dedupeLinks?: boolean;
    confidence?: boolean;
  };

  // Summary-only pass: fills entities left without one. Separate from the
  // corpus sweep because re-extracting an unchanged item is a no-op by design,
  // so a summary gap can't be closed by simply re-running the sweep.
  if (body.summaries) {
    const { backfillEntitySummaries } = await import('$lib/jkai/intel/graph');
    return json(await backfillEntitySummaries(typeof body.limit === 'number' ? body.limit : undefined));
  }

  // Trust scores. Cheap, no LLM, and required before any confidence filter
  // means anything — an unscored entity is invisible to one.
  if (body.confidence) {
    const { backfillConfidence } = await import('$lib/jkai/intel/trust-refresh');
    return json(await backfillConfidence());
  }

  // Repair pass: drop duplicate (note, entity) links accumulated by
  // re-extraction before the insert was guarded. Cheap, idempotent, no LLM.
  if (body.dedupeLinks) {
    const { dedupeNoteLinks } = await import('$lib/jkai/intel/resolve/merge');
    return json(await dedupeNoteLinks());
  }

  // Embedding-only pass. The most important of the three: entity resolution
  // retrieves candidates by vector similarity and skips anything with a null
  // embedding, so unembedded entities silently breed duplicates on every
  // subsequent ingest. Cheap (one batched call per ~96 entities) and safe to
  // re-run — it only touches rows that have no vector.
  if (body.embeddings) {
    const { backfillEntityEmbeddings } = await import('$lib/jkai/intel/embed');
    return json(await backfillEntityEmbeddings(typeof body.limit === 'number' ? body.limit : undefined));
  }

  const kinds = Array.isArray(body.kinds)
    ? body.kinds.filter((k): k is AutoKind => VALID_KINDS.includes(k as AutoKind))
    : undefined;
  if (kinds && kinds.length === 0) {
    return json({ error: 'kinds must contain "file" and/or "research"' }, { status: 400 });
  }

  const progress = await backfillIntelExtraction({
    kinds,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
  });
  return json(progress);
};
