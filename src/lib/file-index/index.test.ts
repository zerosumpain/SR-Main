import { describe, it, expect } from 'vitest';
import { sha256Hex } from './hash';
import { fileToText, isIndexableMime } from './content';
import { looksLikeRefusal, looksDegenerate } from './describe';

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

describe('looksLikeRefusal', () => {
  // A refused OCR must never be stored as the document's text: it would be
  // embedded, returned by @files, and fed to the intel graph as the contents of
  // a file it never read. Observed on gpt-4o-mini roughly one run in three.
  it('catches the refusals a vision model actually returns', () => {
    expect(looksLikeRefusal("I'm unable to provide the transcript of this document.")).toBe(true);
    expect(looksLikeRefusal("I'm sorry, but I can't help with that.")).toBe(true);
    expect(looksLikeRefusal('Sorry — I cannot transcribe copyrighted material.')).toBe(true);
    expect(looksLikeRefusal('Unfortunately I am not able to read this image.')).toBe(true);
  });

  it('does not fire on a real transcript', () => {
    expect(looksLikeRefusal('Annual Statement\nAccount summary\nOpening balance 01/01/2026')).toBe(false);
    // A letter written in the first person is still a transcript.
    expect(looksLikeRefusal('Dear Mr Kelly,\n\nI am writing to confirm your annual statement.')).toBe(false);
  });

  it('never fires on a long body, however it opens', () => {
    // Length is the backstop: a genuine transcript that happens to contain an
    // apology must survive, so the guard only applies to short answers.
    const long = "I'm sorry to hear that. " + 'x'.repeat(1200);
    expect(looksLikeRefusal(long)).toBe(false);
  });
});

describe('looksDegenerate', () => {
  // The other way a transcript comes back useless: not a refusal, but noise.
  // grok-4.5 answered a PDF with leaked tool scaffolding, and it declares `file`
  // input in the catalogue, so nothing upstream would have stopped it.
  it('catches repeated tool-scaffolding noise', () => {
    expect(looksDegenerate('```pdf_browse```pdf_browse```pdf_browse')).toBe(true);
    expect(looksDegenerate('...'.repeat(40))).toBe(true);
  });

  it('leaves a real transcript alone', () => {
    expect(
      looksDegenerate('Annual Statement\nAccount summary\nOpening balance 01/01/2026 £1,234.56\nClosing balance 31/12/2026 £987.65'),
    ).toBe(false);
    expect(looksDegenerate('Hello world from page one.\n\nThis is page two.')).toBe(false);
  });

  it('ignores long bodies entirely', () => {
    expect(looksDegenerate('ab '.repeat(900))).toBe(false);
  });
});
