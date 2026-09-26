import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<{ mime: string; name: string }>, text: '', fail: false }));

vi.mock('$lib/db', () => ({
  db: { update: () => ({ set: () => ({ where: async () => undefined }) }) },
}));
vi.mock('$lib/file-index/describe', () => ({
  describeImage: vi.fn(),
  describePdfBestEffort: vi.fn(),
  looksLikeRefusal: () => false,
  looksDegenerate: () => false,
}));
vi.mock('$lib/jkai/extract/audio', () => ({
  extractAudio: async (_buf: Buffer, mime: string, name: string) => {
    h.calls.push({ mime, name });
    if (h.fail) throw new Error('Whisper transcription failed');
    return { text: h.text, meta: { kind: 'audio' } };
  },
}));

const { preanalyseAttachment } = await import('./preanalyse');

const voice = {
  id: 'a1', kind: 'audio', mimeType: 'audio/mp4', originalName: 'Voice note 2026-09-26 080046.m4a', metadata: null,
} as never;

describe('preanalyseAttachment — audio', () => {
  beforeEach(() => {
    h.calls = [];
    h.text = '';
    h.fail = false;
  });

  it('transcribes a chat voice note with the notebook’s speech-to-text', async () => {
    h.text = 'Remind me to book the car in on Monday.';
    const out = await preanalyseAttachment(voice, Buffer.from([1]));
    expect(h.calls).toEqual([{ mime: 'audio/mp4', name: 'Voice note 2026-09-26 080046.m4a' }]);
    expect(out).toMatchObject({ ok: true, text: 'Remind me to book the car in on Monday.' });
  });

  it('says it could not be read when transcription fails, rather than throwing', async () => {
    h.fail = true;
    const out = await preanalyseAttachment(voice, Buffer.from([1]));
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/could not be read/);
  });

  it('uses a cached transcript — the phone’s own — without transcribing again', async () => {
    const cached = { ...(voice as object), metadata: { preanalysis: { v: 1, text: 'Transcribed on the iPhone: hello there', at: 'x' } } };
    const out = await preanalyseAttachment(cached as never, Buffer.from([1]));
    expect(h.calls).toEqual([]);
    expect(out).toMatchObject({ ok: true, cached: true });
  });
});
