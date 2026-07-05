import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';
import { isIndexableMime } from './content';

describe('sha256Hex', () => {
  it('is deterministic and content-sensitive', () => {
    const a = sha256Hex(Buffer.from('hello world'));
    const b = sha256Hex(Buffer.from('hello world'));
    const c = sha256Hex(Buffer.from('hello worlD'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the known sha256 of an empty buffer', () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('isIndexableMime', () => {
  it('indexes images and audio (multimodal)', () => {
    expect(isIndexableMime('image/png', 'photo.png')).toBe(true);
    expect(isIndexableMime('image/jpeg', 'p.jpg')).toBe(true);
    expect(isIndexableMime('audio/mpeg', 'clip.mp3')).toBe(true);
  });

  it('indexes text-extractable documents', () => {
    expect(isIndexableMime('application/pdf', 'doc.pdf')).toBe(true);
    expect(isIndexableMime('text/markdown', 'notes.md')).toBe(true);
    expect(isIndexableMime('text/csv', 'data.csv')).toBe(true);
    expect(isIndexableMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe(true);
  });

  it('does NOT index video (deferred) or unknown binary', () => {
    expect(isIndexableMime('video/mp4', 'movie.mp4')).toBe(false);
    expect(isIndexableMime('application/zip', 'archive.zip')).toBe(false);
    expect(isIndexableMime('application/octet-stream', 'mystery.bin')).toBe(false);
  });
});
