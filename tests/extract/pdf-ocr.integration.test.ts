// Real-API check for the scanned-PDF OCR fallback. Excluded from the merge gate
// (`gate:test` skips *.integration.test.ts) because it spends tokens and needs a
// live OpenRouter key — run it by hand after touching describePdfBestEffort:
//
//   npx vitest run tests/extract/pdf-ocr.integration.test.ts
//
// The fixture is a genuine image-only PDF: sample.pdf rasterised and re-wrapped
// with no text layer, so pdf.js extracts nothing from it and the only way to
// read it is to look at the pixels.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileToText } from '../../src/lib/file-index/content';

describe('scanned PDF → OCR (real API)', () => {
  it('reads a PDF with no text layer via the vision model', async () => {
    const buf = readFileSync(resolve(__dirname, '../fixtures/extract/scanned.pdf'));
    const out = await fileToText(buf, 'application/pdf', 'scanned.pdf');
    expect(out.status).toBe('text');
    if (out.status !== 'text') throw new Error();
    // Marked as OCR, not 'text' — the wording is a model's reading of pixels and
    // consumers are told to treat it as approximate.
    expect(out.content.modality).toBe('ocr');
    expect(out.content.text.toLowerCase()).toContain('hello world');
  }, 180000);
});
