import { mkdir, writeFile, readFile, unlink, stat, appendFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { resolve, normalize, sep, isAbsolute, join, relative, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  isAzureStorageEnabled,
  azSaveBuffer,
  azReadBuffer,
  azAppendBuffer,
  azDelete,
  azSize,
  azSaveStream,
  azReadStream,
  azCopy,
} from './azure-blob';
import { PRIMARY_STORE, STORE_SEGMENT, activeStoreId, findStore, joinRelative, splitRelative } from './backends';
import { storeFor, type ByteStore } from './connected';

// The PRIMARY store has two interchangeable backends behind one interface:
//   • filesystem (default) — bytes under storeRoot(); used in local/homeserv dev.
//   • Azure Blob — used in prod when AZURE_STORAGE_CONNECTION_STRING is set.
// diskPath (an absolute path under storeRoot, shaped <root>/<uuid>/<name>) is
// the storage key in both modes; for Azure it maps to a blob name via
// toBlobName(). WorkflowFile rows therefore never change across the migration.
//
// A diskPath shaped <root>/@store/<id>/<uuid>/<name> lives in a CONNECTED store
// instead — an Azure container or S3 bucket the owner added on /drive (see
// ./backends). Every function below dispatches on the path, so a caller never
// needs to know which store a file is in.

function storeRoot(): string {
  const raw = process.env.WORKFLOW_FILES_ROOT ?? join(homedir(), '.openclaw', 'workflow-files');
  return resolve(raw);
}

function assertInsideRoot(abs: string): void {
  const normAbs = normalize(abs);
  const normRoot = normalize(storeRoot());
  if (!normAbs.startsWith(normRoot + sep) && normAbs !== normRoot) {
    throw new Error('path traversal blocked');
  }
}

// Blob name = diskPath relative to storeRoot, posix-style (blob keys use '/').
function toBlobName(absPath: string): string {
  assertInsideRoot(absPath);
  return relative(storeRoot(), normalize(absPath)).split(sep).join('/');
}

/** The connected store a path lives in, or null for the primary store. */
async function connected(absPath: string): Promise<{ store: ByteStore; key: string } | null> {
  const { store, key } = splitRelative(toBlobName(absPath));
  if (store === PRIMARY_STORE) return null;
  const saved = await findStore(store);
  if (!saved) {
    // Disconnected, or connected by a process whose settings this one cannot
    // see. ENOENT, so readers answer "gone" rather than 500.
    const e = new Error(`storage "${store}" is not connected`) as NodeJS.ErrnoException;
    e.code = 'ENOENT';
    throw e;
  }
  return { store: storeFor(saved), key };
}

function safeName(originalName: string): string {
  return (originalName || 'file').replace(/[^a-z0-9._-]/gi, '_').slice(0, 120) || 'file';
}

/** A new path in the PRIMARY store, whatever /drive's default is. */
export function newDiskPath(originalName: string): string {
  return join(storeRoot(), randomUUID(), safeName(originalName));
}

/**
 * A new path for a DRIVE file: in whichever store the owner made the default
 * on /drive. Platform files that only borrow the store (hero video, activity
 * imports, indexes) keep using newDiskPath.
 */
export async function allocateDiskPath(originalName: string): Promise<string> {
  const store = await activeStoreId();
  if (store === PRIMARY_STORE) return newDiskPath(originalName);
  return join(storeRoot(), STORE_SEGMENT, store, randomUUID(), safeName(originalName));
}

/** The same file's path in another store: the `<uuid>/<name>` tail is kept. */
export function diskPathIn(absPath: string, store: string): string {
  const { key } = splitRelative(toBlobName(absPath));
  return join(storeRoot(), ...joinRelative(store, key).split('/'));
}

export async function saveBuffer(absPath: string, buf: Buffer): Promise<void> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  const c = await connected(absPath);
  if (c) return c.store.save(c.key, buf);
  if (isAzureStorageEnabled()) {
    await azSaveBuffer(toBlobName(absPath), buf);
    return;
  }
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, buf);
}

export async function readBuffer(absPath: string): Promise<Buffer> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  const c = await connected(absPath);
  if (c) return c.store.read(c.key);
  if (isAzureStorageEnabled()) return azReadBuffer(toBlobName(absPath));
  return readFile(absPath);
}

export async function appendBuffer(absPath: string, buf: Buffer): Promise<number> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  const c = await connected(absPath);
  if (c) return c.store.append(c.key, buf);
  if (isAzureStorageEnabled()) return azAppendBuffer(toBlobName(absPath), buf);
  await mkdir(dirname(absPath), { recursive: true });
  await appendFile(absPath, buf);
  const s = await stat(absPath);
  return s.size;
}

export async function deleteFile(absPath: string): Promise<void> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  const c = await connected(absPath);
  if (c) return c.store.remove(c.key);
  if (isAzureStorageEnabled()) {
    await azDelete(toBlobName(absPath));
    return;
  }
  try {
    await unlink(absPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') throw err;
  }
}

export async function fileSize(absPath: string): Promise<number> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  const c = await connected(absPath);
  if (c) return c.store.size(c.key);
  if (isAzureStorageEnabled()) return azSize(toBlobName(absPath));
  const s = await stat(absPath);
  return s.size;
}

// ── streaming interface for large files ─────

export async function saveStream(absPath: string, readable: Readable): Promise<number> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  const c = await connected(absPath);
  if (c) return c.store.saveStream(c.key, readable);
  if (isAzureStorageEnabled()) return azSaveStream(toBlobName(absPath), readable);
  await mkdir(dirname(absPath), { recursive: true });
  await pipeline(readable, createWriteStream(absPath));
  const s = await stat(absPath);
  return s.size;
}

export async function readStream(absPath: string): Promise<Readable> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  const c = await connected(absPath);
  if (c) return c.store.readStream(c.key);
  if (isAzureStorageEnabled()) return azReadStream(toBlobName(absPath));
  // stat first so a missing file throws ENOENT here (→ caller's 410) instead of
  // as a mid-stream error after response headers are already committed.
  await stat(absPath);
  return createReadStream(absPath);
}

export async function copyFile(srcAbs: string, dstAbs: string): Promise<void> {
  if (!isAbsolute(srcAbs) || !isAbsolute(dstAbs)) throw new Error('absolute path required');
  assertInsideRoot(srcAbs);
  assertInsideRoot(dstAbs);
  const src = splitRelative(toBlobName(srcAbs)).store;
  const dst = splitRelative(toBlobName(dstAbs)).store;
  if (src !== PRIMARY_STORE || dst !== PRIMARY_STORE) {
    if (src === dst) {
      const c = (await connected(srcAbs))!;
      return c.store.copy(c.key, splitRelative(toBlobName(dstAbs)).key);
    }
    // Across stores the bytes have to come through this process.
    await saveStream(dstAbs, await readStream(srcAbs));
    return;
  }
  if (isAzureStorageEnabled()) {
    await azCopy(toBlobName(srcAbs), toBlobName(dstAbs));
    return;
  }
  await mkdir(dirname(dstAbs), { recursive: true });
  await pipeline(createReadStream(srcAbs), createWriteStream(dstAbs));
}

export { storeRoot };
