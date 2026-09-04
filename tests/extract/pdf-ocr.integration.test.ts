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

// Gate on what this file actually needs, not on what is easiest to check —
// the same guard `tests/lib/rag/pipeline.integration.test.ts` carries, and for
// the same reason. This file had NO guard: the nightly runs it with no
// OpenRouter key, `fileToText` returns `empty` because nothing can read the
// pixels, and the assertion fails. It is the reason the nightly was red from
// 2026-08-19 onwards, alongside four others.
//
// Skipping is right here rather than asserting the empty case: the subject of
// this test is what the VISION MODEL reads off a page, and there is no
// version of that claim a run without a model can make.
const RUN = await (async () => {
  try {
    const { getOpenRouterApiKey } = await import('$lib/server/models/settings');
    return !!(await getOpenRouterApiKey());
  } catch {
    return false;
  }
})();
const d = RUN ? describe : describe.skip;

d('scanned PDF → OCR (real API)', () => {
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
