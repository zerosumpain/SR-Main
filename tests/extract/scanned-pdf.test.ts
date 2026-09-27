import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractPdf } from '../../src/lib/jkai/extract/pdf';

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
