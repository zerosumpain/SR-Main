import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractPdf } from '../../src/lib/jkai/extract/pdf';

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
});
