import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import {
  activityEvents,
  activityOutbox,
  activitySyncCursors,
  type NewActivityEvent,
} from '$lib/db/schema';
import {
  assertProviderCanEmit,
  boundActivityEventQuery,
  validateActivityEvent,
  type ActivityEventQuery,
  type ActivityEventV1,
  type ActivityProviderAdapter,
  type ProviderPage,
} from '../contracts';
import { stableActivityId } from './ids';

export function activityEventRow(event: ActivityEventV1): NewActivityEvent {
  validateActivityEvent(event);
  return {
    id: event.id,
    eventKey: event.id,
    revision: 1,
    importId: event.provenance.importId ?? null,
    principalId: event.principalId,
    connectionId: event.connectionId,
    source: event.source,
    type: event.type,
    category: event.category,
    subjectKey: event.subjectKey,
    occurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
    observedAt: new Date(event.observedAt),
    evidenceMode: event.evidenceMode,
    actor: { ...event.actor },
    object: { ...event.object },
    measures: event.measures,
    provenance: { ...event.provenance },
  };
}

async function persistPageWithExecutor(input: {
  executor: DbExecutor;
  adapter: ActivityProviderAdapter;
  principalId: string;
  connectionId: string;
  stream: string;
  page: ProviderPage;
  observedAt: string;
}): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  for (const event of input.page.events) {
    validateActivityEvent(event, {
      principalId: input.principalId,
      connectionId: input.connectionId,
    });
    assertProviderCanEmit(input.adapter.manifest, event);
    const rows = await input.executor
      .insert(activityEvents)
      .values(activityEventRow(event))
      .onConflictDoNothing({ target: activityEvents.id })
      .returning({ id: activityEvents.id });
    if (rows.length === 0) continue;
    inserted++;
    await input.executor.insert(activityOutbox).values({
      principalId: input.principalId,
      eventId: event.id,
      topic: 'activity.event.created',
      payload: {
        connectionId: input.connectionId,
        source: event.source,
        type: event.type,
        category: event.category,
        evidenceMode: event.evidenceMode,
      },
    });
  }

  if (input.page.nextCursor !== undefined) {
    const cursorId = stableActivityId('acur', [input.connectionId, input.stream]);
    await input.executor
      .insert(activitySyncCursors)
      .values({
        id: cursorId,
        principalId: input.principalId,
        connectionId: input.connectionId,
        stream: input.stream,
        cursor: input.page.nextCursor ?? {},
        observedAt: new Date(input.observedAt),
      })
      .onConflictDoUpdate({
        target: activitySyncCursors.id,
        set: {
          cursor: input.page.nextCursor ?? {},
          version: sql`${activitySyncCursors.version} + 1`,
          observedAt: new Date(input.observedAt),
          updatedAt: new Date(),
        },
      });
  }

  return { inserted, duplicates: input.page.events.length - inserted };
}

/** Events, cursor and outbox commit together or not at all. */
export async function persistActivityPage(input: Omit<Parameters<typeof persistPageWithExecutor>[0], 'executor'>) {
  return db.transaction((tx) => persistPageWithExecutor({ ...input, executor: tx }));
}

export async function getActivityCursor(
  principalId: string,
  connectionId: string,
  stream: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ cursor: activitySyncCursors.cursor })
    .from(activitySyncCursors)
    .where(
      and(
        eq(activitySyncCursors.principalId, principalId),
        eq(activitySyncCursors.connectionId, connectionId),
        eq(activitySyncCursors.stream, stream),
      ),
    )
    .limit(1);
  return row?.cursor ?? null;
}

export async function listActivityEvents(
  principalId: string,
  rawQuery: ActivityEventQuery = {},
) {
  const query = boundActivityEventQuery(rawQuery);
  const conditions = [
    eq(activityEvents.principalId, principalId),
    eq(activityEvents.isCurrent, true),
    isNull(activityEvents.tombstonedAt),
    isNull(activityEvents.hiddenAt),
  ];
  if (query.connectionIds?.length) {
    conditions.push(inArray(activityEvents.connectionId, query.connectionIds));
  }
  if (query.categories?.length) conditions.push(inArray(activityEvents.category, query.categories));
  if (query.evidenceModes?.length) {
    conditions.push(inArray(activityEvents.evidenceMode, query.evidenceModes));
  }
  if (query.from) {
    const from = new Date(query.from);
    conditions.push(
      or(gte(activityEvents.occurredAt, from), and(isNull(activityEvents.occurredAt), gte(activityEvents.observedAt, from)))!,
    );
  }
  if (query.to) {
    const to = new Date(query.to);
    conditions.push(
      or(lte(activityEvents.occurredAt, to), and(isNull(activityEvents.occurredAt), lte(activityEvents.observedAt, to)))!,
    );
  }

  // Cursor decoding is added with the API contract in M2. Store callers still
  // get a hard page cap now, so a missing cursor cannot become an unbounded read.
  return db
    .select()
    .from(activityEvents)
    .where(and(...conditions))
    .orderBy(desc(activityEvents.observedAt), desc(activityEvents.id))
    .limit(query.limit);
}

export async function getActivityEvent(
  principalId: string,
  eventId: string,
) {
  const [row] = await db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.id, eventId), eq(activityEvents.principalId, principalId)))
    .limit(1);
  return row ?? null;
}
