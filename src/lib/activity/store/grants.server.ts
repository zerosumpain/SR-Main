import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityConnections,
  activityConsumerGrants,
  type ActivityConsumerGrantRow,
} from '$lib/db/schema';
import {
  ACTIVITY_CONSUMERS,
  ACTIVITY_DATA_CLASSES,
  type ActivityConsumer,
  type ActivityDataClass,
} from '../contracts';
import { ActivityConnectionError } from './connections.server';
import { stableActivityId } from './ids';

export interface GrantChoice {
  consumer: ActivityConsumer;
  dataClass: ActivityDataClass;
  category?: string | null;
  allowed: boolean;
}

export class ActivityGrantError extends Error {
  constructor(readonly code: 'invalid_grant' | 'conflict', message: string) {
    super(message);
    this.name = 'ActivityGrantError';
  }
}

function validateChoice(choice: GrantChoice): void {
  if (!choice || typeof choice !== 'object') {
    throw new ActivityGrantError('invalid_grant', 'Activity grant must be an object');
  }
  if (!ACTIVITY_CONSUMERS.includes(choice.consumer)) {
    throw new ActivityGrantError('invalid_grant', 'Unknown activity consumer');
  }
  if (!ACTIVITY_DATA_CLASSES.includes(choice.dataClass)) {
    throw new ActivityGrantError('invalid_grant', 'Unknown activity data class');
  }
  if (typeof choice.allowed !== 'boolean') {
    throw new ActivityGrantError('invalid_grant', 'Activity grant allowed must be boolean');
  }
  if (choice.category !== undefined && choice.category !== null && !/^[a-z][a-z0-9_-]*$/.test(choice.category)) {
    throw new ActivityGrantError('invalid_grant', 'Activity grant category must be a lowercase token');
  }
  if ((choice.dataClass === 'raw_content' || choice.dataClass === 'location') && choice.allowed) {
    // These are allowed, but only when the caller sent the exact class. This
    // branch is documentation in executable form: no broad activity toggle can
    // be expanded to raw/location by this function.
  }
}

export async function listActivityGrants(
  principalId: string,
  connectionId: string,
): Promise<ActivityConsumerGrantRow[]> {
  return db
    .select()
    .from(activityConsumerGrants)
    .where(
      and(
        eq(activityConsumerGrants.principalId, principalId),
        eq(activityConsumerGrants.connectionId, connectionId),
      ),
    );
}

export async function replaceActivityGrants(input: {
  principalId: string;
  connectionId: string;
  expectedVersion: number;
  grants: GrantChoice[];
}): Promise<{ version: number; grants: ActivityConsumerGrantRow[] }> {
  const dedupe = new Set<string>();
  for (const choice of input.grants) {
    validateChoice(choice);
    const key = `${choice.consumer}:${choice.dataClass}:${choice.category ?? '*'}`;
    if (dedupe.has(key)) {
      throw new ActivityGrantError('invalid_grant', `Duplicate activity grant: ${key}`);
    }
    dedupe.add(key);
  }

  return db.transaction(async (tx) => {
    const [connection] = await tx
      .update(activityConnections)
      .set({ version: input.expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(activityConnections.id, input.connectionId),
          eq(activityConnections.principalId, input.principalId),
          eq(activityConnections.version, input.expectedVersion),
        ),
      )
      .returning({ id: activityConnections.id, version: activityConnections.version });
    if (!connection) {
      const [exists] = await tx
        .select({ id: activityConnections.id })
        .from(activityConnections)
        .where(
          and(
            eq(activityConnections.id, input.connectionId),
            eq(activityConnections.principalId, input.principalId),
          ),
        )
        .limit(1);
      if (!exists) {
        throw new ActivityConnectionError('connection_not_found', 'Activity connection not found');
      }
      throw new ActivityGrantError('conflict', 'Activity connection changed; reload grants before saving');
    }

    await tx
      .delete(activityConsumerGrants)
      .where(
        and(
          eq(activityConsumerGrants.principalId, input.principalId),
          eq(activityConsumerGrants.connectionId, input.connectionId),
        ),
      );
    if (input.grants.length === 0) return { version: connection.version, grants: [] };

    const rows = await tx
      .insert(activityConsumerGrants)
      .values(
        input.grants.map((choice) => ({
          id: stableActivityId('agrant', [
            input.connectionId,
            choice.consumer,
            choice.dataClass,
            choice.category ?? null,
          ]),
          principalId: input.principalId,
          connectionId: input.connectionId,
          consumer: choice.consumer,
          dataClass: choice.dataClass,
          category: choice.category ?? null,
          allowed: choice.allowed,
          version: connection.version,
        })),
      )
      .returning();
    return { version: connection.version, grants: rows };
  });
}
