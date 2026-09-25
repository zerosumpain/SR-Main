import { describe, it, expect, vi } from 'vitest';

// The helpers under test are pure; these keep the module's storage and
// pre-analysis imports from reaching a database or a model.
vi.mock('./storage', () => ({ readBuffer: vi.fn() }));
vi.mock('./preanalyse', () => ({ preanalyseAttachment: vi.fn(), preanalysisPartText: vi.fn() }));

import { allocateMediaCaps, nativeLabel, isNativeFor } from './multimodal';
import type { JkaiAttachment } from '$lib/db/schema';
import type { ModelCapabilities } from '$lib/server/models/capabilities';

const SEES: ModelCapabilities = { image: true, audio: false, video: false, pdf: true, documentText: true };
const MB = 1024 * 1024;

function att(kind: string, sizeBytes: number, extra: Partial<JkaiAttachment> = {}): JkaiAttachment {
  return {
    id: `a-${kind}-${sizeBytes}`,
    conversationId: 'c',
    messageId: null,
    source: 'web',
    kind,
    mimeType: kind === 'image' ? 'image/jpeg' : kind === 'pdf' ? 'application/pdf' : 'text/plain',
    originalName: null,
    sizeBytes,
    diskPath: 'x',
    duration: null,
    metadata: null,
    createdAt: new Date(),
    ...extra,
  } as JkaiAttachment;
}

describe('allocateMediaCaps', () => {
  it('sends a photo from an earlier turn natively, not as a description', () => {
    // The 2026-09-25 thread: a photo on turn one, then five follow-ups about it.
    // Each follow-up has to be answered from the photo.
    const caps = allocateMediaCaps([[att('image', 458_596)], [], [], []], SEES);
    expect(caps[0].image).toBe(true);
  });

  it('keeps the NEWEST files native when the thread outgrows the budget', () => {
    const caps = allocateMediaCaps(
      [[att('image', 10 * MB)], [att('image', 10 * MB)], [att('image', 1 * MB)]],
      SEES,
      20 * MB,
    );
    // 1MB + 10MB encoded (×4/3) fits in 20MB; the oldest 10MB does not.
    expect(caps.map((c) => c.image)).toEqual([false, true, true]);
  });

  it('carries on past a turn that does not fit, so a small older photo still goes', () => {
    const caps = allocateMediaCaps(
      [[att('image', 1 * MB)], [att('pdf', 25 * MB)], []],
      SEES,
      20 * MB,
    );
    expect(caps.map((c) => c.image)).toEqual([true, false, true]);
  });

  it('does not count text files, which travel as text whatever happens', () => {
    const caps = allocateMediaCaps([[att('text', 2 * MB)], [att('image', 14 * MB)]], SEES, 20 * MB);
    expect(caps.every((c) => c === SEES)).toBe(true);
  });

  it('does not count a file the model would have had described anyway', () => {
    // Audio on a model without audio is transcribed, so it costs no budget.
    const caps = allocateMediaCaps([[att('audio', 30 * MB)], [att('image', 1 * MB)]], SEES, 20 * MB);
    expect(caps[0]).toBe(SEES);
  });
});

describe('isNativeFor', () => {
  it('sends everything natively when no caps are given (the original contract)', () => {
    expect(isNativeFor(att('video', 1))).toBe(true);
  });

  it('follows the caps otherwise', () => {
    expect(isNativeFor(att('image', 1), SEES)).toBe(true);
    expect(isNativeFor(att('audio', 1), SEES)).toBe(false);
  });
});

describe('nativeLabel', () => {
  it('names the file and where it is kept in /drive', () => {
    const a = att('image', 1, {
      originalName: 'Photo 2026-09-25 230529.jpg',
      metadata: { drivePath: 'jkai/Whats wrong/Photo 2026-09-25 230529.jpg' },
    });
    expect(nativeLabel(a)).toBe(
      '[Attached image "Photo 2026-09-25 230529.jpg", kept in /drive as "jkai/Whats wrong/Photo 2026-09-25 230529.jpg"]',
    );
  });

  it('names the file only until the mirror has stamped a path', () => {
    expect(nativeLabel(att('pdf', 1, { originalName: 'badge.pdf' }))).toBe('[Attached pdf "badge.pdf"]');
  });

  it('adds nothing for a text file, whose own header names it', () => {
    expect(nativeLabel(att('text', 1))).toBeNull();
  });
});
