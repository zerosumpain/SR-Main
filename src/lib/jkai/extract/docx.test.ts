// Every fixture here is a REAL .docx, packed by the same library that writes the
// application's own exports. A hand-written HTML string would prove that the
// serialiser reads HTML; only a packed document proves it reads what Word writes.
import { describe, expect, it } from 'vitest';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, HeadingLevel, TextRun, FootnoteReferenceRun } from 'docx';
import { extractDocx } from './docx';

const cell = (text: string, options: Record<string, unknown> = {}) =>
  new TableCell({ children: [new Paragraph(text)], ...options });

async function pack(children: (Paragraph | Table)[], footnotes?: Record<number, { children: Paragraph[] }>): Promise<Buffer> {
  const doc = new Document({ ...(footnotes ? { footnotes } : {}), sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** Rows of a rendered table block, without its `[Table n]` caption. */
function tableRows(text: string, caption = '[Table 1]'): string[][] {
  const start = text.indexOf(caption);
  expect(start).toBeGreaterThanOrEqual(0);
  const lines = text.slice(start).split('\n').slice(1);
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.includes('\t')) break;
    rows.push(line.split('\t'));
  }
  return rows;
}

describe('docx extraction keeps a table a table', () => {
  it('reads a plain table as rows and columns, not a column of loose values', async () => {
    const bytes = await pack([
      new Paragraph('The allocations below are indicative.'),
      new Table({ rows: [
        new TableRow({ children: [cell('Programme'), cell('Baseline'), cell('2026-27')] }),
        new TableRow({ children: [cell('Adult skills'), cell('£1,200m'), cell('£1,450m')] }),
        new TableRow({ children: [cell('Capital'), cell('£310m'), cell('£0m')] }),
      ] }),
    ]);

    const { text } = await extractDocx(bytes);

    // The regression this whole file exists for: every cell on its own line.
    expect(text).not.toMatch(/Programme\n\nBaseline/);
    expect(tableRows(text)).toEqual([
      ['Programme', 'Baseline', '2026-27'],
      ['Adult skills', '£1,200m', '£1,450m'],
      ['Capital', '£310m', '£0m'],
    ]);
  });

  it('lays merged cells back on their grid and composes a nested header', async () => {
    const bytes = await pack([
      new Table({ rows: [
        new TableRow({ tableHeader: true, children: [cell('Programme', { rowSpan: 2 }), cell('2026-27', { columnSpan: 2 }), cell('2027-28', { columnSpan: 2 })] }),
        new TableRow({ tableHeader: true, children: [cell('Cash'), cell('Real'), cell('Cash'), cell('Real')] }),
        new TableRow({ children: [cell('Skills', { rowSpan: 2 }), cell('£1,450m'), cell('£1,390m'), cell('£1,500m'), cell('£1,410m')] }),
        new TableRow({ children: [cell('of which adult'), cell('£900m'), cell('£860m'), cell('£0m')] }),
        new TableRow({ children: [cell('Capital'), cell('£0m'), cell(''), cell('£0m'), cell('')] }),
      ] }),
    ]);

    const { text, meta } = await extractDocx(bytes);
    const rows = tableRows(text);

    // Two header rows collapse into one label per column.
    expect(rows[0]).toEqual(['Programme', '2026-27 · Cash', '2026-27 · Real', '2027-28 · Cash', '2027-28 · Real']);
    expect(rows[1]).toEqual(['Skills', '£1,450m', '£1,390m', '£1,500m', '£1,410m']);
    // THE BUG THIS FIXES: without the occupancy map this row has four values for
    // five columns, so £900m reads as the programme name's own column.
    expect(rows[2]).toEqual(['Skills', 'of which adult', '£900m', '£860m', '£0m']);
    // An empty cell holds its position, so £0m stays under 2027-28 · Cash.
    expect(rows[3][0]).toBe('Capital');
    expect(rows[3][1]).toBe('£0m');
    expect(rows[3][3]).toBe('£0m');

    if (meta.kind !== 'docx') throw new Error('expected docx meta');
    expect(meta.warnings.join(' ')).toMatch(/Merged cells in table 1/);
  });

  it('keeps the whole of a row on one line, whatever the cell held', async () => {
    const bytes = await pack([
      new Table({ rows: [
        new TableRow({ children: [cell('Measure'), cell('Value')] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Health'), new Paragraph('& Social Care')] }), cell('£12m')] }),
      ] }),
    ]);

    const { text } = await extractDocx(bytes);
    const rows = tableRows(text);

    // A two-paragraph cell must not become two rows, and the ampersand must come
    // back decoded — mammoth writes it as `&amp;`, and a citation carrying a bare
    // `&` would never be found in text that still held the entity.
    expect(rows[1]).toEqual(['Health & Social Care', '£12m']);
    expect(text).not.toContain('&amp;');
  });
});

describe('docx extraction keeps what the flat walk dropped', () => {
  it('carries footnote bodies into the text under their markers', async () => {
    const bytes = await pack(
      [new Paragraph({ children: [new TextRun('Savings of £400m are expected'), new FootnoteReferenceRun(1), new TextRun(' by 2028.')] })],
      { 1: { children: [new Paragraph('Savings assume a 3% deflator not applied elsewhere.')] } },
    );

    const { text, meta } = await extractDocx(bytes);

    expect(text).toContain('Savings of £400m are expected[1] by 2028.');
    expect(text).toContain('[1] Savings assume a 3% deflator not applied elsewhere.');
    // The backlink mammoth renders at the end of a footnote is furniture.
    expect(text).not.toContain('↑');
    if (meta.kind !== 'docx') throw new Error('expected docx meta');
    expect(meta.warnings.join(' ')).toMatch(/1 footnote/);
  });

  it('keeps headings and marks list items', async () => {
    const bytes = await pack([
      new Paragraph({ text: 'Part 2 — Delivery', heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: 'First commitment', bullet: { level: 0 } }),
      new Paragraph({ text: 'Second commitment', bullet: { level: 0 } }),
    ]);

    const { text, meta } = await extractDocx(bytes);

    expect(text).toContain('Part 2 — Delivery');
    expect(text).toContain('- First commitment\n- Second commitment');
    if (meta.kind !== 'docx') throw new Error('expected docx meta');
    expect(meta.headings).toEqual([{ level: 2, text: 'Part 2 — Delivery' }]);
    expect(meta.blocks?.map((b) => b.kind)).toEqual(['heading', 'list']);
  });
});

describe('docx table text is shaped for whoever reads it back', () => {
  it('separates cells with tabs, so a quote spanning two of them survives normalisation', async () => {
    const bytes = await pack([
      new Table({ rows: [
        new TableRow({ children: [cell('Programme'), cell('2026-27')] }),
        new TableRow({ children: [cell('Adult skills'), cell('£1,450m')] }),
      ] }),
    ]);

    const { text, meta } = await extractDocx(bytes);

    // A tab is whitespace, so a reader that folds whitespace runs finds this row
    // however it reproduced the gap. A pipe is not, and would have to be echoed
    // back exactly. See the note at the top of docx.ts.
    expect(text).toContain('Adult skills\t£1,450m');
    expect(text).not.toContain('|');
    if (meta.kind !== 'docx') throw new Error('expected docx meta');
    // `text` has to stay reconstructible from the blocks, or an offset into one
    // is not an offset into the other.
    expect(meta.blocks?.map((b) => b.text).join('\n\n')).toBe(text);
  });

  it('still surfaces mammoth\'s html alongside the text', async () => {
    const bytes = await pack([
      new Table({ rows: [new TableRow({ children: [cell('Item'), cell('£1,200.00')] })] }),
    ]);

    const { html } = await extractDocx(bytes);

    // The rich preview path is unchanged: table markup, numeric cells tagged.
    expect(html).toContain('<table>');
    expect(html).toMatch(/<td class="num">\s*(<p>)?£?1,200\.00/);
  });
});
