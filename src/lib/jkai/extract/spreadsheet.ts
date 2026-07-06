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

/** True if a cell value reads as a number (currency, %, thousands, negatives). */
function isNumericCell(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  // Strip currency symbols, %, thousands separators and parenthesised negatives.
  const cleaned = t.replace(/^\(|\)$/g, '').replace(/[£$€%,\s]/g, '');
  return /^[-+]?\d*\.?\d+$/.test(cleaned);
}

/** Column indices whose body cells are predominantly numeric → right-align them. */
function numericColumns(rows: string[][], colCount: number): boolean[] {
  const flags: boolean[] = [];
  for (let c = 0; c < colCount; c++) {
    let seen = 0;
    let numeric = 0;
    for (const r of rows) {
      const v = r[c];
      if (v == null || v.trim() === '') continue;
      seen++;
      if (isNumericCell(v)) numeric++;
    }
    flags[c] = seen >= 2 && numeric / seen >= 0.7;
  }
  return flags;
}

/** Render one sheet as a titled HTML table (header row + body rows). */
function sheetHtml(name: string, columns: string[], rows: string[][]): string {
  const colCount = Math.max(columns.length, ...rows.map((r) => r.length), 0);
  const num = numericColumns(rows, colCount);
  const cell = (tag: 'th' | 'td', val: string, i: number) =>
    `<${tag}${num[i] ? ' class="num"' : ''}>${escapeHtml(val)}</${tag}>`;
  const head =
    columns.length > 0
      ? `<thead><tr>${columns.map((c, i) => cell('th', c, i)).join('')}</tr></thead>`
      : '';
  const body = `<tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<section class="xlsx-sheet"><h3 class="xlsx-sheet-name">${escapeHtml(name)}</h3><div class="xlsx-scroll"><table>${head}${body}</table></div></section>`;
}
