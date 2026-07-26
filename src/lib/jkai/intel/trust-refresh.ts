// Keeping `intel_entities.confidence_score` populated.
//
// The score was only ever written lazily, by the trust API when someone
// happened to open an entity card. Everything else that READS it therefore got
// NULL — and three separate features fail silently on that:
//
//   - a lens with a confidence floor compares `confidence_score >= n` in SQL,
//     and NULL fails every comparison, so the lens returns ZERO entities rather
//     than "all of them" — the worst kind of filter bug, because it looks like
//     an answer;
//   - watchlist confidence-drop alarms have nothing to compare;
//   - entity briefs silently omit their trust line.
//
// So it is computed here on write (after extraction updates corroboration) and
// backfillable in bulk. Same pure `computeConfidence` the API and the card use,
// so a stored score and a rendered one can never disagree.
import { db } from '$lib/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { intelEntities, intelNotes, intelNoteEntities } from '$lib/db/schema';
import { computeConfidence, bestGrade, credibilityFromCorroboration } from './trust';

const DAY_MS = 86_400_000;

interface ScoreInput {
  id: string;
  corroboration: number;
  sourceGrade: string | null;
  credibility: number | null;
  confirmed: boolean;
  lastCorroboratedAt: Date | null;
  sources: string[];
}

/** The score for one entity, from its stored grades or defaults derived from its sources. */
export function scoreFor(row: ScoreInput): number {
  const ageDays = row.lastCorroboratedAt
    ? Math.max(0, (Date.now() - row.lastCorroboratedAt.getTime()) / DAY_MS)
    : 0;
  return computeConfidence({
    corroboration: row.corroboration,
    // A manual override wins; otherwise grade from the best source that
    // asserted it, which is what an analyst would do by hand.
    sourceGrade: (row.sourceGrade as never) ?? bestGrade(row.sources),
    credibility: (row.credibility as never) ?? credibilityFromCorroboration(row.corroboration),
    ageDays,
    confirmed: row.confirmed,
  }).score;
}

async function loadScoreInputs(entityIds?: string[]): Promise<ScoreInput[]> {
  const res = await db.execute(sql`
    SELECT
      e.id,
      e.corroboration,
      e.source_grade                       AS source_grade,
      e.credibility,
      e.confirmed,
      e.last_corroborated_at               AS last_corroborated_at,
      COALESCE(
        (SELECT array_agg(DISTINCT n.source)
         FROM intel_note_entities ne JOIN intel_notes n ON n.id = ne.note_id
         WHERE ne.entity_id = e.id),
        ARRAY[]::text[]
      )                                    AS sources
    FROM intel_entities e
    WHERE e.merged_into_id IS NULL
      ${entityIds?.length ? sql`AND e.id = ANY(${sql`ARRAY[${sql.join(entityIds.map((i) => sql`${i}`), sql`, `)}]::text[]`})` : sql``}
  `);

  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    corroboration: Number(r.corroboration ?? 0),
    sourceGrade: r.source_grade == null ? null : String(r.source_grade),
    credibility: r.credibility == null ? null : Number(r.credibility),
    confirmed: Boolean(r.confirmed),
    lastCorroboratedAt: r.last_corroborated_at ? new Date(String(r.last_corroborated_at)) : null,
    sources: Array.isArray(r.sources) ? (r.sources as unknown[]).map(String) : [],
  }));
}

/**
 * Recompute and store the confidence score for specific entities. Called after
 * extraction so a freshly corroborated entity is immediately filterable, rather
 * than waiting for someone to open its card.
 */
export async function refreshConfidence(entityIds: string[]): Promise<number> {
  if (!entityIds.length) return 0;
  const rows = await loadScoreInputs(entityIds);
  let written = 0;
  for (const row of rows) {
    await db
      .update(intelEntities)
      .set({ confidenceScore: scoreFor(row) })
      .where(eq(intelEntities.id, row.id));
    written++;
  }
  return written;
}

/** One-off / periodic sweep for entities that have never been scored. */
export async function backfillConfidence(
  opts: { onlyMissing?: boolean } = {},
): Promise<{ scored: number; remaining: number }> {
  const rows = await loadScoreInputs();
  const targets = opts.onlyMissing === false ? rows : rows;

  let scored = 0;
  for (const row of targets) {
    await db
      .update(intelEntities)
      .set({ confidenceScore: scoreFor(row) })
      .where(eq(intelEntities.id, row.id));
    scored++;
  }

  const [{ count: remaining } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(intelEntities)
    .where(and(isNull(intelEntities.confidenceScore), isNull(intelEntities.mergedIntoId)));

  console.log(`[intel:trust] scored ${scored} entities, ${remaining} still unscored`);
  return { scored, remaining };
}
