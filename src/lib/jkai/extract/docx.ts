// src/lib/jkai/extract/docx.ts
//
// WHY THIS DOES NOT USE `mammoth.extractRawText`.
//
// It used to. `extractRawText` walks the document body and emits one paragraph
// per line — and a table cell IS a paragraph, so a five-column funding table
// arrived as twenty loose values with no row and no column:
//
//   Programme\n\nBaseline\n\n2026-27\n\nAdult skills\n\n£1,200m\n\n£1,450m…
//
// Nothing in that stream says £1,450m is Adult skills' 2026-27 figure. Merged
// cells make it worse than lossy: a row under a `rowspan` label emits FEWER
// values than the grid has columns, so a reader inferring alignment infers it
// wrong. Footnotes — where a policy paper keeps the assumption it would rather
// you did not test — were dropped outright.
//
// None of that is mammoth's doing. `convertToHtml` on the same document emits
// `<thead>`, `rowspan`, `colspan`, positional empty cells and the footnote list.
// The structure was always there; the flat path just did not read it. So the
// text below is serialised from mammoth's own HTML instead.
//
// TABS, NOT MARKDOWN PIPES. Anything that quotes this text and then looks the
// quote back up — a citation check, a highlight, a search hit — normalises
// whitespace and leaves every other character alone. A quote spanning two cells
// therefore matches a tab-separated row however the quoter reproduced the gap,
// and matches a pipe-separated one only if it echoed the pipes back exactly.
// SR-Policy-Analysis learned that the expensive way: its first production run
// died on an exact-substring citation rule. Tab-separated rows under a header
// line are also what `extract/spreadsheet.ts` already emits for xlsx, so the two
// tabular paths read alike.
import mammoth from 'mammoth';
import { ExtractError, type DocxBlock, type ExtractResult } from './types';

// Preserve a little more character than mammoth's default map (which drops
// underline/strikethrough) while keeping the default heading/list/table mapping.
const STYLE_MAP = ['u => u', 'strike => s'];

/** Longest table row we will hold in memory while reconstructing a grid. */
const MAX_COLUMNS = 512;

/** True if a cell's text reads as a number (currency, %, thousands, negatives). */
function isNumericText(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const cleaned = t.replace(/^\(|\)$/g, '').replace(/[£$€%,\s]/g, '');
  return /^[-+]?\d*\.?\d+$/.test(cleaned);
}

/**
 * Tag numeric table cells so the viewer can right-align them (financial tables read
 * far better aligned). mammoth wraps cell content in <p>/<strong>; strip tags to test
 * the text, then add `class="num"` to a cell that is purely a number. Cells that
 * already carry a class or aren't numeric are left untouched.
 */
function markNumericCells(html: string): string {
  return html.replace(/<(td|th)((?:(?!class=)[^>])*?)>([\s\S]*?)<\/\1>/gi, (full, tag, attrs, inner) => {
    const text = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim();
    return isNumericText(text) ? `<${tag}${attrs} class="num">${inner}</${tag}>` : full;
  });
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Undo the escaping mammoth applies when it writes HTML.
 *
 * Not cosmetic: "Health & Social Care" reaches the HTML as "Health &amp; Social
 * Care", and a citation carrying a bare ampersand would never be found in the
 * text it was quoted from.
 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full;
    }
    return ENTITY[body.toLowerCase()] ?? full;
  });
}

type Token =
  | { type: 'open' | 'close'; name: string; attrs: string }
  | { type: 'text'; text: string };

const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>|([^<]+)/g;

/** mammoth's own output is the only HTML this ever sees, so a tag walk is enough. */
function* tokenise(html: string): Generator<Token> {
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html)) !== null) {
    if (m[4] != null) { yield { type: 'text', text: m[4] }; continue; }
    if (m[2] == null) continue; // comment
    yield { type: m[1] ? 'close' : 'open', name: m[2].toLowerCase(), attrs: m[3] ?? '' };
  }
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function span(attrs: string, name: 'colspan' | 'rowspan'): number {
  const raw = Number(attr(attrs, name));
  return Number.isInteger(raw) && raw > 1 ? Math.min(raw, MAX_COLUMNS) : 1;
}

type Cell = { text: string; colspan: number; rowspan: number; header: boolean };

/**
 * Lay a table's cells back out on the grid they were authored on.
 *
 * This is the standard HTML table model: a `rowspan` reserves its column in the
 * rows below, so the cells of those rows shift right past it. Skip that and every
 * row under a merge is off by one — which is how "of which adult" ended up in the
 * column headed "2026-27 Cash".
 *
 * Two deliberate asymmetries in how a merge is written back out:
 *
 *  - A `rowspan` label REPEATS down the rows it covers. That is what a merged row
 *    label means, and it is what lets one row still name its own subject after the
 *    passage chunker has cut the table in half.
 *  - A `colspan` in the BODY is written once, in its first column, and the rest of
 *    the span left empty — repeating it would read as N separate values of N.
 *    In a HEADER it repeats, because a header spanning two columns genuinely
 *    labels both of them.
 */
function layOutGrid(rows: Cell[][]): { grid: string[][]; merged: boolean } {
  const pending = new Map<number, { text: string; left: number }>();
  const grid: string[][] = [];
  let merged = false;
  let width = 0;

  for (const row of rows) {
    const out: string[] = [];
    let col = 0;
    const takePending = () => {
      for (;;) {
        const p = pending.get(col);
        if (!p) break;
        out[col] = p.text;
        p.left -= 1;
        if (p.left <= 0) pending.delete(col);
        col++;
      }
    };
    for (const cell of row) {
      takePending();
      if (col >= MAX_COLUMNS) break;
      for (let k = 0; k < cell.colspan && col + k < MAX_COLUMNS; k++) {
        const value = cell.header || k === 0 ? cell.text : '';
        out[col + k] = value;
        if (cell.rowspan > 1) pending.set(col + k, { text: value, left: cell.rowspan - 1 });
      }
      if (cell.colspan > 1 || cell.rowspan > 1) merged = true;
      col += cell.colspan;
    }
    takePending();
    width = Math.max(width, out.length);
    grid.push(out);
  }

  // A row that ended early leaves holes; fill them so every row has the same
  // column count and a reader can count across.
  return { grid: grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')), merged };
}

/**
 * How many leading rows of the grid are the header.
 *
 * `<thead>`/`<th>` is the answer whenever Word recorded one. When it did not —
 * most Word tables never set a repeating header row — fall back to the same
 * judgement `extract/spreadsheet.ts` makes of a sheet: row one is the header when
 * it carries no numbers and the rows under it do.
 */
function headerDepth(rows: Cell[][], grid: string[][]): number {
  let marked = 0;
  while (marked < rows.length && rows[marked].length > 0 && rows[marked].every((c) => c.header)) marked++;
  if (marked) return marked;
  if (grid.length < 2) return 0;
  const first = grid[0].some((c) => isNumericText(c));
  const rest = grid.slice(1).some((r) => r.some((c) => isNumericText(c)));
  return !first && rest ? 1 : 0;
}

/** Collapse several header rows into one label per column: `2026-27 · Cash`. */
function headerLine(grid: string[][], depth: number): string[] {
  const width = grid[0]?.length ?? 0;
  return Array.from({ length: width }, (_, i) => {
    const parts: string[] = [];
    for (let r = 0; r < depth; r++) {
      const v = grid[r][i]?.trim();
      if (v && !parts.includes(v)) parts.push(v);
    }
    return parts.join(' · ');
  });
}

/** One row of the grid as a line. Trailing empties go; interior ones hold the column. */
function rowLine(cells: string[]): string {
  const out = [...cells];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\t');
}

function renderTable(rows: Cell[][], index: number): { text: string; merged: boolean } {
  const { grid, merged } = layOutGrid(rows);
  if (!grid.length) return { text: '', merged };
  const depth = headerDepth(rows, grid);
  const lines = [`[Table ${index}]`];
  if (depth) lines.push(rowLine(headerLine(grid, depth)));
  for (const row of grid.slice(depth)) {
    const line = rowLine(row);
    if (line.trim()) lines.push(line);
  }
  return { text: lines.join('\n'), merged };
}

type Serialised = { blocks: DocxBlock[]; tables: number; mergedTables: number[]; footnotes: number };

/**
 * mammoth's HTML → the blocks the pipeline reads.
 *
 * Blocks, not one string, because the passage chunker downstream has to be able
 * to cut between them: a 7,000-character cut taken blind lands mid-row and leaves
 * half a table in each of two passages.
 */
function serialise(html: string): Serialised {
  const blocks: DocxBlock[] = [];
  const footnotes: string[] = [];
  const mergedTables: number[] = [];
  let tables = 0;

  let buf: string[] = [];
  let heading: number | null = null;
  let listLines: string[] = [];
  let listDepth = 0;
  let footnoteId: string | null = null;

  // Table state. `rows` is null whenever we are not inside one.
  let rows: Cell[][] | null = null;
  let row: Cell[] | null = null;
  let cell: { colspan: number; rowspan: number; header: boolean } | null = null;
  let inHead = false;

  const take = (): string => {
    const text = decodeEntities(buf.join('')).replace(/\s+/g, ' ').trim();
    buf = [];
    return text;
  };
  const push = (kind: DocxBlock['kind'], text: string, level?: number) => {
    if (text.trim()) blocks.push(level == null ? { kind, text } : { kind, level, text });
  };
  const flushInline = () => {
    const text = take();
    if (!text) return;
    if (footnoteId != null) { footnotes.push(`[${footnoteId}] ${text.replace(/\s*↑$/, '').trim()}`); return; }
    if (listDepth > 0) { listLines.push(`${'  '.repeat(Math.max(0, listDepth - 1))}- ${text}`); return; }
    if (heading != null) { push('heading', text, heading); return; }
    push('paragraph', text);
  };

  for (const token of tokenise(html)) {
    if (token.type === 'text') {
      // Inside a table but outside a cell, mammoth emits only whitespace.
      if (rows && !cell) continue;
      buf.push(token.text);
      continue;
    }
    const { name } = token;

    if (token.type === 'open') {
      switch (name) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          flushInline();
          heading = Number(name[1]);
          break;
        case 'p':
          if (!cell) flushInline();
          break;
        case 'ul': case 'ol':
          if (!cell) { flushInline(); listDepth++; }
          break;
        case 'li':
          if (cell) break;
          flushInline();
          // mammoth parks footnote bodies in a trailing <ol> of <li id="footnote-N">.
          // Without this they are simply absent from the text, which is where a
          // policy paper keeps the caveat worth reading.
          if ((attr(token.attrs, 'id') ?? '').startsWith('footnote-')) {
            footnoteId = (attr(token.attrs, 'id') ?? '').replace('footnote-', '');
            listDepth = 0;
          }
          break;
        case 'table':
          flushInline();
          rows = []; inHead = false;
          break;
        case 'thead':
          inHead = true;
          break;
        case 'tbody':
          inHead = false;
          break;
        case 'tr':
          if (rows) row = [];
          break;
        case 'th': case 'td':
          if (row) { cell = { colspan: span(token.attrs, 'colspan'), rowspan: span(token.attrs, 'rowspan'), header: name === 'th' || inHead }; buf = []; }
          break;
        case 'br':
          buf.push(' ');
          break;
        case 'img':
          // The picture itself cannot be read, but the prose refers to it, so say
          // it was here rather than leaving a silent gap. Never the src: mammoth
          // inlines images as base64 data URIs.
          buf.push(' [Figure] ');
          break;
      }
      continue;
    }

    switch (name) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        flushInline();
        heading = null;
        break;
      case 'p':
        if (cell) buf.push(' '); else flushInline();
        break;
      case 'li':
        if (cell) break;
        flushInline();
        footnoteId = null;
        break;
      case 'ul': case 'ol':
        if (cell) break;
        flushInline();
        listDepth = Math.max(0, listDepth - 1);
        if (listDepth === 0 && listLines.length) { push('list', listLines.join('\n')); listLines = []; }
        break;
      case 'th': case 'td':
        if (cell && row) { row.push({ ...cell, text: take().replace(/\t/g, ' ') }); cell = null; }
        break;
      case 'tr':
        if (rows && row) { if (row.length) rows.push(row); row = null; }
        break;
      case 'table': {
        if (!rows) break;
        tables++;
        const { text, merged } = renderTable(rows, tables);
        if (merged) mergedTables.push(tables);
        push('table', text);
        rows = null; row = null; cell = null; inHead = false;
        break;
      }
    }
  }

  flushInline();
  if (listLines.length) push('list', listLines.join('\n'));
  if (footnotes.length) push('footnotes', ['Footnotes', ...footnotes].join('\n'));

  return { blocks, tables, mergedTables, footnotes: footnotes.length };
}

export async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  let textResult: { value: string; messages: Array<{ message: string }> };
  let htmlResult: { value: string };
  try {
    textResult = await mammoth.extractRawText({ buffer });
    htmlResult = await mammoth.convertToHtml({ buffer }, { styleMap: STYLE_MAP });
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'mammoth failed', err);
  }

  const { blocks, tables, mergedTables, footnotes } = serialise(htmlResult.value);
  const structured = blocks.map((b) => b.text).join('\n\n');

  const headings = blocks
    .filter((b): b is DocxBlock & { level: number } => b.kind === 'heading' && b.level != null)
    .map((b) => ({ level: b.level, text: b.text }));

  const warnings = textResult.messages.map((mm) => mm.message);
  // Say what was reshaped, because a reader checking a figure against the original
  // needs to know the grid was rebuilt rather than read off the page.
  if (tables) warnings.push(`${tables} table${tables === 1 ? ' was' : 's were'} read as tab-separated grids under their column headings.`);
  if (mergedTables.length) warnings.push(`Merged cells in table${mergedTables.length === 1 ? '' : 's'} ${mergedTables.join(', ')}: a merged label is repeated on every row it covers.`);
  if (footnotes) warnings.push(`${footnotes} footnote${footnotes === 1 ? ' was' : 's were'} appended to the text and cited by marker.`);

  return {
    // The flat walk is the fallback, not the path: it survives a document whose
    // HTML we somehow read as empty, rather than reporting nothing was in it.
    text: structured.trim() ? structured : textResult.value,
    // mammoth already produced formatted HTML above — surface it for rich preview
    // rather than discarding it (headings, lists, tables, inline images as data:).
    html: markNumericCells(htmlResult.value),
    meta: {
      kind: 'docx',
      headings,
      warnings,
      blocks,
    },
  };
}
