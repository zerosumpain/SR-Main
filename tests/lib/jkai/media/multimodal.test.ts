import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jkai-mm-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('buildMultimodalContent', () => {
  it('returns a text-only part when no attachments', async () => {
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('hello', []);
    expect(parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('inlines text files with header framing', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from('console.log(1)'), 'js');
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('explain', [
      {
        id: 'a1', conversationId: null, messageId: null, source: 'web',
        kind: 'text', mimeType: 'text/javascript',
        originalName: 'code.js', sizeBytes: 14, diskPath,
        duration: null, metadata: null, createdAt: new Date(),
      } as any,
    ]);
    expect(parts[0]).toEqual({ type: 'text', text: 'explain' });
    expect(parts[1].type).toBe('text');
    expect((parts[1] as any).text).toContain('--- File: code.js');
    expect((parts[1] as any).text).toContain('console.log(1)');
    expect((parts[1] as any).text).toContain('--- end ---');
  });

  it('image becomes image_url data URL', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'png');
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('', [{
      id: 'a1', conversationId: null, messageId: null, source: 'web',
      kind: 'image', mimeType: 'image/png', originalName: null,
      sizeBytes: 4, diskPath, duration: null, metadata: null, createdAt: new Date(),
    } as any]);
    expect(parts[0].type).toBe('image_url');
    expect((parts[0] as any).image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('audio becomes input_audio with format', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from([0xff, 0xfb]), 'mp3');
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('listen', [{
      id: 'a1', conversationId: null, messageId: null, source: 'web',
      kind: 'audio', mimeType: 'audio/mpeg', originalName: null,
      sizeBytes: 2, diskPath, duration: null, metadata: null, createdAt: new Date(),
    } as any]);
    expect(parts[1].type).toBe('input_audio');
    expect((parts[1] as any).input_audio.format).toBe('mp3');
    expect((parts[1] as any).input_audio.data).toBeTypeOf('string');
  });

  it('pdf becomes file part', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from('%PDF-1.4'), 'pdf');
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('', [{
      id: 'a1', conversationId: null, messageId: null, source: 'web',
      kind: 'pdf', mimeType: 'application/pdf', originalName: 'doc.pdf',
      sizeBytes: 8, diskPath, duration: null, metadata: null, createdAt: new Date(),
    } as any]);
    expect(parts[0].type).toBe('file');
    expect((parts[0] as any).file.filename).toBe('doc.pdf');
    expect((parts[0] as any).file.file_data).toMatch(/^data:application\/pdf;base64,/);
  });
});

describe('encodedSizeBytes', () => {
  it('sums content lengths across part types', async () => {
    const { encodedSizeBytes } = await import('$lib/jkai/media/multimodal');
    const size = encodedSizeBytes([
      { type: 'text', text: 'hello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ] as any);
    expect(size).toBe(5 + 'data:image/png;base64,AAA'.length);
  });
});
