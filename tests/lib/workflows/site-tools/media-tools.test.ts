import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;
const inserted: any[] = [];

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: (v: any) => ({
        returning: async () => { inserted.push(v); return [{ ...v, id: 'att-new', createdAt: new Date() }]; },
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ jkaiAttachments: {} }));
vi.mock('$lib/server/models/settings', () => ({
  getOpenRouterApiKey: async () => 'fake-or-key-for-test',
}));

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jkai-tool-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
  inserted.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('write_document', () => {
  it('saves text to disk and returns attachment ref', async () => {
    const { handleWriteDocument } = await import('$lib/workflows/site-tools/tools/media-write-document');
    const out = await handleWriteDocument(
      { filename: 'report.md', content: '# Hello', format: 'markdown' },
      { conversationId: 'c1', messageId: null },
    );
    expect(out.success).toBe(true);
    expect(out.attachments![0].kind).toBe('text');
    expect(out.attachments![0].mimeType).toBe('text/markdown');
    expect(inserted.length).toBe(1);
  });

  it('rejects filenames with path separators', async () => {
    const { handleWriteDocument } = await import('$lib/workflows/site-tools/tools/media-write-document');
    const out = await handleWriteDocument(
      { filename: '../../etc/passwd', content: 'x' },
      { conversationId: 'c1', messageId: null },
    );
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/filename/i);
  });

  it('infers format from extension', async () => {
    const { handleWriteDocument } = await import('$lib/workflows/site-tools/tools/media-write-document');
    const out = await handleWriteDocument(
      { filename: 'data.csv', content: 'a,b\n1,2' },
      { conversationId: 'c1', messageId: null },
    );
    expect(out.success).toBe(true);
    expect(out.attachments![0].mimeType).toBe('text/csv');
  });
});

describe('generate_image', () => {
  it('calls OpenRouter, saves the image, returns attachment', async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    globalThis.fetch = vi.fn(async (url: string) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('openrouter.ai')) {
        return new Response(JSON.stringify({
          data: [{ url: 'https://fake.example/x.png' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // Image download
      return new Response(fakePng, { status: 200, headers: { 'content-type': 'image/png' } });
    }) as any;

    const { handleGenerateImage } = await import('$lib/workflows/site-tools/tools/media-generate-image');
    const out = await handleGenerateImage(
      { prompt: 'a cat', aspect_ratio: '1:1', count: 1 },
      { conversationId: 'c1', messageId: null },
    );
    expect(out.success).toBe(true);
    expect(out.attachments?.[0].kind).toBe('image');
    expect(inserted.length).toBeGreaterThanOrEqual(1);
  });
});
