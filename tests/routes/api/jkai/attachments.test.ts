import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const inserted: any[] = [];

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: (v: any) => ({
        returning: async () => { inserted.push(v); return [{ ...v, id: 'att-1' }]; },
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ jkaiAttachments: {} }));

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jkai-upload-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
  inserted.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/jkai/attachments', () => {
  it('rejects missing file', async () => {
    const mod: any = await import('../../../../src/routes/api/jkai/attachments/+server');
    const fd = new FormData();
    fd.append('conversationId', 'conv-1');
    const req = new Request('http://x/api/jkai/attachments', { method: 'POST', body: fd });
    try {
      await mod.POST({ request: req } as any);
      throw new Error('expected rejection');
    } catch (e: any) {
      expect(e.status ?? e.body?.status).toBe(400);
    }
  });

  it('accepts a png and inserts a row', async () => {
    const mod: any = await import('../../../../src/routes/api/jkai/attachments/+server');
    const fd = new FormData();
    fd.append('conversationId', 'conv-1');
    const png = new Uint8Array([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
      0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
      0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xde,
    ]);
    fd.append('file', new Blob([png], { type: 'image/png' }), 'tiny.png');
    const req = new Request('http://x/api/jkai/attachments', { method: 'POST', body: fd });
    const res = await mod.POST({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('image');
    expect(body.mimeType).toBe('image/png');
    expect(inserted.length).toBe(1);
  });
});
