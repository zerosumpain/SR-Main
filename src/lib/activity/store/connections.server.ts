import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityConnections,
  activityConsumerGrants,
  activitySyncJobs,
  integrationCredentials,
  type ActivityConnection,
} from '$lib/db/schema';
import { defaultConsumerGrants, type ConnectionMode } from '../contracts';
import { getCatalogProvider } from '../providers/catalog';
import { randomActivityId, stableActivityId } from './ids';
import { encryptPayload } from '$lib/secrets/crypto';

export class ActivityConnectionError extends Error {
  constructor(
    readonly code:
      | 'provider_not_found'
      | 'provider_unavailable'
      | 'mode_not_supported'
      | 'connection_not_found'
      | 'credential_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'ActivityConnectionError';
  }
}

export interface CreateActivityConnectionInput {
  principalId: string;
  provider: string;
  mode: ConnectionMode;
  label?: string;
  scopes?: string[];
  /** Local/test fixture is the only provider allowed while catalogued as hidden. */
  allowUnavailable?: boolean;
}

export async function createActivityConnection(
  input: CreateActivityConnectionInput,
): Promise<ActivityConnection> {
  const adapter = getCatalogProvider(input.provider);
  if (!adapter) throw new ActivityConnectionError('provider_not_found', 'Unknown activity provider');
  const manifest = adapter.manifest;
  if (!manifest.modes.includes(input.mode)) {
    throw new ActivityConnectionError(
      'mode_not_supported',
      `${manifest.name} does not support ${input.mode}`,
    );
  }
  if (!input.allowUnavailable && !['available', 'beta'].includes(manifest.availability)) {
    throw new ActivityConnectionError(
      'provider_unavailable',
      `${manifest.name} is not available yet`,
    );
  }

  const id = randomActivityId('aconn');
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .insert(activityConnections)
      .values({
        id,
        principalId: input.principalId,
        provider: manifest.id,
        mode: input.mode,
        label: input.label?.trim() || manifest.name,
        scopes: input.scopes ?? manifest.scopes.filter((scope) => scope.required).map((scope) => scope.id),
        dataClasses: manifest.dataClasses,
        capabilities: {
          evidenceModes: manifest.evidenceModes,
          eventTypes: manifest.eventTypes,
          supportsIncrementalSync: manifest.supportsIncrementalSync,
          supportsBackfill: manifest.supportsBackfill,
        },
      })
      .returning();

    const grants = defaultConsumerGrants({
      principalId: input.principalId,
      connectionId: id,
      dataClasses: manifest.dataClasses,
    }).map((grant) => ({ ...grant, allowed: false }));
    if (grants.length > 0) await tx.insert(activityConsumerGrants).values(grants);
    return connection;
  });
}

export async function getActivityConnection(
  principalId: string,
  connectionId: string,
): Promise<ActivityConnection | null> {
  const [row] = await db
    .select()
    .from(activityConnections)
    .where(
      and(
        eq(activityConnections.id, connectionId),
        eq(activityConnections.principalId, principalId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function requireActivityConnection(
  principalId: string,
  connectionId: string,
): Promise<ActivityConnection> {
  const row = await getActivityConnection(principalId, connectionId);
  if (!row) throw new ActivityConnectionError('connection_not_found', 'Activity connection not found');
  return row;
}

export async function listActivityConnections(principalId: string): Promise<ActivityConnection[]> {
  return db
    .select()
    .from(activityConnections)
    .where(eq(activityConnections.principalId, principalId))
    .orderBy(desc(activityConnections.updatedAt));
}

/** Resolve a secret only after the connection/principal boundary has passed. */
export async function getBoundCredentialRow(
  principalId: string,
  connectionId: string,
) {
  const connection = await requireActivityConnection(principalId, connectionId);
  if (!connection.credentialId) return null;
  const [credential] = await db
    .select()
    .from(integrationCredentials)
    .where(eq(integrationCredentials.id, connection.credentialId))
    .limit(1);
  if (!credential || credential.integrationType !== connection.provider) {
    throw new ActivityConnectionError(
      'credential_mismatch',
      'Connection credential is absent or belongs to another provider',
    );
  }
  return credential;
}

export async function pauseActivityConnection(
  principalId: string,
  connectionId: string,
): Promise<void> {
  const rows = await db
    .update(activityConnections)
    .set({ status: 'paused', nextSyncAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(activityConnections.id, connectionId),
        eq(activityConnections.principalId, principalId),
      ),
    )
    .returning({ id: activityConnections.id });
  if (rows.length === 0) {
    throw new ActivityConnectionError('connection_not_found', 'Activity connection not found');
  }
}

export async function activateActivityConnection(input: {
  principalId: string;
  connectionId: string;
  provider: string;
  providerAccountId: string;
  credentialId?: string | null;
}): Promise<ActivityConnection> {
  const [row] = await db
    .update(activityConnections)
    .set({
      providerAccountId: input.providerAccountId,
      credentialId: input.credentialId ?? null,
      status: 'active',
      healthStatus: null,
      healthMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(activityConnections.id, input.connectionId),
        eq(activityConnections.principalId, input.principalId),
        eq(activityConnections.provider, input.provider),
      ),
    )
    .returning();
  if (!row) throw new ActivityConnectionError('connection_not_found', 'Activity connection not found');
  return row;
}

/** Store/rotate an opaque provider token and bind it atomically to its owner connection. */
export async function bindActivityTokenCredential(input: {
  principalId: string;
  connectionId: string;
  provider: string;
  providerAccountId: string;
  token: string;
  label: string;
}): Promise<ActivityConnection> {
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .select()
      .from(activityConnections)
      .where(
        and(
          eq(activityConnections.id, input.connectionId),
          eq(activityConnections.principalId, input.principalId),
          eq(activityConnections.provider, input.provider),
        ),
      )
      .limit(1);
    if (!connection) {
      throw new ActivityConnectionError('connection_not_found', 'Activity connection not found');
    }
    const payloadEnc = encryptPayload(JSON.stringify({ key: input.token }));
    const credentialId = connection.credentialId ?? randomActivityId('acred');
    if (connection.credentialId) {
      const rows = await tx
        .update(integrationCredentials)
        .set({
          integrationType: input.provider,
          label: input.label,
          kind: 'apikey',
          payloadEnc,
          updatedAt: new Date(),
        })
        .where(eq(integrationCredentials.id, connection.credentialId))
        .returning({ id: integrationCredentials.id });
      if (rows.length === 0) {
        throw new ActivityConnectionError('credential_mismatch', 'Bound credential is missing');
      }
    } else {
      await tx.insert(integrationCredentials).values({
        id: credentialId,
        integrationType: input.provider,
        label: input.label,
        kind: 'apikey',
        payloadEnc,
        metadata: { activityConnectionId: input.connectionId },
      });
    }
    const [updated] = await tx
      .update(activityConnections)
      .set({
        credentialId,
        providerAccountId: input.providerAccountId,
        status: 'active',
        healthStatus: null,
        healthMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(activityConnections.id, input.connectionId),
          eq(activityConnections.principalId, input.principalId),
        ),
      )
      .returning();
    return updated;
  });
}

/** Immediate read/sync revocation; the erase job performs durable deletion. */
export async function requestActivityConnectionErasure(
  principalId: string,
  connectionId: string,
): Promise<{ jobId: string; inserted: boolean }> {
  return db.transaction(async (tx) => {
    const [connection] = await tx
      .update(activityConnections)
      .set({ status: 'erasing', nextSyncAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(activityConnections.id, connectionId),
          eq(activityConnections.principalId, principalId),
        ),
      )
      .returning({ id: activityConnections.id, provider: activityConnections.provider });
    if (!connection) {
      throw new ActivityConnectionError('connection_not_found', 'Activity connection not found');
    }
    await tx
      .update(activityConsumerGrants)
      .set({
        allowed: false,
        version: sql`${activityConsumerGrants.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(activityConsumerGrants.connectionId, connectionId),
          eq(activityConsumerGrants.principalId, principalId),
        ),
      );
    await tx
      .update(activitySyncJobs)
      .set({ status: 'cancelled', finishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(activitySyncJobs.connectionId, connectionId),
          eq(activitySyncJobs.principalId, principalId),
          inArray(activitySyncJobs.status, ['queued', 'retry_wait']),
        ),
      );
    const jobId = stableActivityId('ajob', [principalId, 'erase', connectionId]);
    const rows = await tx
      .insert(activitySyncJobs)
      .values({
        id: jobId,
        principalId,
        connectionId,
        provider: connection.provider,
        kind: 'erase',
        status: 'queued',
        priority: 1,
        idempotencyKey: `erase:${connectionId}`,
      })
      .onConflictDoNothing({ target: activitySyncJobs.id })
      .returning({ id: activitySyncJobs.id });
    return { jobId, inserted: rows.length > 0 };
  });
}
