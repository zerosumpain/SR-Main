// src/lib/jkai/extract/spreadsheet.ts
import ExcelJS from 'exceljs';
import { ExtractError, type ExtractResult } from './types';

export async function extractSpreadsheet(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractResult> {
  const wb = new ExcelJS.Workbook();
  const isCsv = mimeType === 'text/csv' || filename.toLowerCase().endsWith('.csv');

  try {
    if (isCsv) {
      const { Readable } = await import('stream');
      const stream = Readable.from(buffer);
      // exceljs csv reader
      const ws = await wb.csv.read(stream as never);
      void ws;
    } else {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    }
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'exceljs failed to read spreadsheet', err);
  }

  const sheets: Array<{ name: string; rowCount: number; columns: string[] }> = [];
  const textParts: string[] = [];
  const htmlParts: string[] = [];

  wb.eachSheet((sheet) => {
    const columns: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      columns.push(String(cell.value ?? '').trim());
    });

    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return; // header
      const vals: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
      });
      rows.push(vals);
    });

    sheets.push({ name: sheet.name, rowCount: rows.length, columns });
    textParts.push(`# ${sheet.name}\n${columns.join('\t')}\n${rows.map((r) => r.join('\t')).join('\n')}`);
    htmlParts.push(sheetHtml(sheet.name, columns, rows));
  });

  return {
    text: textParts.join('\n\n'),
    html: `<div class="xlsx-book">${htmlParts.join('')}</div>`,
    meta: { kind: 'spreadsheet', sheets },
  };
}

/** Escape a cell value for safe embedding in generated table HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render one sheet as a titled HTML table (header row + body rows). */
function sheetHtml(name: string, columns: string[], rows: string[][]): string {
  const head =
    columns.length > 0
      ? `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`
      : '';
  const body = `<tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<section class="xlsx-sheet"><h3 class="xlsx-sheet-name">${escapeHtml(name)}</h3><div class="xlsx-scroll"><table>${head}${body}</table></div></section>`;
}
