// Why the graph believes an entity, and the evidence you can check it against.
//
//   GET  ?id=…   the computed confidence, its component breakdown, and every
//                source note with the excerpt the claim came from
//   POST         a manual grade override (sourceGrade / credibility)
//
// The scoring itself lives in $lib/jkai/intel/trust — pure, tested, and shared
// with the entity card, so a hover card and the stored `confidence_score` can
// never tell a different story.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { desc, eq, sql } from 'drizzle-orm';
import { intelEntities, intelNotes, intelNoteEntities } from '$lib/db/schema';
import {
  ageInDays,
  bestGrade,
  computeConfidence,
  credibilityFromCorroboration,
  gradeFromSource,
  normalizeCredibility,
  normalizeGrade,
  SOURCE_GRADES,
  type TrustPayload,
} from '$lib/jkai/intel/trust';

/** Evidence is for reading, not for paging — enough to judge a claim by. */
const MAX_EVIDENCE = 25;

/** Below this the denormalised column is not worth a write. */
const SCORE_EPSILON = 0.005;

export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) throw error(400, 'id is required');

  const payload = await buildTrust(id);
  if (!payload) throw error(404, 'entity not found');
  return json(payload);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    entityId?: string;
    sourceGrade?: string | null;
    credibility?: number | string | null;
  } | null;

  const entityId = body?.entityId?.trim();
  if (!entityId) throw error(400, 'entityId is required');

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  // A key present-and-null clears the override and returns the entity to the
  // source-derived default; a key that is absent leaves that axis alone.
  if ('sourceGrade' in (body ?? {})) {
    if (body!.sourceGrade == null || body!.sourceGrade === '') {
      updates.sourceGrade = null;
    } else {
      const grade = String(body!.sourceGrade).trim().toUpperCase();
      if (!(SOURCE_GRADES as readonly string[]).includes(grade)) {
        throw error(400, `sourceGrade must be one of ${SOURCE_GRADES.join(', ')}`);
      }
      updates.sourceGrade = grade;
    }
  }

  if ('credibility' in (body ?? {})) {
    if (body!.credibility == null || body!.credibility === '') {
      updates.credibility = null;
    } else {
      const rating = Math.round(Number(body!.credibility));
      if (!Number.isFinite(rating) || rating < 1 || rating > 6) {
        throw error(400, 'credibility must be an integer 1–6');
      }
      updates.credibility = rating;
    }
  }

  const [updated] = await db
    .update(intelEntities)
    .set(updates)
    .where(eq(intelEntities.id, entityId))
    .returning({ id: intelEntities.id });
  if (!updated) throw error(404, 'entity not found');

  const payload = await buildTrust(entityId);
  if (!payload) throw error(404, 'entity not found');
  return json(payload);
};

async function buildTrust(id: string): Promise<TrustPayload | null> {
  const [row] = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      confirmed: intelEntities.confirmed,
      sourceGrade: intelEntities.sourceGrade,
      credibility: intelEntities.credibility,
      corroboration: intelEntities.corroboration,
      confidenceScore: intelEntities.confidenceScore,
      lastCorroboratedAt: intelEntities.lastCorroboratedAt,
      updatedAt: intelEntities.updatedAt,
    })
    .from(intelEntities)
    .where(eq(intelEntities.id, id))
    .limit(1);

  if (!row) return null;

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      source: intelNotes.source,
      createdAt: intelNotes.createdAt,
      relevance: intelNoteEntities.relevance,
      excerpt: intelNoteEntities.excerpt,
      metadata: intelNotes.metadata,
    })
    .from(intelNoteEntities)
    .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
    .where(eq(intelNoteEntities.entityId, id))
    .orderBy(desc(intelNotes.createdAt))
    .limit(MAX_EVIDENCE);

  // Counted from the table rather than trusted from the denormalised column:
  // `corroboration` is only written when an extraction touches the entity, so
  // rows that predate the trust layer still sit at 0 with ten notes attached.
  const [{ total: distinctNotes } = { total: 0 }] = await db
    .select({ total: sql<number>`count(DISTINCT ${intelNoteEntities.noteId})::int` })
    .from(intelNoteEntities)
    .where(eq(intelNoteEntities.entityId, id));

  const corroboration = Math.max(distinctNotes, row.corroboration ?? 0);

  const manualGrade = row.sourceGrade ? normalizeGrade(row.sourceGrade) : null;
  const derivedGrade = bestGrade(notes.map((n) => n.source));
  const manualCredibility = row.credibility != null ? normalizeCredibility(row.credibility) : null;

  // The freshest thing we know about this claim. lastCorroboratedAt is only set
  // by extraction, so fall back to the newest note and finally to the row's own
  // updatedAt — otherwise an un-extracted entity would look infinitely stale.
  const newestNote = notes[0]?.createdAt ?? null;
  const anchor = row.lastCorroboratedAt ?? newestNote ?? row.updatedAt;

  const trust = computeConfidence({
    corroboration,
    sourceGrade: manualGrade ?? derivedGrade,
    credibility: manualCredibility ?? credibilityFromCorroboration(corroboration),
    ageDays: ageInDays(anchor),
    confirmed: row.confirmed,
  });

  // Keep the denormalised column honest. It is what other surfaces sort and
  // filter on, and nothing else recomputes it, so a stale value there would
  // quietly outrank a fresh one everywhere the score is not opened.
  if (Math.abs((row.confidenceScore ?? -1) - trust.score) > SCORE_EPSILON) {
    await db
      .update(intelEntities)
      .set({ confidenceScore: trust.score, corroboration })
      .where(eq(intelEntities.id, id))
      .catch(() => {
        // Reporting trust must not fail because the cache write did.
      });
  }

  return {
    entity: { id: row.id, name: row.name, confirmed: row.confirmed },
    trust,
    origin: {
      sourceGrade: manualGrade ? 'manual' : 'derived',
      credibility: manualCredibility ? 'manual' : 'derived',
    },
    lastCorroboratedAt: row.lastCorroboratedAt ? row.lastCorroboratedAt.toISOString() : null,
    evidence: notes.map((n) => ({
      noteId: n.id,
      title: n.title ?? 'Untitled',
      source: n.source,
      grade: gradeFromSource(n.source),
      createdAt: n.createdAt.toISOString(),
      relevance: n.relevance,
      excerpt: n.excerpt?.trim() ? n.excerpt.trim() : null,
      // Derived notes point back at the thing they came from, matching the
      // entity-card endpoint so both open the same place.
      href:
        (n.metadata as Record<string, unknown> | null)?.sourceUrl != null
          ? String((n.metadata as Record<string, unknown>).sourceUrl)
          : `/jkai/intel/notes/${n.id}`,
    })),
    evidenceCount: distinctNotes,
  };
}
