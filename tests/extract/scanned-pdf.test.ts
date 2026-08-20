import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractPdf } from '../../src/lib/jkai/extract/pdf';
import { indexStatusFor } from '../../src/routes/drive/+page.server';

describe('scanned (image-only) PDF', () => {
  it('parses cleanly but yields no text — the case OCR exists for', async () => {
    const buf = readFileSync(resolve(__dirname, '../fixtures/extract/scanned.pdf'));
    const r = await extractPdf(buf);
    // It must NOT throw: a scan is a valid PDF. It simply has no text layer,
    // which is what routes it to the vision fallback in fileToText.
    expect(r.meta.kind).toBe('pdf');
    if (r.meta.kind !== 'pdf') throw new Error();
    expect(r.meta.pageCount).toBe(2);
    expect(r.text.trim()).toBe('');
  });
});

describe('indexStatusFor', () => {
  const base = { mimeType: 'application/pdf', name: 'a.pdf', contentHash: null, indexError: null };

  it('is indexed whenever chunks exist', () => {
    expect(indexStatusFor({ ...base, contentHash: 'h' }, 3)).toBe('indexed');
  });

  it('separates a settled verdict from an outstanding failure', () => {
    // retireNoText stamps the hash alongside its reason: the extractor ran and
    // answered. recordIndexError leaves the hash null so the file is retried.
    expect(indexStatusFor({ ...base, contentHash: 'h', indexError: 'no extractable text in this document' }, 0)).toBe('no-text');
    expect(indexStatusFor({ ...base, indexError: 'E_PARSE_FAILED — PDF text extraction failed' }, 0)).toBe('failed');
  });

  it('is pending when it has never been attempted', () => {
    expect(indexStatusFor(base, 0)).toBe('pending');
  });

  it('is skipped for a file type that is never indexed', () => {
    expect(indexStatusFor({ ...base, mimeType: 'application/zip', name: 'a.zip' }, 0)).toBe('skipped');
    expect(indexStatusFor({ ...base, mimeType: 'video/mp4', name: 'a.mp4' }, 0)).toBe('skipped');
  });
});
