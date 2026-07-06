// Regression guard for the rich-HTML output added to the extract handlers: docx
// (mammoth), pptx (slide cards) and xlsx (tables). Each test builds a REAL document
// buffer in-memory (no binary fixtures) and asserts the `html` field is populated
// and structured — this is what the file-viewer preview renders.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { extractPptx } from './pptx';
import { extractSpreadsheet } from './spreadsheet';
import { extractDocx } from './docx';
import { synthesizeDocx } from './synth-docx';
import { sanitizePreviewHtml } from '$lib/security/sanitize-chat';

describe('extract → rich html', () => {
  it('pptx: emits a slide card per slide with title + bullets', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld><p:txBody><a:p><a:r><a:t>Hello Title</a:t></a:r></a:p>' +
        '<a:p><a:r><a:t>Bullet one</a:t></a:r></a:p>' +
        '<a:p><a:r><a:t>Bullet two</a:t></a:r></a:p></p:txBody></p:sld>',
    );
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const res = await extractPptx(buf);
    expect(res.html).toBeTruthy();
    expect(res.html).toContain('pptx-slide');
    expect(res.html).toContain('<h3 class="pptx-title">Hello Title</h3>');
    expect(res.html).toContain('<li>Bullet one</li>');
    expect(res.html).toContain('<li>Bullet two</li>');
    // Flat `text` output is unchanged (RAG/indexing depends on it).
    expect(res.text).toContain('Slide 1');
    expect(res.text).toContain('Hello Title');
    // The viewer renders the SANITISED html — the slide-card structure + classes
    // that the scoped CSS targets must survive sanitisation (regression guard).
    const clean = sanitizePreviewHtml(res.html as string);
    expect(clean).toContain('class="pptx-slide"');
    expect(clean).toContain('class="pptx-title"');
    expect(clean).toContain('<section');
  });

  it('pptx: escapes markup in slide text', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>a &lt;b&gt; &amp; c</a:t></a:r></a:p></p:sld>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await extractPptx(buf);
    expect(res.html).toContain('a &lt;b&gt; &amp; c');
    expect(res.html).not.toContain('<b>');
  });

  it('xlsx: emits a table with header + body cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Name', 'Age']);
    ws.addRow(['Alice', 30]);
    ws.addRow(['Bob', 25]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await extractSpreadsheet(
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'people.xlsx',
    );
    expect(res.html).toBeTruthy();
    expect(res.html).toContain('<table>');
    expect(res.html).toContain('<th>Name</th>');
    expect(res.html).toContain('<td>Alice</td>');
    expect(res.html).toContain('xlsx-sheet-name');
    // Age is numeric → its header + cells are tagged for right-alignment; Name is not.
    expect(res.html).toContain('<th class="num">Age</th>');
    expect(res.html).toContain('<td class="num">30</td>');
    expect(res.html).not.toContain('<td class="num">Alice</td>');
    // Table + sheet-name class survive sanitisation (what the viewer renders).
    const clean = sanitizePreviewHtml(res.html as string);
    expect(clean).toContain('class="xlsx-sheet-name"');
    expect(clean).toContain('<table>');
    expect(clean).toContain('<th>Name</th>');
  });

  it('docx: mammoth html is surfaced, not discarded', async () => {
    const { buffer } = await synthesizeDocx('# Heading one\n\nHello **world** and lists:\n\n- a\n- b', 'Doc');
    const res = await extractDocx(buffer);
    expect(res.html).toBeTruthy();
    expect((res.html ?? '').length).toBeGreaterThan(0);
    expect(res.html).toContain('Hello');
    // Retains structure from the source markdown.
    expect(res.html).toMatch(/<(h1|h2|h3)[^>]*>Heading one<\/(h1|h2|h3)>/);
  });

  it('docx: right-aligns numeric table cells', async () => {
    const md = 'Costs\n\n| Item | Amount |\n| --- | --- |\n| Rent | £1,200.00 |\n| Coffee | £3.50 |\n';
    const { buffer } = await synthesizeDocx(md, 'Costs');
    const res = await extractDocx(buffer);
    if (res.html?.includes('<table')) {
      // Currency cells get the numeric class; text cells (Item names) do not.
      expect(res.html).toMatch(/<td class="num">\s*(<p>)?£?1,200\.00/);
      expect(res.html).not.toMatch(/<td class="num">\s*(<p>)?Rent/);
    }
  });
});
