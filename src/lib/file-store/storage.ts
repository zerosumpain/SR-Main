import { mkdir, writeFile, readFile, unlink, stat, appendFile } from 'node:fs/promises';
import { resolve, normalize, sep, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

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

export function newDiskPath(originalName: string): string {
  const safe = (originalName || 'file').replace(/[^a-z0-9._-]/gi, '_').slice(0, 120) || 'file';
  return join(storeRoot(), randomUUID(), safe);
}

export async function saveBuffer(absPath: string, buf: Buffer): Promise<void> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  await mkdir(absPath.substring(0, absPath.lastIndexOf(sep)), { recursive: true });
  await writeFile(absPath, buf);
}

export async function readBuffer(absPath: string): Promise<Buffer> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  return readFile(absPath);
}

export async function appendBuffer(absPath: string, buf: Buffer): Promise<number> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
  await mkdir(absPath.substring(0, absPath.lastIndexOf(sep)), { recursive: true });
  await appendFile(absPath, buf);
  const s = await stat(absPath);
  return s.size;
}

export async function deleteFile(absPath: string): Promise<void> {
  if (!isAbsolute(absPath)) throw new Error('absolute path required');
  assertInsideRoot(absPath);
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
  const s = await stat(absPath);
  return s.size;
}

export { storeRoot };
