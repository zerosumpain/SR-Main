import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityImports,
  activitySyncJobs,
  type ActivityImport,
} from '$lib/db/schema';
import { deleteFile, newDiskPath, readBuffer, saveBuffer } from '$lib/file-store/storage';
import { decryptBuffer, encryptBuffer } from '$lib/secrets/crypto';
import { getCatalogProvider } from '../providers/catalog';
import { requireActivityConnection } from '../store/connections.server';
import { stableActivityId } from '../store/ids';
import { hasZipMagic } from './archive';

export const MAX_ACTIVITY_IMPORT_BYTES = 100 * 1024 * 1024;
export const ACTIVITY_IMPORT_REVIEW_MS = 7 * 24 * 60 * 60 * 1000;

export class ActivityImportError extends Error {
  constructor(
    readonly code: 'import_not_found' | 'invalid_import' | 'import_not_ready',
    message: string,
  ) {
    super(message);
    this.name = 'ActivityImportError';
  }
}

function safeFilename(value: string): string {
  return (value || 'archive.zip').replace(/[^a-z0-9._-]/gi, '_').slice(0, 120) || 'archive.zip';
}

export async function createActivityImport(input: {
  principalId: string;
  connectionId: string;
  filename: string;
  bytes: Buffer;
}): Promise<{ activityImport: ActivityImport; duplicate: boolean; jobId: string }> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_ACTIVITY_IMPORT_BYTES) {
    throw new ActivityImportError('invalid_import', 'Archive must be between 1 byte and 100 MB');
  }
  if (!hasZipMagic(input.bytes)) {
    throw new ActivityImportError('invalid_import', 'Upload must be a valid ZIP archive');
  }
  const connection = await requireActivityConnection(input.principalId, input.connectionId);
  if (connection.mode !== 'import') {
    throw new ActivityImportError('invalid_import', 'Connection does not accept archive imports');
  }
  const adapter = getCatalogProvider(connection.provider);
  if (!adapter?.inspectImport || !adapter.import) {
    throw new ActivityImportError('invalid_import', 'Provider has no archive importer');
  }

  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const id = stableActivityId('aimp', [
    input.principalId,
    connection.id,
    connection.provider,
    checksum,
  ]);
  const jobId = stableActivityId('ajob', [input.principalId, 'inspect_import', id]);
  const [existing] = await db
    .select()
    .from(activityImports)
    .where(and(eq(activityImports.id, id), eq(activityImports.principalId, input.principalId)))
    .limit(1);
  if (existing) return { activityImport: existing, duplicate: true, jobId };

  const filename = safeFilename(input.filename);
  const storageRef = newDiskPath(`activity-${id}-${filename}`);
  await saveBuffer(storageRef, encryptBuffer(input.bytes));
  try {
    const created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(activityImports)
        .values({
          id,
          principalId: input.principalId,
          connectionId: connection.id,
          provider: connection.provider,
          filename,
          archiveChecksum: checksum,
          storageRef,
          compressedBytes: input.bytes.byteLength,
          status: 'uploaded',
        })
        .onConflictDoNothing({ target: activityImports.id })
        .returning();
      if (!rows[0]) return null;
      await tx
        .insert(activitySyncJobs)
        .values({
          id: jobId,
          principalId: input.principalId,
          connectionId: connection.id,
          provider: connection.provider,
          kind: 'inspect_import',
          priority: 50,
          idempotencyKey: `inspect-import:${id}`,
          checkpoint: { importId: id },
        })
        .onConflictDoNothing({ target: activitySyncJobs.id });
      return rows[0];
    });
    if (!created) {
      await deleteFile(storageRef);
      const [winner] = await db
        .select()
        .from(activityImports)
        .where(and(eq(activityImports.id, id), eq(activityImports.principalId, input.principalId)))
        .limit(1);
      if (!winner) throw new ActivityImportError('invalid_import', 'Archive import could not be created');
      return { activityImport: winner, duplicate: true, jobId };
    }
    return { activityImport: created, duplicate: false, jobId };
  } catch (error) {
    await deleteFile(storageRef).catch(() => {});
    throw error;
  }
}

export async function getActivityImport(
  principalId: string,
  importId: string,
): Promise<ActivityImport | null> {
  const [row] = await db
    .select()
    .from(activityImports)
    .where(and(eq(activityImports.id, importId), eq(activityImports.principalId, principalId)))
    .limit(1);
  return row ?? null;
}

export async function requireActivityImport(
  principalId: string,
  importId: string,
): Promise<ActivityImport> {
  const row = await getActivityImport(principalId, importId);
  if (!row) throw new ActivityImportError('import_not_found', 'Activity import not found');
  return row;
}

export async function listActivityImports(
  principalId: string,
  connectionId: string,
): Promise<ActivityImport[]> {
  return db
    .select()
    .from(activityImports)
    .where(
      and(
        eq(activityImports.principalId, principalId),
        eq(activityImports.connectionId, connectionId),
      ),
    )
    .orderBy(desc(activityImports.createdAt));
}

export async function readActivityImportBytes(
  principalId: string,
  importId: string,
): Promise<{ row: ActivityImport; bytes: Buffer }> {
  const row = await requireActivityImport(principalId, importId);
  if (!row.storageRef) throw new ActivityImportError('invalid_import', 'Activity archive has been erased');
  return { row, bytes: decryptBuffer(await readBuffer(row.storageRef)) };
}

export async function confirmActivityImport(
  principalId: string,
  importId: string,
): Promise<{ jobId: string; inserted: boolean }> {
  const jobId = stableActivityId('ajob', [principalId, 'import', importId]);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(activityImports)
      .set({ status: 'importing', updatedAt: new Date() })
      .where(
        and(
          eq(activityImports.id, importId),
          eq(activityImports.principalId, principalId),
          eq(activityImports.status, 'ready'),
        ),
      )
      .returning();
    if (!row) {
      const [current] = await tx
        .select({ status: activityImports.status })
        .from(activityImports)
        .where(and(eq(activityImports.id, importId), eq(activityImports.principalId, principalId)))
        .limit(1);
      if (!current) throw new ActivityImportError('import_not_found', 'Activity import not found');
      if (current.status === 'importing' || current.status === 'succeeded') {
        return { jobId, inserted: false };
      }
      throw new ActivityImportError('import_not_ready', 'Activity import has not passed inspection');
    }
    const jobs = await tx
      .insert(activitySyncJobs)
      .values({
        id: jobId,
        principalId,
        connectionId: row.connectionId,
        provider: row.provider,
        kind: 'import',
        priority: 50,
        idempotencyKey: `import:${importId}`,
        checkpoint: { importId },
      })
      .onConflictDoNothing({ target: activitySyncJobs.id })
      .returning({ id: activitySyncJobs.id });
    return { jobId, inserted: jobs.length > 0 };
  });
}

export async function eraseActivityImportArchive(row: ActivityImport): Promise<void> {
  if (row.storageRef) await deleteFile(row.storageRef);
  await db
    .update(activityImports)
    .set({ storageRef: null, status: 'erased', retainedUntil: null, updatedAt: new Date() })
    .where(and(eq(activityImports.id, row.id), eq(activityImports.principalId, row.principalId)));
}
