import { describe, it, expect, vi, beforeEach } from 'vitest';

const { describeImage, describePdfBestEffort, transcribeAudioBestEffort, dbUpdate, setSpy } =
  vi.hoisted(() => ({
    describeImage: vi.fn(),
    describePdfBestEffort: vi.fn(),
    transcribeAudioBestEffort: vi.fn(),
    dbUpdate: vi.fn(),
    setSpy: vi.fn(),
  }));

// Only the three extractors are mocked. `looksLikeRefusal` and `looksDegenerate`
// are the REAL implementations — a hand-rolled approximation of them would just
// be testing the approximation, and the first draft of this file proved it by
// passing a refusal that the real guard catches and the fake one did not.
vi.mock('$lib/file-index/describe', async (orig) => {
  const actual = await orig<typeof import('$lib/file-index/describe')>();
  return {
    ...actual,
    describeImage: (...a: unknown[]) => describeImage(...a),
    describePdfBestEffort: (...a: unknown[]) => describePdfBestEffort(...a),
    transcribeAudioBestEffort: (...a: unknown[]) => transcribeAudioBestEffort(...a),
  };
});

vi.mock('$lib/db', () => ({
  db: {
    update: () => {
      dbUpdate();
      return { set: (v: unknown) => { setSpy(v); return { where: async () => undefined }; } };
    },
  },
}));

import { preanalyseAttachment, preanalysisPartText } from '$lib/jkai/media/preanalyse';

const BUF = Buffer.from('bytes');

function att(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', kind: 'image', mimeType: 'image/png', originalName: 'shot.png',
    metadata: null, diskPath: '/tmp/x', sizeBytes: 5,
    conversationId: null, messageId: null, source: 'web', duration: null,
    createdAt: new Date(), ...over,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('preanalyseAttachment', () => {
  it('describes an image and caches the result', async () => {
    describeImage.mockResolvedValue('A red bicycle against a wall.');
    const r = await preanalyseAttachment(att(), BUF);
    expect(r).toMatchObject({ ok: true, cached: false });
    expect(r.text).toContain('red bicycle');
    expect(dbUpdate).toHaveBeenCalledOnce();
    expect(setSpy.mock.calls[0][0]).toMatchObject({
      metadata: { preanalysis: { v: 1, text: 'A red bicycle against a wall.' } },
    });
  });

  it('serves a cached description without calling the model', async () => {
    const r = await preanalyseAttachment(
      att({ metadata: { preanalysis: { v: 1, text: 'cached text', at: 'x' } } }),
      BUF,
    );
    expect(r).toMatchObject({ ok: true, cached: true, text: 'cached text' });
    expect(describeImage).not.toHaveBeenCalled();
  });

  it('ignores a cache entry from an older version', async () => {
    describeImage.mockResolvedValue('fresh description');
    const r = await preanalyseAttachment(
      att({ metadata: { preanalysis: { v: 0, text: 'stale', at: 'x' } } }),
      BUF,
    );
    expect(r.text).toBe('fresh description');
    expect(describeImage).toHaveBeenCalledOnce();
  });

  it('routes PDFs and audio to their own extractors', async () => {
    describePdfBestEffort.mockResolvedValue('page one text');
    transcribeAudioBestEffort.mockResolvedValue('hello there');
    const p = await preanalyseAttachment(att({ kind: 'pdf', mimeType: 'application/pdf' }), BUF);
    const a = await preanalyseAttachment(att({ kind: 'audio', mimeType: 'audio/mp4' }), BUF);
    expect(p.text).toBe('page one text');
    expect(a.text).toBe('hello there');
    expect(describeImage).not.toHaveBeenCalled();
  });

  describe('the two failure modes this repo has actually been bitten by', () => {
    it('does NOT cache a failure — a later fix must be able to retry', async () => {
      // A failed extract that gets stamped permanently is why every PDF in
      // production stayed broken after the pdf.worker fix landed.
      describeImage.mockResolvedValue(null);
      const r = await preanalyseAttachment(att(), BUF);
      expect(r.ok).toBe(false);
      expect(dbUpdate).not.toHaveBeenCalled();
    });

    it('treats a model refusal as a failure, not as a description', async () => {
      // "I can't help with that" stored as a description reads as fact to the
      // model downstream. The vision model declines roughly 1 run in 3.
      describeImage.mockResolvedValue("I'm sorry, I can't help with identifying people.");
      const r = await preanalyseAttachment(att(), BUF);
      expect(r.ok).toBe(false);
      expect(r.text).not.toContain('sorry');
      expect(dbUpdate).not.toHaveBeenCalled();
    });

    it('treats a degenerate answer as a failure', async () => {
      // The real case this guard was written for: grok answered a PDF request
      // with leaked tool scaffolding repeated until it filled the reply.
      describeImage.mockResolvedValue('```pdf_browse```pdf_browse```pdf_browse```pdf_browse');
      const r = await preanalyseAttachment(att(), BUF);
      expect(r.ok).toBe(false);
      expect(dbUpdate).not.toHaveBeenCalled();
    });

    it('treats a too-short answer as a failure', async () => {
      // `looksDegenerate` measures repetition, not brevity, and lets a bare "."
      // through. Four characters is not a description of an image.
      describeImage.mockResolvedValue('.');
      const r = await preanalyseAttachment(att(), BUF);
      expect(r.ok).toBe(false);
      expect(dbUpdate).not.toHaveBeenCalled();
    });
  });

  it('never throws when the extractor does, and never returns empty text', async () => {
    describeImage.mockRejectedValue(new Error('provider exploded'));
    const r = await preanalyseAttachment(att(), BUF);
    expect(r.ok).toBe(false);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('says so plainly for video, which has no extraction path', async () => {
    const r = await preanalyseAttachment(att({ kind: 'video', mimeType: 'video/mp4' }), BUF);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/video/i);
    expect(describeImage).not.toHaveBeenCalled();
  });

  it('tells the model to admit the gap rather than guess', async () => {
    describeImage.mockResolvedValue(null);
    const r = await preanalyseAttachment(att(), BUF);
    expect(preanalysisPartText(att(), r)).toMatch(/rather than guessing/i);
  });

  it('labels a successful description so the model knows what it is reading', async () => {
    transcribeAudioBestEffort.mockResolvedValue('the quick brown fox');
    const a = att({ kind: 'audio', originalName: 'note.m4a', mimeType: 'audio/mp4' });
    const out = await preanalyseAttachment(a, BUF);
    const part = preanalysisPartText(a, out);
    expect(part).toContain('Transcript of attached audio (note.m4a)');
    expect(part).toContain('the quick brown fox');
  });
});
