// Counts for the Intel workbench nav.
//
// The nav is on every intel surface, so this runs on every intel page load —
// which is why it is nine COUNT queries and nothing else. Anything expensive
// (duplicate detection, the analytics snapshot) stays on the page that owns it;
// a nav that costs a Louvain run would tax every page for a badge.
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import {
  intelAlerts,
  intelDossiers,
  intelEntities,
  intelNotes,
  intelTimelineEvents,
} from '$lib/db/schema';
import { and, count, eq, isNull, sql } from 'drizzle-orm';

export const load: LayoutServerLoad = async () => {
  const [entities, notes, pending, alerts, dossiers, events, watched, heldMail] = await Promise.all([
    db.select({ n: count() }).from(intelEntities).where(isNull(intelEntities.mergedIntoId)),
    db.select({ n: count() }).from(intelNotes),
    db
      .select({ n: count() })
      .from(intelEntities)
      .where(and(eq(intelEntities.confirmed, false), isNull(intelEntities.mergedIntoId))),
    db.select({ n: count() }).from(intelAlerts).where(eq(intelAlerts.dismissed, false)),
    db.select({ n: count() }).from(intelDossiers).where(eq(intelDossiers.status, 'open')),
    db.select({ n: count() }).from(intelTimelineEvents),
    db
      .select({ n: count() })
      .from(intelEntities)
      .where(and(eq(intelEntities.watched, true), isNull(intelEntities.mergedIntoId))),
    // Email waiting at the graph gate. The one badge on this nav that is a
    // BACKLOG rather than a statistic, so it is the one worth warning on.
    db
      .select({ n: count() })
      .from(intelNotes)
      .where(and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending'))),
  ]);

  // Entities asserted by exactly one note with no relationships are the honest
  // "needs attention" signal for Quality without running duplicate detection.
  const [thin] = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM intel_entities e
    WHERE e.merged_into_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM intel_relationships r
        WHERE r.source_entity_id = e.id OR r.target_entity_id = e.id
      )
  `).then((r) => r.rows as Array<{ n: number }>);

  return {
    intelCounts: {
      entities: entities[0]?.n ?? 0,
      notes: notes[0]?.n ?? 0,
      pending: pending[0]?.n ?? 0,
      alerts: alerts[0]?.n ?? 0,
      dossiers: dossiers[0]?.n ?? 0,
      events: events[0]?.n ?? 0,
      watched: watched[0]?.n ?? 0,
      unconnected: Number(thin?.n ?? 0),
      heldMail: heldMail[0]?.n ?? 0,
    },
  };
};
