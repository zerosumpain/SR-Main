import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityConnections,
  activityDailyProjections,
  activityImports,
  activitySyncJobs,
  integrationCredentials,
  type ActivitySyncJob,
} from '$lib/db/schema';
import { getSetting } from '$lib/server/models/settings';
import { getCatalogProvider } from '../providers/catalog';
import { getActivityCursor, persistActivityPage } from '../store/events.server';
import { requireActivityConnection } from '../store/connections.server';
import { ACTIVITY_SETTINGS_ENABLED_KEY, activityProviderSettingKey } from '../config';
import type { ConnectionMode } from '../contracts';
import {
  ACTIVITY_IMPORT_REVIEW_MS,
  readActivityImportBytes,
} from '../imports/store.server';
import { deleteFile } from '$lib/file-store/storage';
import { ActivitySyncError, safeActivityErrorText } from './errors';
import {
  claimNextActivityJob,
  completeActivityJob,
  failActivityJob,
  updateActivityJobProgress,
} from './queue.server';

const DEFAULT_STREAM = 'default';

function errorKind(error: unknown): ActivitySyncError['kind'] {
  return error instanceof ActivitySyncError ? error.kind : 'internal';
}

async function providerEnabled(providerId: string): Promise<boolean> {
  // Explicit true only. The entire programme and each live provider are dark
  // until the owner enables them from operations/settings.
  const [fabric, provider] = await Promise.all([
    getSetting<boolean>(ACTIVITY_SETTINGS_ENABLED_KEY),
    getSetting<boolean>(activityProviderSettingKey(providerId)),
  ]);
  return fabric === true && provider === true;
}

async function markConnectionSuccess(connectionId: string): Promise<void> {
  await db
    .update(activityConnections)
    .set({
      status: 'active',
      healthStatus: 'healthy',
      healthMessage: null,
      lastSyncSucceededAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(activityConnections.id, connectionId));
}

async function markConnectionFailure(
  connectionId: string,
  error: unknown,
  kind: ActivitySyncError['kind'],
): Promise<void> {
  const actionRequired = kind === 'credential' || kind === 'private_source' || kind === 'policy_blocked';
  await db
    .update(activityConnections)
    .set({
      status: actionRequired ? 'action_required' : 'error',
      healthStatus: kind,
      healthMessage: safeActivityErrorText(error),
      lastSyncFailedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(activityConnections.id, connectionId));
}

async function runSyncJob(job: ActivitySyncJob, workerId: string): Promise<Record<string, unknown>> {
  if (!job.connectionId) {
    throw new ActivitySyncError('invalid_payload', 'Sync job has no connection');
  }
  const connection = await requireActivityConnection(job.principalId, job.connectionId);
  if (connection.status === 'erasing' || connection.status === 'disconnected') {
    throw new ActivitySyncError('policy_blocked', 'Connection is not allowed to sync');
  }
  if (!(await providerEnabled(connection.provider))) {
    throw new ActivitySyncError('policy_blocked', 'Activity provider is disabled');
  }
  const adapter = getCatalogProvider(connection.provider);
  if (!adapter?.sync) {
    throw new ActivitySyncError('policy_blocked', 'Provider has no live sync adapter');
  }

  const observedAt = new Date().toISOString();
  const cursor = await getActivityCursor(job.principalId, connection.id, DEFAULT_STREAM);
  const context = {
    principalId: job.principalId,
    connectionId: connection.id,
    providerId: connection.provider,
    providerAccountId: connection.providerAccountId,
    mode: connection.mode as ConnectionMode,
    scopes: connection.scopes,
    credentialId: connection.credentialId,
    observedAt,
    cursor,
  };

  await db
    .update(activityConnections)
    .set({ lastSyncStartedAt: new Date(), updatedAt: new Date() })
    .where(eq(activityConnections.id, connection.id));

  let pages = 0;
  let inserted = 0;
  let duplicates = 0;
  let warnings = 0;
  for await (const page of adapter.sync(context)) {
    const result = await persistActivityPage({
      adapter,
      principalId: job.principalId,
      connectionId: connection.id,
      stream: DEFAULT_STREAM,
      page,
      observedAt,
    });
    pages++;
    inserted += result.inserted;
    duplicates += result.duplicates;
    warnings += page.warnings?.length ?? 0;
    const ownsLease = await updateActivityJobProgress(job.id, workerId, {
      checkpoint: page.nextCursor ?? {},
      progress: { pages, inserted, duplicates, warnings },
    });
    if (!ownsLease) throw new ActivitySyncError('internal', 'Activity job lease was lost');
  }

  await markConnectionSuccess(connection.id);
  return { pages, inserted, duplicates, warnings };
}

async function runEraseJob(job: ActivitySyncJob): Promise<Record<string, unknown>> {
  if (!job.connectionId) {
    // A replay after a completed cascading delete is already complete.
    return { erased: true, replay: true };
  }
  const connection = await requireActivityConnection(job.principalId, job.connectionId);
  const adapter = getCatalogProvider(connection.provider);
  if (adapter?.disconnect) {
    await adapter.disconnect({
      principalId: job.principalId,
      connectionId: connection.id,
      providerId: connection.provider,
      providerAccountId: connection.providerAccountId,
      mode: connection.mode as ConnectionMode,
      scopes: connection.scopes,
      credentialId: connection.credentialId,
      observedAt: new Date().toISOString(),
    });
  }

  const credentialId = connection.credentialId;
  const archives = await db
    .select({ storageRef: activityImports.storageRef })
    .from(activityImports)
    .where(
      and(
        eq(activityImports.principalId, job.principalId),
        eq(activityImports.connectionId, connection.id),
      ),
    );
  // Bytes first, rows second. A file deletion failure retries while the
  // connection is still read-revoked; deleting rows first would orphan bytes.
  for (const archive of archives) {
    if (archive.storageRef) await deleteFile(archive.storageRef);
  }
  await db.transaction(async (tx) => {
    // Projections have their own connection FK so this delete cannot leave a
    // revoked source contributing to Daydream while a rebuild waits.
    await tx
      .delete(activityDailyProjections)
      .where(
        and(
          eq(activityDailyProjections.principalId, job.principalId),
          eq(activityDailyProjections.connectionId, connection.id),
        ),
      );
    await tx
      .delete(activityConnections)
      .where(
        and(
          eq(activityConnections.id, connection.id),
          eq(activityConnections.principalId, job.principalId),
        ),
      );

    if (credentialId) {
      const [shared] = await tx
        .select({ id: activityConnections.id })
        .from(activityConnections)
        .where(
          and(
            eq(activityConnections.credentialId, credentialId),
            ne(activityConnections.id, connection.id),
          ),
        )
        .limit(1);
      if (!shared) {
        await tx.delete(integrationCredentials).where(eq(integrationCredentials.id, credentialId));
      }
    }
  });
  return { erased: true, replay: false };
}

function importIdFromJob(job: ActivitySyncJob): string {
  const importId = job.checkpoint.importId;
  if (typeof importId !== 'string' || !importId) {
    throw new ActivitySyncError('invalid_payload', 'Import job has no importId');
  }
  return importId;
}

async function runInspectImportJob(job: ActivitySyncJob): Promise<Record<string, unknown>> {
  if (!(await providerEnabled(job.provider))) {
    throw new ActivitySyncError('policy_blocked', 'Activity provider is disabled');
  }
  const importId = importIdFromJob(job);
  const { row, bytes } = await readActivityImportBytes(job.principalId, importId);
  const adapter = getCatalogProvider(row.provider);
  if (!adapter?.inspectImport) {
    throw new ActivitySyncError('policy_blocked', 'Provider has no import inspector');
  }
  await db
    .update(activityImports)
    .set({ status: 'inspecting', updatedAt: new Date() })
    .where(and(eq(activityImports.id, row.id), eq(activityImports.principalId, job.principalId)));
  const inspection = await adapter.inspectImport({ name: row.filename, bytes });
  await db
    .update(activityImports)
    .set({
      status: 'ready',
      format: inspection.format,
      formatVersion: inspection.formatVersion ?? null,
      expandedBytes: inspection.expandedBytes ?? null,
      manifest: inspection as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(and(eq(activityImports.id, row.id), eq(activityImports.principalId, job.principalId)));
  return {
    importId,
    format: inspection.format,
    estimatedRecords: inspection.estimatedRecords,
    warnings: inspection.warnings.length,
  };
}

async function runImportJob(job: ActivitySyncJob, workerId: string): Promise<Record<string, unknown>> {
  if (!(await providerEnabled(job.provider))) {
    throw new ActivitySyncError('policy_blocked', 'Activity provider is disabled');
  }
  const importId = importIdFromJob(job);
  const { row, bytes } = await readActivityImportBytes(job.principalId, importId);
  if (!job.connectionId || row.connectionId !== job.connectionId) {
    throw new ActivitySyncError('invalid_payload', 'Import job connection does not match archive');
  }
  const connection = await requireActivityConnection(job.principalId, job.connectionId);
  const adapter = getCatalogProvider(row.provider);
  if (!adapter?.import) throw new ActivitySyncError('policy_blocked', 'Provider has no archive importer');
  const context = {
    principalId: job.principalId,
    connectionId: connection.id,
    providerId: connection.provider,
    providerAccountId: connection.providerAccountId,
    mode: connection.mode as ConnectionMode,
    scopes: connection.scopes,
    credentialId: connection.credentialId,
    observedAt: new Date().toISOString(),
    cursor: null,
  };
  let pages = 0;
  let inserted = 0;
  let duplicates = 0;
  let warnings = 0;
  for await (const page of adapter.import(context, {
    importId,
    name: row.filename,
    bytes,
  })) {
    const result = await persistActivityPage({
      adapter,
      principalId: job.principalId,
      connectionId: connection.id,
      stream: `import:${importId}`,
      page,
      observedAt: context.observedAt,
    });
    pages++;
    inserted += result.inserted;
    duplicates += result.duplicates;
    warnings += page.warnings?.length ?? 0;
    const ownsLease = await updateActivityJobProgress(job.id, workerId, {
      checkpoint: { importId, cursor: page.nextCursor ?? {} },
      progress: { pages, inserted, duplicates, warnings },
    });
    if (!ownsLease) throw new ActivitySyncError('internal', 'Activity import job lease was lost');
  }
  const report = { pages, inserted, duplicates, warnings };
  await db
    .update(activityImports)
    .set({
      status: 'succeeded',
      report,
      completedAt: new Date(),
      retainedUntil: new Date(Date.now() + ACTIVITY_IMPORT_REVIEW_MS),
      updatedAt: new Date(),
    })
    .where(and(eq(activityImports.id, importId), eq(activityImports.principalId, job.principalId)));
  await markConnectionSuccess(connection.id);
  return { importId, ...report };
}

export async function executeActivityJob(
  job: ActivitySyncJob,
  workerId: string,
): Promise<Record<string, unknown>> {
  if (job.kind === 'initial_sync' || job.kind === 'incremental_sync') {
    return runSyncJob(job, workerId);
  }
  if (job.kind === 'erase') return runEraseJob(job);
  if (job.kind === 'inspect_import') return runInspectImportJob(job);
  if (job.kind === 'import') return runImportJob(job, workerId);
  throw new ActivitySyncError('policy_blocked', `Job kind ${job.kind} is not implemented yet`);
}

export async function runNextActivityJob(workerId: string): Promise<{
  outcome: 'empty' | 'succeeded' | 'retry_wait' | 'failed' | 'lost_lease';
  jobId?: string;
  detail?: Record<string, unknown>;
}> {
  const job = await claimNextActivityJob(workerId);
  if (!job) return { outcome: 'empty' };
  try {
    const detail = await executeActivityJob(job, workerId);
    const completed = await completeActivityJob(job.id, workerId, detail);
    return completed
      ? { outcome: 'succeeded', jobId: job.id, detail }
      : { outcome: 'lost_lease', jobId: job.id };
  } catch (error) {
    const kind = errorKind(error);
    if (
      job.connectionId &&
      (job.kind === 'initial_sync' || job.kind === 'incremental_sync')
    ) {
      await markConnectionFailure(job.connectionId, error, kind).catch(() => {});
    }
    const outcome = await failActivityJob({
      job,
      workerId,
      kind,
      error,
      retryAt: error instanceof ActivitySyncError ? error.retryAt : undefined,
    });
    if (outcome === 'failed' && (job.kind === 'inspect_import' || job.kind === 'import')) {
      const importId = typeof job.checkpoint.importId === 'string' ? job.checkpoint.importId : null;
      if (importId) {
        await db
          .update(activityImports)
          .set({
            status: 'failed',
            report: { errorCode: kind, error: safeActivityErrorText(error) },
            updatedAt: new Date(),
          })
          .where(and(eq(activityImports.id, importId), eq(activityImports.principalId, job.principalId)))
          .catch(() => {});
      }
    }
    return { outcome, jobId: job.id, detail: { kind } };
  }
}

/** Number of due jobs, for heartbeat/operator summaries without payload reads. */
export async function dueActivityJobCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activitySyncJobs)
    .where(
      and(
        sql`${activitySyncJobs.status} in ('queued', 'retry_wait')`,
        sql`${activitySyncJobs.runAfter} <= now()`,
      ),
    );
  return row?.count ?? 0;
}
