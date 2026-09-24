import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const inserted: any[] = [];
let paired = true;

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
vi.mock('$lib/file-index/jkai-mirror', () => ({ mirrorJkaiAttachmentToDrive: vi.fn() }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => (paired ? { id: 'dev-1', ownerEmail: 'owner@example.com' } : null),
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));

const PNG = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xde,
]);

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'native-upload-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
  inserted.length = 0;
  paired = true;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

async function post(fd: FormData) {
  const mod: any = await import('../../../../src/routes/api/native/chat/attachments/+server');
  const request = new Request('http://x/api/native/chat/attachments', {
    method: 'POST',
    body: fd,
    headers: { Authorization: 'Bearer t' },
  });
  return mod.POST({ request, url: new URL(request.url) } as any) as Promise<Response>;
}

describe('POST /api/native/chat/attachments', () => {
  it('stores a photo and answers in the transcript attachment shape', async () => {
    const fd = new FormData();
    fd.append('conversationId', 'conv-1');
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
    const res = await post(fd);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'att-1', filename: 'photo.png', kind: 'image', mimeType: 'image/png', sizeBytes: PNG.length,
    });
    expect(inserted[0].conversationId).toBe('conv-1');
  });

  it('never lets the phone label its upload as agent output', async () => {
    const fd = new FormData();
    fd.append('source', 'generated');
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
    await post(fd);
    expect(inserted[0].source).toBe('web');
  });

  it('says why a file was refused instead of a generic 500', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/x-msdownload' }), 'a.exe');
    const res = await post(fd);
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/unsupported mime type/);
    expect(inserted.length).toBe(0);
  });

  it('refuses an unpaired caller before reading the body', async () => {
    paired = false;
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
    const res = await post(fd);
    expect(res.status).toBe(401);
    expect(inserted.length).toBe(0);
  });
});
