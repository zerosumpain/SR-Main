import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractDocx } from '../../src/lib/jkai/extract/docx';

describe('docx extractor', () => {
  it('extracts headings and body text', async () => {
    const buf = readFileSync(resolve(__dirname, '../fixtures/extract/sample.docx'));
    const r = await extractDocx(buf);
    expect(r.text).toContain('Some body text');
    expect(r.text).toContain('Another line');
    if (r.meta.kind !== 'docx') throw new Error();
    const titles = r.meta.headings.map((h) => h.text);
    expect(titles).toContain('Doc Heading');
    expect(titles).toContain('Subsection');
  });
});
