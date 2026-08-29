// Sweep the existing /drive + research corpus into the intel graph. Auto-
// extraction only fires on NEW ingest, so anything indexed before it existed
// needs this once. Sequential and idempotent (content-hash gated), so it is
// safe to re-run and to drive in batches: loop POST until `scanned` is 0.
//
// Auth mirrors /api/deepdive/reindex-facts: owner session from a browser, OR a
// MAINTENANCE_SECRET header for a one-off run from the box, where a long pass
// has no user session to carry.
//
//   GET             → { enabled, files, research, chats, alreadyExtracted }
//   POST { kinds?, limit? } → run a pass, returns progress counters
//   POST { aliases: true }  → recover the surface forms past merges discarded
//
// `kinds: ['chat']` is the odd one out: re-extracting a thread is NOT a no-op
// the way re-extracting an unchanged file is. The old cadence (turn 2, then
// every 4th) was longer than the median thread, so every thread in production
// had been extracted once, from its opening exchange only. The transcript is
// now both longer and cleaner, so the content hash differs and real work
// happens. Runs sequentially — each thread is an LLM call.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';
import { backfillIntelExtraction, isAutoExtractEnabled, type AutoKind } from '$lib/jkai/intel/auto-extract';

const VALID_KINDS: AutoKind[] = ['file', 'research', 'chat'];
/** The corpus sweep in auto-extract.ts only knows about these two; `chat` has
 *  its own walker in chat-extract.ts (it re-extracts rather than skipping on an
 *  unchanged hash, so it can't share the same loop). */
const SWEEP_KINDS: AutoKind[] = ['file', 'research'];

export const GET: RequestHandler = async ({ locals, request }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) return json({ error: 'unauthorized' }, { status: 401 });

  const { rows } = await db.execute(sql`
    SELECT
      (SELECT count(DISTINCT file_id) FROM file_embeddings) AS files,
      (SELECT count(*) FROM research_session WHERE report IS NOT NULL) AS research,
      (SELECT count(DISTINCT conversation_id) FROM orchestrator_chats WHERE role = 'assistant') AS chats,
      (SELECT count(*) FROM intel_notes WHERE metadata->>'autoKind' IS NOT NULL) AS already_extracted,
      (SELECT count(*) FROM intel_entities WHERE merged_into_id IS NULL) AS entities
  `);
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  return json({
    enabled: isAutoExtractEnabled(),
    files: Number(r.files ?? 0),
    research: Number(r.research ?? 0),
    chats: Number(r.chats ?? 0),
    alreadyExtracted: Number(r.already_extracted ?? 0),
    entities: Number(r.entities ?? 0),
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) return json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    kinds?: string[];
    limit?: number;
    summaries?: boolean;
    embeddings?: boolean;
    dedupeLinks?: boolean;
    confidence?: boolean;
    aliases?: boolean;
  };

  // Surface forms recovered from past merges.
  //
  // Sits ABOVE the auto-extract gate, unlike every other pass here: it reads
  // tombstones the graph already holds and calls nothing, so refusing it when
  // extraction is switched off would be refusing on an unrelated grounds. Also
  // in the nightly resolve stage, and idempotent — it only writes where the
  // computed alias list differs from what is stored.
  if (body.aliases) {
    const { backfillAliasesFromTombstones } = await import('$lib/jkai/intel/resolve/merge');
    return json(await backfillAliasesFromTombstones());
  }

  if (!isAutoExtractEnabled()) {
    return json({ error: 'Intel auto-extraction is disabled (INTEL_AUTO_EXTRACT=0).' }, { status: 409 });
  }

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
    return json({ error: 'kinds must be some of "file", "research", "chat"' }, { status: 400 });
  }

  const limit = typeof body.limit === 'number' ? body.limit : undefined;

  // Chat threads have their own walker. Asked for on its own, that is the whole
  // job; alongside file/research, both run and the counters are returned apart
  // so a caller can see which corpus did what.
  const chatProgress = kinds?.includes('chat')
    ? await (await import('$lib/jkai/intel/chat-extract')).backfillThreadConcepts({ limit })
    : null;

  const sweepKinds = kinds?.filter((k) => SWEEP_KINDS.includes(k));
  if (chatProgress && (!sweepKinds || sweepKinds.length === 0)) {
    return json({ chat: chatProgress });
  }

  const progress = await backfillIntelExtraction({ kinds: sweepKinds, limit });
  return json(chatProgress ? { ...progress, chat: chatProgress } : progress);
};
