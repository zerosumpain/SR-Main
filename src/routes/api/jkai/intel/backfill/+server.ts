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

  const body = (await request.json().catch(() => ({}))) as { kinds?: string[]; limit?: number };
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
