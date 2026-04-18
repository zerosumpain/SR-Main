import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jkai-media-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('storage', () => {
  it('saveBuffer writes to YYYY/MM/<uuid>.<ext> and reports size', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const buf = Buffer.from('hello');
    const { diskPath, sizeBytes } = await saveBuffer(buf, 'txt');
    expect(sizeBytes).toBe(5);
    expect(diskPath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]+\.txt$/);
    const s = await stat(join(tmpRoot, diskPath));
    expect(s.size).toBe(5);
  });

  it('readBuffer returns the bytes written', async () => {
    const { saveBuffer, readBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from('abc'), 'txt');
    const back = await readBuffer(diskPath);
    expect(back.toString('utf8')).toBe('abc');
  });

  it('deleteByDiskPath removes the file', async () => {
    const { saveBuffer, deleteByDiskPath } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from('x'), 'txt');
    await deleteByDiskPath(diskPath);
    await expect(readFile(join(tmpRoot, diskPath))).rejects.toThrow();
  });

  it('resolveAbsolutePath rejects path traversal', async () => {
    const { resolveAbsolutePath } = await import('$lib/jkai/media/storage');
    expect(() => resolveAbsolutePath('../etc/passwd')).toThrow();
    expect(() => resolveAbsolutePath('/etc/passwd')).toThrow();
    expect(() => resolveAbsolutePath('2026/04/abc.txt')).not.toThrow();
  });
});
