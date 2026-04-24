import { describe, it, expect } from 'vitest';
import { synthesizeHtml } from '../../src/lib/jkai/extract/synth-html';
import { synthesizeDocx } from '../../src/lib/jkai/extract/synth-docx';
import { synthesizePdf } from '../../src/lib/jkai/extract/synth-pdf';
import { synthesizeSpreadsheet } from '../../src/lib/jkai/extract/synth-spreadsheet';

describe('synthesis', () => {
  it('md → html', async () => {
    const r = await synthesizeHtml('# Hi\n\nText.');
    expect(r.mimeType).toBe('text/html');
    expect(r.buffer.toString('utf8')).toContain('<h1');
  });

  it('md → docx', async () => {
    const r = await synthesizeDocx('# Hi\n\nText.');
    expect(r.suggestedExtension).toBe('.docx');
    // docx files are zips beginning with PK
    expect(r.buffer.slice(0, 2).toString('binary')).toBe('PK');
  });

  it('text → pdf', async () => {
    const r = await synthesizePdf('Hello world');
    expect(r.mimeType).toBe('application/pdf');
    expect(r.buffer.slice(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('json → xlsx → csv round trip', async () => {
    const json = JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    const xlsx = await synthesizeSpreadsheet('json', 'xlsx', json);
    expect(xlsx.suggestedExtension).toBe('.xlsx');
    const csv = await synthesizeSpreadsheet('xlsx', 'csv', xlsx.buffer);
    expect(csv.buffer.toString('utf8')).toContain('a,b');
    expect(csv.buffer.toString('utf8')).toContain('1,x');
  });
});
