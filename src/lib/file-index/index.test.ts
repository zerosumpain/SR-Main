import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';
import { fileToText, isIndexableMime } from './content';

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

describe('fileToText outcomes', () => {
  // A crashed extraction and an empty document used to be the same `null`, and
  // indexFile retired both permanently. Keeping them distinct is the whole point
  // of the outcome type: only 'empty' is allowed to stamp the content hash.
  it('reports a thrown extraction as error, with the code and cause in the reason', async () => {
    const out = await fileToText(Buffer.from('not a pdf'), 'application/pdf', 'broken.pdf');
    expect(out.status).toBe('error');
    if (out.status !== 'error') throw new Error();
    expect(out.reason).toContain('E_PARSE_FAILED');
    expect(out.reason).toContain('caused by:');
  });

  it('reports a document with no text as empty, not error', async () => {
    const out = await fileToText(Buffer.from('   \n  '), 'text/plain', 'blank.txt');
    expect(out.status).toBe('empty');
  });

  it('returns text with a modality when extraction succeeds', async () => {
    const out = await fileToText(Buffer.from('hello drive'), 'text/plain', 'note.txt');
    expect(out.status).toBe('text');
    if (out.status !== 'text') throw new Error();
    expect(out.content.text).toContain('hello drive');
    expect(out.content.modality).toBe('text');
  });

  it('treats an unindexable kind as empty rather than failing', async () => {
    const out = await fileToText(Buffer.from('PK'), 'application/zip', 'archive.zip');
    expect(out.status).toBe('empty');
  });
});
