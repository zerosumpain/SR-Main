import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  kind: 'audio',
  recorded: [] as Array<{ id: string; text: string }>,
}));

vi.mock('$lib/server/native-handler', () => ({
  // The owner's lane, handler called straight through.
  withNativeAccess: (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) =>
    (event: unknown) => fn(event, {}, 'owner'),
}));
vi.mock('$lib/jkai/chat-access.server', () => ({
  MEMBER_DAILY_UPLOADS: 20,
  MEMBER_UPLOAD_KINDS: [],
  requireConversation: vi.fn(),
  reserveUsage: vi.fn(),
}));
vi.mock('$lib/jkai/media/upload', () => ({
  storeChatUpload: async (file: File) => ({
    id: 'att-1', originalName: file.name, kind: h.kind, mimeType: file.type, sizeBytes: file.size,
  }),
}));
vi.mock('$lib/jkai/media/preanalyse', () => ({
  recordPreanalysis: async (id: string, text: string) => { h.recorded.push({ id, text }); },
}));

const { POST } = await import('./+server');

function upload(query: string) {
  const url = new URL(`https://strangeramblings.com/api/native/chat/attachments?${query}`);
  const request = new Request(url, { method: 'POST', body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'audio/mp4' } });
  return (POST as unknown as (e: unknown) => Promise<Response>)({ request, url });
}

describe('POST /api/native/chat/attachments — an on-device transcript', () => {
  beforeEach(() => {
    h.kind = 'audio';
    h.recorded = [];
  });

  it('stores a voice note’s transcript as its pre-analysis, so no model has to hear it', async () => {
    const res = await upload(`filename=v.m4a&transcript=${encodeURIComponent('  pick up milk on the way home ')}`);
    expect(res.status).toBe(201);
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0].id).toBe('att-1');
    expect(h.recorded[0].text).toMatch(/pick up milk on the way home$/);
  });

  it('records nothing without a transcript, or for a file that is not audio', async () => {
    await upload('filename=v.m4a');
    await upload('filename=v.m4a&transcript=%20%20');
    h.kind = 'image';
    await upload('filename=p.jpg&transcript=hello');
    expect(h.recorded).toEqual([]);
  });

  it('caps a runaway transcript', async () => {
    await upload(`filename=v.m4a&transcript=${'a'.repeat(7000)}`);
    expect(h.recorded[0].text.endsWith('a'.repeat(6000))).toBe(true);
    expect(h.recorded[0].text).not.toContain('a'.repeat(6001));
  });
});
