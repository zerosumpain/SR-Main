/**
 * What a consumer may read, answered from the grants table.
 *
 * The grant key is (principal, connection, consumer, dataClass) with an
 * optional category refinement. Phase one writes category-less grants only, so
 * this reads exactly those; a category-refined deny would need to be honoured
 * here before anyone writes one.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityConsumerGrants } from '$lib/db/schema';
import type { ActivityDataClass } from '../contracts';

export const ACTIVITY_CONSUMERS = ['jkai', 'daydream', 'briefing', 'workflow', 'intel', 'mcp'] as const;
export type ActivityConsumer = (typeof ACTIVITY_CONSUMERS)[number];

/** connectionId → the data classes this consumer may read from it. */
export type ConsumerGrantMap = Map<string, Set<ActivityDataClass>>;

export async function consumerGrantMap(
  principalId: string,
  consumer: ActivityConsumer,
): Promise<ConsumerGrantMap> {
  const rows = await db
    .select({
      connectionId: activityConsumerGrants.connectionId,
      dataClass: activityConsumerGrants.dataClass,
    })
    .from(activityConsumerGrants)
    .where(
      and(
        eq(activityConsumerGrants.principalId, principalId),
        eq(activityConsumerGrants.consumer, consumer),
        eq(activityConsumerGrants.allowed, true),
        isNull(activityConsumerGrants.category),
      ),
    );
  const map: ConsumerGrantMap = new Map();
  for (const row of rows) {
    const set = map.get(row.connectionId) ?? new Set<ActivityDataClass>();
    set.add(row.dataClass as ActivityDataClass);
    map.set(row.connectionId, set);
  }
  return map;
}

export function consumerMayRead(
  map: ConsumerGrantMap,
  connectionId: string,
  dataClass: ActivityDataClass,
): boolean {
  return map.get(connectionId)?.has(dataClass) ?? false;
}

/** Connection ids from `candidates` that this consumer may read at `dataClass`. */
export function readableConnectionIds(
  map: ConsumerGrantMap,
  candidates: readonly string[],
  dataClass: ActivityDataClass,
): string[] {
  return candidates.filter((id) => consumerMayRead(map, id, dataClass));
}

/** Test helper: grant rows shaped the way `consumerGrantMap` shapes them. */
export function grantMapFrom(
  rows: ReadonlyArray<{ connectionId: string; dataClass: string; allowed: boolean; category: string | null }>,
): ConsumerGrantMap {
  const map: ConsumerGrantMap = new Map();
  for (const row of rows) {
    if (!row.allowed || row.category !== null) continue;
    const set = map.get(row.connectionId) ?? new Set<ActivityDataClass>();
    set.add(row.dataClass as ActivityDataClass);
    map.set(row.connectionId, set);
  }
  return map;
}
