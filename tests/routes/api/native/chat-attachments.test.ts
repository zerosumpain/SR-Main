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

async function post(body: BodyInit, query: Record<string, string> = {}, type = 'image/png') {
  const mod: any = await import('../../../../src/routes/api/native/chat/attachments/+server');
  const url = new URL('http://x/api/native/chat/attachments');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const request = new Request(url, {
    method: 'POST',
    body,
    headers: { Authorization: 'Bearer t', 'Content-Type': type },
  });
  return mod.POST({ request, url } as any) as Promise<Response>;
}

describe('POST /api/native/chat/attachments', () => {
  it('is never sent as a form, which SvelteKit would refuse without an Origin', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/routes/api/native/chat/attachments/+server.ts', 'utf8');
    expect(src).not.toContain('request.formData()');
  });


  it('stores a photo and answers in the transcript attachment shape', async () => {
    const res = await post(PNG, { conversationId: 'conv-1', filename: 'photo.png' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'att-1', filename: 'photo.png', kind: 'image', mimeType: 'image/png', sizeBytes: PNG.length,
    });
    expect(inserted[0].conversationId).toBe('conv-1');
  });

  it('never lets the phone label its upload as agent output', async () => {
    await post(PNG, { filename: 'photo.png', source: 'generated' });
    expect(inserted[0].source).toBe('web');
  });

  it('says why a file was refused instead of a generic 500', async () => {
    const res = await post(new Uint8Array([0, 1, 2, 3]), { filename: 'a.exe' }, 'application/x-msdownload');
    expect(res.status).toBe(415);
    expect((await res.json()).error).toMatch(/unsupported mime type/);
    expect(inserted.length).toBe(0);
  });

  it('refuses an unpaired caller before reading the body', async () => {
    paired = false;
    const res = await post(PNG, { filename: 'photo.png' });
    expect(res.status).toBe(401);
    expect(inserted.length).toBe(0);
  });
});
