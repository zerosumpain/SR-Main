import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JkaiAttachment } from '$lib/db/schema';

const readBuffer = vi.fn();
vi.mock('./storage', () => ({ readBuffer: (p: string) => readBuffer(p) }));

const { buildHermesAttachments, skippedAttachmentNote } = await import('./hermes-attachments');

function row(over: Partial<JkaiAttachment> = {}): JkaiAttachment {
  return {
    id: 'a1',
    conversationId: null,
    messageId: null,
    source: 'web',
    kind: 'image',
    mimeType: 'image/png',
    originalName: 'shot.png',
    sizeBytes: 4,
    diskPath: '2026/08/a1.png',
    duration: null,
    metadata: null,
    createdAt: new Date(),
    ...over,
  } as unknown as JkaiAttachment;
}

beforeEach(() => {
  readBuffer.mockReset();
});

describe('buildHermesAttachments', () => {
  it('base64s each attachment with the metadata the plugin reads', async () => {
    readBuffer.mockResolvedValue(Buffer.from('hey!'));

    const { attachments, skipped } = await buildHermesAttachments([row()]);

    expect(skipped).toEqual([]);
    expect(attachments).toEqual([
      {
        id: 'a1',
        kind: 'image',
        mime_type: 'image/png',
        original_name: 'shot.png',
        size_bytes: 4,
        data_b64: Buffer.from('hey!').toString('base64'),
      },
    ]);
  });

  it('round-trips the exact bytes', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    readBuffer.mockResolvedValue(bytes);

    const { attachments } = await buildHermesAttachments([row({ sizeBytes: bytes.byteLength })]);

    expect(Buffer.from(attachments[0].data_b64, 'base64')).toEqual(bytes);
  });

  it('stops at the budget and reports what it left behind', async () => {
    readBuffer.mockResolvedValue(Buffer.alloc(100));
    const rows = [
      row({ id: 'small', sizeBytes: 100, originalName: 'small.png' }),
      row({ id: 'huge', sizeBytes: 10_000, originalName: 'huge.mp4' }),
    ];

    const { attachments, skipped } = await buildHermesAttachments(rows, 500);

    expect(attachments.map((a) => a.id)).toEqual(['small']);
    expect(skipped).toEqual([{ id: 'huge', name: 'huge.mp4', reason: 'over-budget' }]);
  });

  it('skips a row whose bytes are gone instead of failing the turn', async () => {
    readBuffer
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(Buffer.from('ok'));

    const { attachments, skipped } = await buildHermesAttachments([
      row({ id: 'gone', originalName: 'gone.png' }),
      row({ id: 'here', originalName: 'here.png' }),
    ]);

    expect(attachments.map((a) => a.id)).toEqual(['here']);
    expect(skipped).toEqual([{ id: 'gone', name: 'gone.png', reason: 'unreadable' }]);
  });

  it('charges the budget the bytes actually read, not the recorded size', async () => {
    // A row whose sizeBytes under-reports must not let the payload overrun.
    readBuffer.mockResolvedValue(Buffer.alloc(400));
    const rows = [
      row({ id: 'first', sizeBytes: 10 }),
      row({ id: 'second', sizeBytes: 10 }),
    ];

    const { attachments, skipped } = await buildHermesAttachments(rows, 500);

    expect(attachments.map((a) => a.id)).toEqual(['first']);
    expect(skipped.map((s) => s.id)).toEqual(['second']);
  });
});

describe('skippedAttachmentNote', () => {
  it('is empty when everything was delivered', () => {
    expect(skippedAttachmentNote([])).toBe('');
  });

  it('names each undelivered file so the model can say so', () => {
    const note = skippedAttachmentNote([
      { id: '1', name: 'clip.mp4', reason: 'over-budget' },
      { id: '2', name: 'lost.png', reason: 'unreadable' },
    ]);
    expect(note).toContain('clip.mp4 (too large to send)');
    expect(note).toContain('lost.png (file missing)');
  });
});
