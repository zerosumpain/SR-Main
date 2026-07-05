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

// The store has two interchangeable backends behind one interface:
//   • filesystem (default) — bytes under storeRoot(); used in local/homeserv dev.
//   • Azure Blob — used in prod when AZURE_STORAGE_CONNECTION_STRING is set.
// diskPath (an absolute path under storeRoot, shaped <root>/<uuid>/<name>) is
// the storage key in both modes; for Azure it maps to a blob name via
// toBlobName(). WorkflowFile rows therefore never change across the migration.

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

export function newDiskPath(originalName: string): string {
  const safe = (originalName || 'file').replace(/[^a-z0-9._-]/gi, '_').slice(0, 120) || 'file';
  return join(storeRoot(), randomUUID(), safe);
}

export async function saveBuffer(absPath: string, buf: Buffer): Promise<void> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
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
  if (isAzureStorageEnabled()) return azReadBuffer(toBlobName(absPath));
  return readFile(absPath);
}

export async function appendBuffer(absPath: string, buf: Buffer): Promise<number> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  if (isAzureStorageEnabled()) return azAppendBuffer(toBlobName(absPath), buf);
  await mkdir(dirname(absPath), { recursive: true });
  await appendFile(absPath, buf);
  const s = await stat(absPath);
  return s.size;
}

export async function deleteFile(absPath: string): Promise<void> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
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
  if (isAzureStorageEnabled()) return azSize(toBlobName(absPath));
  const s = await stat(absPath);
  return s.size;
}

// ── streaming interface (used by the WebDAV handler for large files) ─────────

export async function saveStream(absPath: string, readable: Readable): Promise<number> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  if (isAzureStorageEnabled()) return azSaveStream(toBlobName(absPath), readable);
  await mkdir(dirname(absPath), { recursive: true });
  await pipeline(readable, createWriteStream(absPath));
  const s = await stat(absPath);
  return s.size;
}

export async function readStream(absPath: string): Promise<Readable> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
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
  if (isAzureStorageEnabled()) {
    await azCopy(toBlobName(srcAbs), toBlobName(dstAbs));
    return;
  }
  await mkdir(dirname(dstAbs), { recursive: true });
  await pipeline(createReadStream(srcAbs), createWriteStream(dstAbs));
}

export { storeRoot };
