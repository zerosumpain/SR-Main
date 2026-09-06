import { describe, it, expect, vi } from 'vitest';
import {
  planAttachments,
  attachmentSection,
  skippedAttachmentsNote,
  fetchAttachmentText,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_THREAD,
  MAX_ATTACHMENT_CHARS,
  type AttachmentRefInput,
} from '$lib/jkai/intel/gmail-attachments';

const ref = (over: Partial<AttachmentRefInput> = {}): AttachmentRefInput => ({
  attachmentId: 'a1',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  ...over,
});

describe('planAttachments', () => {
  it('fetches a supported document', () => {
    const plan = planAttachments([ref()]);
    expect(plan.fetch).toHaveLength(1);
    expect(plan.fetch[0].kind).toBe('pdf');
    expect(plan.skipped).toHaveLength(0);
  });

  it('skips images, which are signature logos far more often than intelligence', () => {
    const plan = planAttachments([
      ref({ filename: 'logo.png', mimeType: 'image/png' }),
      ref({ filename: 'image001.jpg', mimeType: 'image/jpeg' }),
    ]);
    expect(plan.fetch).toHaveLength(0);
    expect(plan.skipped.map((s) => s.filename)).toEqual(['logo.png', 'image001.jpg']);
  });

  it('skips calendar and contact attachments', () => {
    const plan = planAttachments([ref({ filename: 'invite.ics', mimeType: 'text/calendar' })]);
    expect(plan.fetch).toHaveLength(0);
  });

  it('skips audio and video rather than transcribing a mailbox', () => {
    const plan = planAttachments([
      ref({ filename: 'voice.m4a', mimeType: 'audio/mp4' }),
      ref({ filename: 'clip.mp4', mimeType: 'video/mp4' }),
    ]);
    expect(plan.fetch).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
  });

  it('skips anything over the size ceiling, naming it', () => {
    const plan = planAttachments([ref({ filename: 'huge.pdf', sizeBytes: MAX_ATTACHMENT_BYTES + 1 })]);
    expect(plan.fetch).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/too large/);
  });

  it('skips an unsupported type but records it', () => {
    const plan = planAttachments([ref({ filename: 'archive.zip', mimeType: 'application/zip' })]);
    expect(plan.fetch).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/unsupported/);
  });

  it('enforces the per-thread budget and says so', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_THREAD + 3 }, (_, i) =>
      ref({ attachmentId: `a${i}`, filename: `doc${i}.pdf`, sizeBytes: 1000 + i }),
    );
    const plan = planAttachments(many);
    expect(plan.fetch).toHaveLength(MAX_ATTACHMENTS_PER_THREAD);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.skipped.every((s) => /budget/.test(s.reason))).toBe(true);
  });

  it('prefers documents over spreadsheets, and bigger over smaller within a kind', () => {
    const plan = planAttachments(
      [
        ref({ attachmentId: 'x', filename: 'data.csv', mimeType: 'text/csv', sizeBytes: 9000 }),
        ref({ attachmentId: 'y', filename: 'small.pdf', sizeBytes: 100 }),
        ref({ attachmentId: 'z', filename: 'big.pdf', sizeBytes: 5000 }),
      ],
      { maxCount: 3 },
    );
    expect(plan.fetch.map((f) => f.filename)).toEqual(['big.pdf', 'small.pdf', 'data.csv']);
  });

  it('is deterministic across runs, so a re-sweep decodes the same set', () => {
    const refs = [
      ref({ attachmentId: '1', filename: 'b.pdf', sizeBytes: 500 }),
      ref({ attachmentId: '2', filename: 'a.pdf', sizeBytes: 500 }),
    ];
    expect(planAttachments(refs).fetch.map((f) => f.filename)).toEqual(
      planAttachments([...refs].reverse()).fetch.map((f) => f.filename),
    );
  });

  it('ignores malformed refs instead of throwing', () => {
    const plan = planAttachments([
      { attachmentId: '', filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 1 },
      null as unknown as AttachmentRefInput,
    ]);
    expect(plan.fetch).toHaveLength(0);
  });
});

describe('attachmentSection', () => {
  it('heads the block with the filename so document text is distinguishable', () => {
    expect(attachmentSection('report.pdf', 'Quarterly numbers.')).toContain('--- Attachment: report.pdf ---');
  });

  it('returns nothing for empty text', () => {
    expect(attachmentSection('empty.pdf', '   ')).toBe('');
  });

  it('truncates a long attachment and says it did', () => {
    const out = attachmentSection('long.pdf', 'x'.repeat(MAX_ATTACHMENT_CHARS + 500));
    expect(out).toMatch(/attachment truncated/);
    expect(out.length).toBeLessThan(MAX_ATTACHMENT_CHARS + 200);
  });
});

describe('skippedAttachmentsNote', () => {
  it('is empty when nothing was skipped', () => {
    expect(skippedAttachmentsNote([])).toBe('');
  });

  it('names each skipped attachment with its reason', () => {
    const note = skippedAttachmentsNote([{ filename: 'a.zip', reason: 'unsupported type' }]);
    expect(note).toContain('a.zip');
    expect(note).toContain('unsupported type');
  });
});

describe('fetchAttachmentText', () => {
  const planned = { ...ref({ filename: 'note.txt', mimeType: 'text/plain' }), kind: 'text' as const };

  it('decodes base64url, which is what Gmail actually returns', async () => {
    // "Hi >? " style content whose standard-base64 form contains + and /.
    const raw = 'subject: hi ?? >>';
    const b64url = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const client = {
      users: { messages: { attachments: { get: vi.fn().mockResolvedValue({ data: { data: b64url } }) } } },
    };
    await expect(fetchAttachmentText(client, 'm1', planned)).resolves.toContain('subject: hi');
  });

  it('returns null when Gmail hands back no data', async () => {
    const client = {
      users: { messages: { attachments: { get: vi.fn().mockResolvedValue({ data: {} }) } } },
    };
    await expect(fetchAttachmentText(client, 'm1', planned)).resolves.toBeNull();
  });

  it('swallows a fetch failure — one bad attachment must not cost the thread', async () => {
    const client = {
      users: { messages: { attachments: { get: vi.fn().mockRejectedValue(new Error('403')) } } },
    };
    await expect(fetchAttachmentText(client, 'm1', planned)).resolves.toBeNull();
  });
});
