import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { extractPdf, resolvePdfJsAssets } from '../../src/lib/jkai/extract/pdf';

describe('pdf.js asset resolution', () => {
  // Both of these resolve to real files or pdf.js quietly falls back: a missing
  // worker takes every PDF down, and a missing font directory only degrades
  // documents that don't embed their fonts — which is the harder one to notice.
  // Asserting the paths EXIST is what catches a package layout change on upgrade.
  it('resolves the worker and the standard-font directory to real paths', () => {
    const { workerSrc, standardFontDataUrl } = resolvePdfJsAssets();
    expect(workerSrc).toBeTruthy();
    expect(existsSync(workerSrc!)).toBe(true);
    expect(standardFontDataUrl).toBeTruthy();
    expect(standardFontDataUrl!.endsWith('/')).toBe(true);
    expect(existsSync(standardFontDataUrl!)).toBe(true);
  });
});

describe('pdf extractor', () => {
  it('extracts text from a multi-page PDF', async () => {
    const buf = readFileSync(resolve(__dirname, '../fixtures/extract/sample.pdf'));
    const r = await extractPdf(buf);
    expect(r.meta.kind).toBe('pdf');
    if (r.meta.kind !== 'pdf') throw new Error();
    expect(r.meta.pageCount).toBe(2);
    expect(r.text).toContain('Hello world');
    expect(r.text).toContain('page two');
  });

  it('throws E_PARSE_FAILED on garbage', async () => {
    await expect(extractPdf(Buffer.from('not a pdf'))).rejects.toMatchObject({ code: 'E_PARSE_FAILED' });
  });

  it('carries the underlying cause on a parse failure', async () => {
    // The cause is what says WHY. Dropping it is how a worker-resolution failure
    // reached production logs as the bare string "PDF text extraction failed".
    await expect(extractPdf(Buffer.from('not a pdf'))).rejects.toSatisfy(
      (err: Error) => err.cause instanceof Error && err.cause.message.length > 0,
    );
  });

  it('keeps line breaks instead of welding lines together', async () => {
    // pdf.js emits one item per text run and flags the end of each visual line.
    // Concatenating without that flag fuses neighbouring lines and collapses
    // table rows into one unreadable string.
    const buf = readFileSync(resolve(__dirname, '../fixtures/extract/sample.pdf'));
    const r = await extractPdf(buf);
    if (r.meta.kind !== 'pdf') throw new Error();
    expect(r.text).toContain('\n');
    // Page one's last line must not run straight into page two's first line.
    expect(r.text).not.toMatch(/[^\s]page two/);
    for (const page of r.meta.pages) {
      expect(page.text).not.toMatch(/[ \t]+$/m);
    }
  });
});
