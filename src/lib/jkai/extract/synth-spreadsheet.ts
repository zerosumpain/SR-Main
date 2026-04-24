// src/lib/jkai/extract/synth-spreadsheet.ts
import ExcelJS from 'exceljs';
import { ExtractError, type SynthesizeFormat, type SynthesizeSource, type SynthesizeResult } from './types';

interface JsonRows {
  [k: string]: unknown;
}

export async function synthesizeSpreadsheet(
  source: SynthesizeSource,
  format: SynthesizeFormat,
  content: string | Buffer,
  sheetName = 'Sheet1',
): Promise<SynthesizeResult> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  if (source === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof content === 'string' ? content : content.toString('utf8'));
    } catch (err) {
      throw new ExtractError('E_INVALID_INPUT', 'json content failed to parse', err);
    }
    const rows = Array.isArray(parsed) ? (parsed as JsonRows[]) : [parsed as JsonRows];
    if (rows.length === 0) {
      // empty sheet
    } else {
      const cols = Object.keys(rows[0] as JsonRows);
      ws.addRow(cols);
      for (const r of rows) {
        ws.addRow(cols.map((c) => stringify((r as JsonRows)[c])));
      }
    }
  } else if (source === 'csv') {
    const text = typeof content === 'string' ? content : content.toString('utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    for (const line of lines) ws.addRow(parseCsvLine(line));
  } else if (source === 'xlsx') {
    if (!(content instanceof Buffer)) throw new ExtractError('E_INVALID_INPUT', 'xlsx source requires Buffer content');
    await wb.xlsx.load(content as unknown as ArrayBuffer);
  } else {
    throw new ExtractError('E_INVALID_INPUT', `unsupported source for spreadsheet synthesis: ${source}`);
  }

  if (format === 'xlsx') {
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', suggestedExtension: '.xlsx' };
  }
  if (format === 'csv') {
    const sheet = wb.worksheets[0];
    const lines: string[] = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(escapeCsv(cell.value)));
      lines.push(vals.join(','));
    });
    return { buffer: Buffer.from(lines.join('\n'), 'utf8'), mimeType: 'text/csv', suggestedExtension: '.csv' };
  }
  throw new ExtractError('E_INVALID_INPUT', `unsupported format for spreadsheet synthesis: ${format}`);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function escapeCsv(v: unknown): string {
  const s = stringify(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"' && cur === '') inQuotes = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
