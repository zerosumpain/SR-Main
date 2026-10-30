// The phone's Drive, against the one `workflow_files` table and byte store that
// SR-Drive also serves. WHICH rows a caller reaches is $lib/drive/app-lane;
// this module only reads and writes what that has already allowed.
//
// Why here and not proxied to SR-Drive: the phone's identity is a device
// credential that only Main can verify, and Drive's gateway signs nothing but
// a browser session or the owner's service lane. Main already shares the table
// and the store (`$lib/file-store/storage` is byte-identical with Drive's), and
// keeps the same invariants Drive's writers keep:
//
//   - principal_id === principalForName(name)       (app-lane `storedName`)
//   - a member's file is never embedded or fed to intel; an owner upload is
//     indexed exactly as Drive's upload does it, an owner delete queues the
//     same `file-deleted` intel job Drive does
//   - `disk_path` and content hashes never leave the server
//   - a member's folder holds at most DRIVE_MEMBER_QUOTA_BYTES (2 GB), and so
//     does the shared one
//
// So /drive on the web and the phone show the same files: a member who also
// holds `drive:self` sees their phone uploads under their own folder there.

import { error } from '@sveltejs/kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { householdMember, workflowFiles, type WorkflowFile } from '$lib/db/schema';
import { allocateDiskPath, deleteFile, readBuffer, saveBuffer } from '$lib/file-store/storage';
import { MEMBER_ROOT } from '$lib/drive/namespace';
import {
  FOLDER_MARKER,
  OWNER_PRINCIPAL,
  cleanFolder,
  cleanName,
  inScope,
  listFolder,
  mayDelete,
  rowScope,
  spaceScope,
  storedName,
  underFolder,
  viewName,
  withSuffix,
  type AppDriveCaller,
  type DriveSpace,
  type ListedFolder,
  type SpaceScope,
} from '$lib/drive/app-lane';

/** Per file, as SR-Drive's upload. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** Mirrors SR-Drive's `memberQuotaBytes`. The owner's drive has no quota. */
export function memberQuotaBytes(): number {
  const raw = Number(env.DRIVE_MEMBER_QUOTA_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2 * 1024 ** 3;
}

const PERMISSIONS = { read: true, write: false, append: false, delete: false };

export interface NativeDriveFile {
  id: string;
  /** The file's own name. */
  name: string;
  /** Relative to its space, folders included. */
  path: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  /** Put here by this phone's person. */
  mine: boolean;
  /** Who put it there, by first name, in the shared folder only (never an email). */
  addedBy: string | null;
  canDelete: boolean;
}

export interface NativeDriveListing {
  space: DriveSpace;
  folder: string;
  folders: ListedFolder[];
  files: NativeDriveFile[];
  usage: { bytes: number; quotaBytes: number | null };
  maxUploadBytes: number;
}

/** The scope for a space, or a 403 — a member with no folder of their own has nothing to open. */
export function requireScope(caller: AppDriveCaller, space: DriveSpace): SpaceScope {
  const scope = spaceScope(caller, space);
  if (!scope) throw error(403, 'Your access does not include that.');
  return scope;
}

/** The SQL twin of app-lane `inScope`, so a list never fetches a row it would then drop. */
function scopeWhere(scope: SpaceScope) {
  const principal = eq(workflowFiles.principalId, scope.principal);
  if (scope.root === '') return and(principal, sql`left(${workflowFiles.name}, ${MEMBER_ROOT.length}) <> ${MEMBER_ROOT}`);
  return and(principal, sql`left(${workflowFiles.name}, ${scope.root.length}) = ${scope.root}`);
}

type Row = Pick<WorkflowFile, 'id' | 'name' | 'principalId' | 'mimeType' | 'sizeBytes' | 'uploadedBy' | 'createdAt' | 'updatedAt'>;

const ROW = {
  id: workflowFiles.id,
  name: workflowFiles.name,
  principalId: workflowFiles.principalId,
  mimeType: workflowFiles.mimeType,
  sizeBytes: workflowFiles.sizeBytes,
  uploadedBy: workflowFiles.uploadedBy,
  createdAt: workflowFiles.createdAt,
  updatedAt: workflowFiles.updatedAt,
};

/** A space's rows: filtered in SQL, and again here, so a query that ever loses its clause still leaks nothing. */
async function scopeRows(scope: SpaceScope): Promise<Row[]> {
  const rows = await db.select(ROW).from(workflowFiles).where(scopeWhere(scope));
  return rows.filter((r) => inScope(r, scope));
}

/** First names for the shared folder's "added by", from the household roster. Emails never leave. */
async function firstNames(emails: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ email: householdMember.email, displayName: householdMember.displayName })
    .from(householdMember)
    .where(inArray(householdMember.email, wanted));
  return new Map(
    rows
      .filter((r): r is { email: string; displayName: string } => !!r.email)
      .map((r) => [r.email.toLowerCase(), r.displayName.trim().split(/\s+/)[0] || 'Family']),
  );
}

function present(row: Row, scope: SpaceScope, caller: AppDriveCaller, names: Map<string, string>): NativeDriveFile {
  const path = viewName(row.name, scope);
  const by = (row.uploadedBy ?? '').trim().toLowerCase();
  const mine = scope.space === 'mine' || by === caller.email.toLowerCase();
  return {
    id: row.id,
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    mine,
    addedBy: scope.space === 'shared' ? (mine ? 'You' : (names.get(by) ?? 'Family')) : null,
    canDelete: mayDelete(row, scope, caller),
  };
}

export async function listSpace(caller: AppDriveCaller, space: DriveSpace, rawFolder: string | null): Promise<NativeDriveListing> {
  const scope = requireScope(caller, space);
  const folder = cleanFolder(rawFolder);
  if (folder === null) throw error(400, 'That is not a folder name.');
  const rows = await scopeRows(scope);
  const { folders, files } = listFolder(rows, scope, folder);
  const names = space === 'shared' ? await firstNames(files.map((f) => f.uploadedBy ?? '')) : new Map<string, string>();
  const bytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
  return {
    space,
    folder,
    folders,
    files: files.map((r) => present(r, scope, caller, names)),
    usage: { bytes, quotaBytes: scope.principal === OWNER_PRINCIPAL ? null : memberQuotaBytes() },
    maxUploadBytes: MAX_UPLOAD_BYTES,
  };
}

/** A row by id, if the caller may see it; otherwise 404, the same as no such file. */
async function visibleRow(caller: AppDriveCaller, id: string): Promise<{ row: WorkflowFile; scope: SpaceScope }> {
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, id)).limit(1);
  const scope = row ? rowScope(row, caller) : null;
  if (!row || !scope) throw error(404, 'No such file.');
  return { row, scope };
}

export async function readDriveFile(caller: AppDriveCaller, id: string): Promise<{ row: WorkflowFile; scope: SpaceScope; bytes: Buffer }> {
  const { row, scope } = await visibleRow(caller, id);
  if (row.name.endsWith(`/${FOLDER_MARKER}`) || row.name === FOLDER_MARKER) throw error(404, 'No such file.');
  try {
    return { row, scope, bytes: await readBuffer(row.diskPath) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') throw error(410, 'That file is no longer on the server.');
    throw err;
  }
}

async function bytesHeldBy(principalId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`coalesce(sum(${workflowFiles.sizeBytes}), 0)::bigint` })
    .from(workflowFiles)
    .where(eq(workflowFiles.principalId, principalId));
  return Number(row?.n ?? 0);
}

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /workflow_files_name_idx|unique|duplicate key|23505/i.test(msg);
}

/**
 * Store one file. A name already taken gets " (2)", " (3)"… — a phone sending
 * IMG_0001.jpg twice wants two photos, not an error.
 */
export async function uploadFile(
  caller: AppDriveCaller,
  input: { space: DriveSpace; folder: string | null; filename: string | null; mimeType: string; bytes: Buffer },
): Promise<NativeDriveFile> {
  const scope = requireScope(caller, input.space);
  const folder = cleanFolder(input.folder);
  if (folder === null) throw error(400, 'That is not a folder name.');
  const name = cleanName(input.filename);
  if (name === null) throw error(400, 'That file name cannot be used.');
  if (storedName(scope, folder, name) === null) throw error(400, 'That name cannot be used here.');
  if (input.bytes.byteLength === 0) throw error(400, 'The upload was empty.');
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw error(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  if (scope.principal !== OWNER_PRINCIPAL) {
    const quota = memberQuotaBytes();
    if ((await bytesHeldBy(scope.principal)) + input.bytes.byteLength > quota) {
      throw error(413, `This space is full — ${(quota / 1024 ** 3).toFixed(quota % 1024 ** 3 ? 2 : 0)} GB each.`);
    }
  }

  const diskPath = await allocateDiskPath(name);
  await saveBuffer(diskPath, input.bytes);
  for (let n = 1; n <= 50; n++) {
    const stored = storedName(scope, folder, withSuffix(name, n));
    if (stored === null) break;
    try {
      const [inserted] = await db
        .insert(workflowFiles)
        .values({
          name: stored,
          description: null,
          mimeType: input.mimeType || 'application/octet-stream',
          sizeBytes: input.bytes.byteLength,
          diskPath,
          permissions: PERMISSIONS,
          uploadedBy: caller.email.toLowerCase(),
          principalId: scope.principal,
        })
        .returning();
      if (!inserted) break;
      // The owner's files are embedded into @files, as Drive's upload does;
      // a member's or the shared folder's never are.
      if (scope.principal === OWNER_PRINCIPAL) {
        const { reindexFileInBackground } = await import('$lib/file-index/store');
        reindexFileInBackground(inserted.id);
      }
      return present(inserted, scope, caller, new Map());
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      await deleteFile(diskPath).catch(() => {});
      throw err;
    }
  }
  await deleteFile(diskPath).catch(() => {});
  throw error(409, 'That name is taken. Rename the file and try again.');
}

/** Make an empty folder: a `.keep` marker, as /drive does. Idempotent. */
export async function makeFolder(caller: AppDriveCaller, space: DriveSpace, rawParent: string | null, rawName: string | null) {
  const scope = requireScope(caller, space);
  const parent = cleanFolder(rawParent);
  const name = cleanName(rawName);
  if (parent === null || name === null) throw error(400, 'That folder name cannot be used.');
  const path = parent ? `${parent}/${name}` : name;
  if (cleanFolder(path) === null) throw error(400, 'That folder is too deep.');
  const stored = storedName(scope, path, FOLDER_MARKER);
  if (stored === null) throw error(400, 'That folder name is too long.');
  const diskPath = await allocateDiskPath(FOLDER_MARKER);
  await saveBuffer(diskPath, Buffer.alloc(0));
  try {
    await db.insert(workflowFiles).values({
      name: stored,
      description: null,
      mimeType: 'application/x-empty',
      sizeBytes: 0,
      diskPath,
      permissions: PERMISSIONS,
      uploadedBy: caller.email.toLowerCase(),
      principalId: scope.principal,
    });
  } catch (err) {
    await deleteFile(diskPath).catch(() => {});
    if (!isUniqueViolation(err)) throw err;
  }
  return { space, path };
}

async function removeRow(row: WorkflowFile): Promise<void> {
  await deleteFile(row.diskPath).catch((err) => console.warn('[native-drive] bytes not removed:', (err as Error).message));
  await db.delete(workflowFiles).where(eq(workflowFiles.id, row.id));
  // An owner file may have fed his graph; the same job Drive's delete queues.
  // A member's or the shared folder's never did.
  if (row.principalId === OWNER_PRINCIPAL) {
    const { enqueueIntelJob } = await import('$lib/intel-client/outbox');
    await enqueueIntelJob('file-deleted', row.id, undefined).catch((err) =>
      console.warn('[native-drive] could not queue intel cleanup:', (err as Error).message),
    );
  }
}

export async function deleteOne(caller: AppDriveCaller, id: string): Promise<void> {
  const { row, scope } = await visibleRow(caller, id);
  if (!mayDelete(row, scope, caller)) throw error(403, 'Only whoever added it can delete this.');
  await removeRow(row);
}

/**
 * Delete a folder and everything in it — only when every file in it is the
 * caller's to delete. In the shared folder that means a folder somebody else
 * has put things in stays.
 */
export async function deleteFolder(caller: AppDriveCaller, space: DriveSpace, rawFolder: string | null): Promise<{ deleted: number }> {
  const scope = requireScope(caller, space);
  const folder = cleanFolder(rawFolder);
  if (!folder) throw error(400, 'Choose a folder to delete.');
  const rows = (await db.select().from(workflowFiles).where(scopeWhere(scope))).filter(
    (r) => inScope(r, scope) && underFolder(r, scope, folder),
  );
  if (!rows.length) throw error(404, 'No such folder.');
  if (rows.some((r) => !mayDelete(r, scope, caller))) {
    throw error(409, 'Someone else has files in this folder, so it stays.');
  }
  for (const row of rows) await removeRow(row);
  return { deleted: rows.filter((r) => !r.name.endsWith(`/${FOLDER_MARKER}`)).length };
}

/** `filename*` per RFC 5987, plus an ASCII fallback. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Who the drive is answering, from what `withNativeAccess('drive', …)` set up —
 * never from anything the request says. The owner's device is the owner; a
 * member's device (or the owner viewing as one) is that member, with the
 * principal the gate resolved.
 */
export async function driveCaller(
  event: { locals: App.Locals },
  identity: { ownerEmail: string },
  role: 'owner' | 'member',
): Promise<AppDriveCaller> {
  if (role === 'owner') return { kind: 'owner', email: identity.ownerEmail.trim().toLowerCase() };
  const { viewerOf } = await import('$lib/server/viewer');
  const viewer = await viewerOf(event);
  if (viewer.kind !== 'member') throw error(403, 'Your access does not include that.');
  return { kind: 'member', email: viewer.email, principalId: viewer.principalId };
}
