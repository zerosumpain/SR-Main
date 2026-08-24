import { describe, it, expect, vi, beforeEach } from 'vitest';

const { preanalyse } = vi.hoisted(() => ({ preanalyse: vi.fn() }));

vi.mock('$lib/jkai/media/storage', () => ({ readBuffer: async () => Buffer.from('bytes') }));
vi.mock('$lib/jkai/media/preanalyse', () => ({
  preanalyseAttachment: (...a: unknown[]) => preanalyse(...a),
  preanalysisPartText: (_att: unknown, o: { ok: boolean; text: string }) =>
    o.ok ? `--- description ---\n${o.text}` : o.text,
}));

import { buildMultimodalContent } from '$lib/jkai/media/multimodal';

const TEXT_ONLY = { image: false, audio: false, video: false, pdf: false, documentText: true };
const ALL = { image: true, audio: true, video: true, pdf: true, documentText: true };

function att(kind: string, mime: string) {
  return { id: 'a', kind, mimeType: mime, originalName: `f.${kind}`, diskPath: '/tmp/f', metadata: null } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  preanalyse.mockResolvedValue({ ok: true, text: 'a red bicycle', cached: false });
});

describe('buildMultimodalContent capability gating', () => {
  it('sends a native image part when the model reads images', async () => {
    const parts = await buildMultimodalContent('look', [att('image', 'image/png')], { caps: ALL });
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url']);
    expect(preanalyse).not.toHaveBeenCalled();
  });

  it('substitutes a description when the model CANNOT read images', async () => {
    const parts = await buildMultimodalContent('look', [att('image', 'image/png')], {
      caps: TEXT_ONLY,
    });
    expect(parts.map((p) => p.type)).toEqual(['text', 'text']);
    expect(parts[1]).toMatchObject({ text: expect.stringContaining('a red bicycle') });
    expect(preanalyse).toHaveBeenCalledOnce();
  });

  it('substitutes for PDFs and audio the model cannot read', async () => {
    const pdf = await buildMultimodalContent('', [att('pdf', 'application/pdf')], { caps: TEXT_ONLY });
    const aud = await buildMultimodalContent('', [att('audio', 'audio/mp4')], { caps: TEXT_ONLY });
    expect(pdf.every((p) => p.type === 'text')).toBe(true);
    expect(aud.every((p) => p.type === 'text')).toBe(true);
    expect(preanalyse).toHaveBeenCalledTimes(2);
  });

  it('passes an extraction failure through as honest text rather than dropping it', async () => {
    // Silently dropping the attachment is the failure mode: the model then
    // answers as though nothing was attached.
    preanalyse.mockResolvedValue({ ok: false, text: '[image could not be read]', cached: false });
    const parts = await buildMultimodalContent('what is this', [att('image', 'image/png')], {
      caps: TEXT_ONLY,
    });
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ text: expect.stringContaining('could not be read') });
  });

  it('leaves plain text attachments alone — they were never a modality problem', async () => {
    const parts = await buildMultimodalContent('', [att('text', 'text/plain')], { caps: TEXT_ONLY });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('text');
    expect(preanalyse).not.toHaveBeenCalled();
  });

  it('WITHOUT caps behaves exactly as before — native parts, no pre-analysis', async () => {
    // This is the Hermes path and any other caller that handles media itself.
    // Changing it would have been a silent regression for them.
    const parts = await buildMultimodalContent('x', [
      att('image', 'image/png'),
      att('audio', 'audio/mp4'),
      att('pdf', 'application/pdf'),
    ]);
    expect(parts.map((p) => p.type)).toEqual(['text', 'image_url', 'input_audio', 'file']);
    expect(preanalyse).not.toHaveBeenCalled();
  });
});
