import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve, normalize, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

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
  const abs = resolveAbsolutePath(diskPath);
  await mkdir(join(mediaRoot(), yyyy, mm), { recursive: true });
  await writeFile(abs, buf);
  return { diskPath, sizeBytes: buf.byteLength };
}

export async function readBuffer(diskPath: string): Promise<Buffer> {
  return readFile(resolveAbsolutePath(diskPath));
}

export async function deleteByDiskPath(diskPath: string): Promise<void> {
  try {
    await unlink(resolveAbsolutePath(diskPath));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

export { mediaRoot };
