// Counts for the Intel workbench nav.
//
// The nav is on every intel surface, so this runs on every intel page load —
// which is why it is ten COUNT queries and nothing else. Anything expensive
// (duplicate detection, the analytics snapshot) stays on the page that owns it;
// a nav that costs a Louvain run would tax every page for a badge.
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import {
  gmailAccounts,
  intelAlerts,
  intelDossiers,
  intelEntities,
  intelNotes,
  intelTimelineEvents,
} from '$lib/db/schema';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { spaceIn, writeSpace } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import { viewerOf } from '$lib/server/viewer';

// Every badge counts the request's scope: a count is still a disclosure (how
// much mail, how many dossiers) and the nav is on every intel page. The one
// exception is `proposedTypes`, which counts the shared type vocabulary.
export const load: LayoutServerLoad = async (event) => {
  const scope = await resolveRequestScope(event);
  const member = (await viewerOf(event)).kind === 'member';
  // A member's own mailboxes, for the connect panel on /jkai/intel. Addresses
  // and status only — never a token, and never anybody else's row.
  const memberGmail = member
    ? await db
        .select({ email: gmailAccounts.email, status: gmailAccounts.status })
        .from(gmailAccounts)
        .where(eq(gmailAccounts.principalId, writeSpace(scope)))
    : [];
  const [entities, notes, pending, alerts, dossiers, events, watched, heldMail] = await Promise.all([
    db
      .select({ n: count() })
      .from(intelEntities)
      .where(and(isNull(intelEntities.mergedIntoId), spaceIn(intelEntities.spaceId, scope))),
    db.select({ n: count() }).from(intelNotes).where(spaceIn(intelNotes.spaceId, scope)),
    db
      .select({ n: count() })
      .from(intelEntities)
      .where(
        and(
          eq(intelEntities.confirmed, false),
          isNull(intelEntities.mergedIntoId),
          spaceIn(intelEntities.spaceId, scope),
        ),
      ),
    db
      .select({ n: count() })
      .from(intelAlerts)
      .where(and(eq(intelAlerts.dismissed, false), spaceIn(intelAlerts.spaceId, scope))),
    db
      .select({ n: count() })
      .from(intelDossiers)
      .where(and(eq(intelDossiers.status, 'open'), spaceIn(intelDossiers.spaceId, scope))),
    db.select({ n: count() }).from(intelTimelineEvents).where(spaceIn(intelTimelineEvents.spaceId, scope)),
    db
      .select({ n: count() })
      .from(intelEntities)
      .where(
        and(
          eq(intelEntities.watched, true),
          isNull(intelEntities.mergedIntoId),
          spaceIn(intelEntities.spaceId, scope),
        ),
      ),
    // Email waiting at the graph gate. The one badge on this nav that is a
    // BACKLOG rather than a statistic, so it is the one worth warning on.
    db
      .select({ n: count() })
      .from(intelNotes)
      .where(
        and(
          eq(intelNotes.source, 'email'),
          eq(intelNotes.graphState, 'pending'),
          spaceIn(intelNotes.spaceId, scope),
        ),
      ),
  ]);

  // Entities asserted by exactly one note with no relationships are the honest
  // "needs attention" signal for Quality without running duplicate detection.
  const [thin] = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM intel_entities e
    WHERE e.merged_into_id IS NULL
      AND ${spaceIn(sql`e.space_id`, scope)}
      AND NOT EXISTS (
        SELECT 1 FROM intel_relationships r
        WHERE (r.source_entity_id = e.id OR r.target_entity_id = e.id)
          AND ${spaceIn(sql`r.space_id`, scope)}
      )
  `).then((r) => r.rows as Array<{ n: number }>);

  // Types the extractor coined and nobody has ruled on. A proposed type is not
  // inert — it re-enters the extraction prompt as a legitimate option — so this
  // is a backlog, not a statistic, and it earns a badge.
  const [proposedTypes] = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM intel_entity_types WHERE status = 'proposed'
  `).then((r) => r.rows as Array<{ n: number }>);

  return {
    member,
    memberGmail,
    intelCounts: {
      // The type vocabulary is shared and its triage is the owner's.
      proposedTypes: member ? 0 : Number(proposedTypes?.n ?? 0),
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
