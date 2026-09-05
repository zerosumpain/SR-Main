/**
 * Aggregates over the event ledger for the jkai toolset.
 *
 * `listActivityEvents` caps a page at 100 rows, which is right for an audit
 * screen and wrong for "how much did I play this month". These read the same
 * ledger under the same visibility rules (current, not tombstoned, not
 * hidden) and return counts, never payloads.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityEvents } from '$lib/db/schema';

const whenKnown = sql`coalesce(${activityEvents.occurredAt}, ${activityEvents.observedAt})`;

function visible(principalId: string, connectionIds: readonly string[]) {
  return and(
    eq(activityEvents.principalId, principalId),
    eq(activityEvents.isCurrent, true),
    isNull(activityEvents.tombstonedAt),
    isNull(activityEvents.hiddenAt),
    inArray(activityEvents.connectionId, [...connectionIds]),
  );
}

export interface ActivitySummaryRow {
  connectionId: string;
  category: string;
  type: string;
  evidenceMode: string;
  count: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

export async function summariseActivityEvents(
  principalId: string,
  input: { connectionIds: readonly string[]; from: Date; to: Date },
): Promise<ActivitySummaryRow[]> {
  if (input.connectionIds.length === 0) return [];
  return db
    .select({
      connectionId: activityEvents.connectionId,
      category: activityEvents.category,
      type: activityEvents.type,
      evidenceMode: activityEvents.evidenceMode,
      count: sql<number>`count(*)::int`,
      firstAt: sql<Date | null>`min(${whenKnown})`,
      lastAt: sql<Date | null>`max(${whenKnown})`,
    })
    .from(activityEvents)
    .where(
      and(
        visible(principalId, input.connectionIds),
        gte(whenKnown, input.from),
        lte(whenKnown, input.to),
      ),
    )
    .groupBy(
      activityEvents.connectionId,
      activityEvents.category,
      activityEvents.type,
      activityEvents.evidenceMode,
    )
    .orderBy(desc(sql`count(*)`))
    .limit(200);
}

export interface ActivityTopObject {
  connectionId: string;
  kind: string | null;
  label: string | null;
  count: number;
  lastAt: Date | null;
}

/** The objects that recur most — game titles, tracks — labels only. */
export async function topActivityObjects(
  principalId: string,
  input: { connectionIds: readonly string[]; from: Date; to: Date; limit?: number },
): Promise<ActivityTopObject[]> {
  if (input.connectionIds.length === 0) return [];
  const kind = sql<string | null>`${activityEvents.object}->>'kind'`;
  const label = sql<string | null>`${activityEvents.object}->>'label'`;
  return db
    .select({
      connectionId: activityEvents.connectionId,
      kind,
      label,
      count: sql<number>`count(*)::int`,
      lastAt: sql<Date | null>`max(${whenKnown})`,
    })
    .from(activityEvents)
    .where(
      and(
        visible(principalId, input.connectionIds),
        gte(whenKnown, input.from),
        lte(whenKnown, input.to),
        sql`${activityEvents.object}->>'label' is not null`,
      ),
    )
    .groupBy(activityEvents.connectionId, kind, label)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${whenKnown})`))
    .limit(Math.max(1, Math.min(50, input.limit ?? 20)));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const MAX_SEARCH_LIMIT = 25;

/** Bounded substring search over labels and types — metadata, never payloads. */
export async function searchActivityEvents(
  principalId: string,
  input: { connectionIds: readonly string[]; query: string; limit?: number },
) {
  if (input.connectionIds.length === 0) return [];
  const needle = `%${escapeLike(input.query.trim()).slice(0, 80)}%`;
  return db
    .select({
      id: activityEvents.id,
      connectionId: activityEvents.connectionId,
      source: activityEvents.source,
      type: activityEvents.type,
      category: activityEvents.category,
      occurredAt: activityEvents.occurredAt,
      observedAt: activityEvents.observedAt,
      evidenceMode: activityEvents.evidenceMode,
      object: activityEvents.object,
      measures: activityEvents.measures,
    })
    .from(activityEvents)
    .where(
      and(
        visible(principalId, input.connectionIds),
        or(
          sql`${activityEvents.object}->>'label' ilike ${needle}`,
          sql`${activityEvents.type} ilike ${needle}`,
        ),
      ),
    )
    .orderBy(desc(activityEvents.observedAt), desc(activityEvents.id))
    .limit(Math.max(1, Math.min(MAX_SEARCH_LIMIT, input.limit ?? MAX_SEARCH_LIMIT)));
}
