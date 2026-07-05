import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve, normalize, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isAzureStorageEnabled, azSaveBuffer, azReadBuffer, azDelete } from './azure-blob';

// Two interchangeable backends behind one interface: filesystem (default, used
// in local/homeserv dev) and Azure Blob (prod, when AZURE_STORAGE_CONNECTION_STRING
// is set). `diskPath` is a relative key (`yyyy/mm/<uuid>.<ext>`) in both modes; for
// Azure it is the blob name directly, so stored references never change.

function mediaRoot(): string {
  const raw = process.env.JKAI_MEDIA_ROOT ?? join(homedir(), '.openclaw', 'jkai-media');
  return resolve(raw);
}

export function resolveAbsolutePath(diskPath: string): string {
  if (isAbsolute(diskPath)) throw new Error('absolute paths not allowed');
  const root = mediaRoot();
  const abs = resolve(root, diskPath);
  const normAbs = normalize(abs);
  const normRoot = normalize(root);
  if (!normAbs.startsWith(normRoot + sep) && normAbs !== normRoot) {
    throw new Error('path traversal blocked');
  }
  return normAbs;
}

// Blob name = the relative diskPath, posix-style, after the same traversal guard.
function toBlobName(diskPath: string): string {
  resolveAbsolutePath(diskPath); // reuse the traversal guard (throws on escape/absolute)
  return diskPath.split(sep).join('/');
}

export async function saveBuffer(
  buf: Buffer,
  ext: string,
): Promise<{ diskPath: string; sizeBytes: number }> {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = randomUUID();
  const cleanExt = ext.replace(/^\.+/, '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const diskPath = `${yyyy}/${mm}/${uuid}.${cleanExt}`;
  if (isAzureStorageEnabled()) {
    await azSaveBuffer(toBlobName(diskPath), buf);
    return { diskPath, sizeBytes: buf.byteLength };
  }
  const abs = resolveAbsolutePath(diskPath);
  await mkdir(join(mediaRoot(), yyyy, mm), { recursive: true });
  await writeFile(abs, buf);
  return { diskPath, sizeBytes: buf.byteLength };
}

export async function readBuffer(diskPath: string): Promise<Buffer> {
  if (isAzureStorageEnabled()) return azReadBuffer(toBlobName(diskPath));
  return readFile(resolveAbsolutePath(diskPath));
}

export async function deleteByDiskPath(diskPath: string): Promise<void> {
  if (isAzureStorageEnabled()) {
    await azDelete(toBlobName(diskPath));
    return;
  }
  try {
    await unlink(resolveAbsolutePath(diskPath));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}

export { mediaRoot };
