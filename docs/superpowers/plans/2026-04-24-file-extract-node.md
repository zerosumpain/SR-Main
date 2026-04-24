# File Extract / Synthesise Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bidirectional `file-extract` workflow node + admin/files UI integration that extracts text/meta from PDF/DOCX/MD/audio/video and synthesises docx/pdf/html/xlsx/csv.

**Architecture:** A pure `src/lib/jkai/extract/` module (buffers in, text/meta or buffers out) shared between a new `file-extract` workflow node and new admin/files API endpoints. Reuses existing Whisper transcription and storage layer. ffmpeg used as system binary for video → audio.

**Tech Stack:** TypeScript, SvelteKit, Drizzle, Vitest, `pdf-parse`, `mammoth`, `marked`, `docx`, `pdfkit`, `exceljs`, system `ffmpeg`.

**Spec:** `docs/superpowers/specs/2026-04-24-file-extract-node-design.md`

**Working dir:** `/home/john/strange_rambling_svelte`

---

## File map

```
src/lib/jkai/extract/
  types.ts              types, ExtractError, mime → kind mapper
  text.ts               text/markdown/plain passthrough
  markdown.ts           md → text + headings (marked)
  pdf.ts                pdf-parse wrapper, per-page
  docx.ts               mammoth wrapper
  spreadsheet.ts        exceljs read (xlsx/csv)
  ffmpeg.ts             ffmpeg detection + spawn helpers
  audio.ts              Whisper transcription (buffer-based)
  video.ts              ffmpeg → wav → audio.ts
  synth-html.ts         md → html (marked + sanitise)
  synth-docx.ts         md → docx (docx package)
  synth-pdf.ts          text/md → pdf (pdfkit)
  synth-spreadsheet.ts  json/csv/xlsx ↔ xlsx/csv (exceljs)
  index.ts              extractText() + synthesize() public API

src/lib/workflows/nodes/
  file-extract.def.ts   node definition
  file-extract.ts       executor

src/routes/api/files/[id]/extract/+server.ts   admin extract endpoint
src/routes/api/files/[id]/convert/+server.ts   admin convert endpoint
src/routes/admin/files/+page.svelte            (modify) add Extract + Convert buttons

src/lib/workflows/index.ts                     (modify) register node

tests/extract/                                 unit tests
tests/fixtures/extract/                        small fixture files
```

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
cd ~/strange_rambling_svelte
npm install pdf-parse mammoth marked docx pdfkit exceljs
npm install -D @types/pdf-parse @types/pdfkit
```

- [ ] **Step 2: Verify ffmpeg is installed on the system**

Run: `which ffmpeg && which ffprobe`
Expected: prints two paths. If missing: `sudo apt install -y ffmpeg`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add deps for file extract/synthesise (pdf-parse, mammoth, marked, docx, pdfkit, exceljs)"
```

---

### Task 2: Types, error class, and mime mapping

**Files:**
- Create: `src/lib/jkai/extract/types.ts`

- [ ] **Step 1: Write the file**

```ts
// src/lib/jkai/extract/types.ts

export type ExtractKind =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'markdown'
  | 'text'
  | 'audio'
  | 'video'
  | 'spreadsheet';

export type ExtractMeta =
  | { kind: 'pdf'; pageCount: number; pages: Array<{ index: number; text: string; error?: string }> }
  | { kind: 'docx'; headings: Array<{ level: number; text: string }>; warnings: string[] }
  | { kind: 'markdown'; headings: Array<{ level: number; text: string }> }
  | { kind: 'text'; encoding: 'utf-8' | 'latin-1' }
  | { kind: 'audio'; durationSec?: number; segments?: Array<{ start: number; end: number; text: string }>; language?: string }
  | { kind: 'video'; durationSec?: number; segments?: Array<{ start: number; end: number; text: string }>; language?: string }
  | { kind: 'spreadsheet'; sheets: Array<{ name: string; rowCount: number; columns: string[] }> };

export interface ExtractResult {
  text: string;
  meta: ExtractMeta;
}

export interface ExtractOptions {
  pages?: { from: number; to: number };
  language?: string;
}

export type SynthesizeFormat = 'docx' | 'pdf' | 'html' | 'xlsx' | 'csv';
export type SynthesizeSource = 'markdown' | 'text' | 'json' | 'csv' | 'xlsx';

export interface SynthesizeInput {
  format: SynthesizeFormat;
  source: SynthesizeSource;
  content: string | Buffer;
  title?: string;
  sheetName?: string;
}

export interface SynthesizeResult {
  buffer: Buffer;
  mimeType: string;
  suggestedExtension: string;
}

export type ExtractErrorCode =
  | 'E_UNSUPPORTED_MIME'
  | 'E_FFMPEG_MISSING'
  | 'E_PARSE_FAILED'
  | 'E_TRANSCRIBE_FAILED'
  | 'E_INVALID_INPUT'
  | 'E_SOURCE_TOO_LARGE';

export class ExtractError extends Error {
  code: ExtractErrorCode;
  cause?: unknown;
  constructor(code: ExtractErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExtractError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export function kindFromMime(mimeType: string, filename = ''): ExtractKind | null {
  const m = (mimeType || '').toLowerCase();
  const lowerName = filename.toLowerCase();

  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (m === 'application/msword') return 'doc';
  if (m === 'text/markdown' || m === 'text/x-markdown' || lowerName.endsWith('.md')) return 'markdown';
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || m === 'application/vnd.ms-excel') return 'spreadsheet';
  if (m === 'text/csv' || lowerName.endsWith('.csv')) return 'spreadsheet';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/yaml' || m === 'application/x-yaml') return 'text';

  // Fallback by extension when octet-stream
  if (m === 'application/octet-stream' || !m) {
    if (lowerName.endsWith('.pdf')) return 'pdf';
    if (lowerName.endsWith('.docx')) return 'docx';
    if (lowerName.endsWith('.doc')) return 'doc';
    if (lowerName.endsWith('.md')) return 'markdown';
    if (lowerName.endsWith('.xlsx')) return 'spreadsheet';
    if (lowerName.endsWith('.csv')) return 'spreadsheet';
    if (lowerName.endsWith('.txt')) return 'text';
  }
  return null;
}

export const MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SEC = 30 * 60;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep extract/types || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/lib/jkai/extract/types.ts
git commit -m "feat(extract): types, error class, mime → kind mapper"
```

---

### Task 3: Text + Markdown extractors

**Files:**
- Create: `src/lib/jkai/extract/text.ts`
- Create: `src/lib/jkai/extract/markdown.ts`
- Create: `tests/extract/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/extract/markdown.test.ts
import { describe, it, expect } from 'vitest';
import { extractMarkdown } from '../../src/lib/jkai/extract/markdown';

describe('markdown extractor', () => {
  it('strips markdown to plain text and captures headings', () => {
    const md = '# Title\n\nSome **bold** text.\n\n## Subsection\n\nA list:\n- one\n- two';
    const r = extractMarkdown(Buffer.from(md, 'utf8'));
    expect(r.text).toContain('Title');
    expect(r.text).toContain('Some bold text.');
    expect(r.text).toContain('one');
    expect(r.meta.kind).toBe('markdown');
    if (r.meta.kind !== 'markdown') throw new Error('wrong kind');
    expect(r.meta.headings).toEqual([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Subsection' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extract/markdown.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `text.ts`**

```ts
// src/lib/jkai/extract/text.ts
import type { ExtractResult } from './types';

export function extractPlainText(buffer: Buffer): ExtractResult {
  const text = buffer.toString('utf8');
  return {
    text,
    meta: { kind: 'text', encoding: 'utf-8' },
  };
}
```

- [ ] **Step 4: Write `markdown.ts`**

```ts
// src/lib/jkai/extract/markdown.ts
import { marked } from 'marked';
import type { ExtractResult } from './types';

export function extractMarkdown(buffer: Buffer): ExtractResult {
  const md = buffer.toString('utf8');
  const tokens = marked.lexer(md);
  const headings: Array<{ level: number; text: string }> = [];
  const lines: string[] = [];

  const walk = (toks: unknown[]) => {
    for (const t of toks as Array<Record<string, unknown>>) {
      if (t.type === 'heading') {
        headings.push({ level: t.depth as number, text: (t.text as string).trim() });
        lines.push((t.text as string).trim());
      } else if (t.type === 'paragraph' || t.type === 'text') {
        if (t.text) lines.push((t.text as string).trim());
      } else if (t.type === 'list') {
        for (const item of (t.items as Array<Record<string, unknown>>) ?? []) {
          if (item.text) lines.push('- ' + (item.text as string).trim());
        }
      } else if (t.type === 'code') {
        if (t.text) lines.push((t.text as string).trim());
      } else if (t.type === 'blockquote' && Array.isArray(t.tokens)) {
        walk(t.tokens as unknown[]);
      }
    }
  };
  walk(tokens);

  // Strip residual md syntax (bold/italic markers) from line content
  const cleaned = lines
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/_([^_]+)_/g, '$1'))
    .join('\n\n');

  return {
    text: cleaned,
    meta: { kind: 'markdown', headings },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/extract/markdown.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jkai/extract/text.ts src/lib/jkai/extract/markdown.ts tests/extract/markdown.test.ts
git commit -m "feat(extract): text passthrough + markdown extractor with headings"
```

---

### Task 4: PDF extractor

**Files:**
- Create: `src/lib/jkai/extract/pdf.ts`
- Create: `tests/extract/pdf.test.ts`
- Create: `tests/fixtures/extract/sample.pdf` (small text PDF)

- [ ] **Step 1: Generate a fixture PDF**

```bash
cd ~/strange_rambling_svelte
mkdir -p tests/fixtures/extract
node -e "
const PDFDocument = require('pdfkit');
const fs = require('fs');
const doc = new PDFDocument();
doc.pipe(fs.createWriteStream('tests/fixtures/extract/sample.pdf'));
doc.fontSize(14).text('Hello world from page one.');
doc.addPage().fontSize(14).text('This is page two.');
doc.end();
"
ls -la tests/fixtures/extract/sample.pdf
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/extract/pdf.test.ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/extract/pdf.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `pdf.ts`**

```ts
// src/lib/jkai/extract/pdf.ts
import { ExtractError, type ExtractResult, type ExtractOptions } from './types';

interface PdfParseResult {
  numpages: number;
  text: string;
}

export async function extractPdf(buffer: Buffer, options?: ExtractOptions): Promise<ExtractResult> {
  // pdf-parse exports a function via cjs default
  const mod = (await import('pdf-parse')) as unknown as { default: (b: Buffer, o?: unknown) => Promise<PdfParseResult> };
  const pdfParse = mod.default ?? (mod as unknown as (b: Buffer) => Promise<PdfParseResult>);

  const pages: Array<{ index: number; text: string; error?: string }> = [];

  // pdf-parse's pagerender lets us collect per-page text
  const pageTexts: string[] = [];
  const pagerender = async (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) => {
    try {
      const tc = await pageData.getTextContent();
      const t = tc.items.map((i) => i.str).join(' ');
      pageTexts.push(t);
      return t;
    } catch (e) {
      pageTexts.push('');
      pages.push({ index: pageTexts.length, text: '', error: e instanceof Error ? e.message : String(e) });
      return '';
    }
  };

  let result: PdfParseResult;
  try {
    result = await pdfParse(buffer, { pagerender });
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'pdf-parse failed', err);
  }

  // Build pages array (only entries without errors get added above; fill in successes here)
  const fromIdx = options?.pages?.from ? options.pages.from - 1 : 0;
  const toIdx = options?.pages?.to ? options.pages.to : result.numpages;
  const filtered: Array<{ index: number; text: string; error?: string }> = [];
  for (let i = 0; i < pageTexts.length; i++) {
    if (i < fromIdx || i >= toIdx) continue;
    const errEntry = pages.find((p) => p.index === i + 1 && p.error);
    filtered.push(errEntry ?? { index: i + 1, text: pageTexts[i] ?? '' });
  }

  const text = filtered.map((p) => p.text).filter(Boolean).join('\n\n');

  return {
    text,
    meta: { kind: 'pdf', pageCount: result.numpages, pages: filtered },
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/extract/pdf.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/jkai/extract/pdf.ts tests/extract/pdf.test.ts tests/fixtures/extract/sample.pdf
git commit -m "feat(extract): PDF extractor with per-page output and partial-success"
```

---

### Task 5: DOCX extractor

**Files:**
- Create: `src/lib/jkai/extract/docx.ts`
- Create: `tests/extract/docx.test.ts`
- Create: `tests/fixtures/extract/sample.docx`

- [ ] **Step 1: Generate fixture docx**

```bash
cd ~/strange_rambling_svelte
node -e "
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');
const fs = require('fs');
const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: 'Doc Heading', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun('Some body text here.')] }),
      new Paragraph({ text: 'Subsection', heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ children: [new TextRun('Another line.')] }),
    ],
  }],
});
Packer.toBuffer(doc).then(buf => fs.writeFileSync('tests/fixtures/extract/sample.docx', buf));
"
ls -la tests/fixtures/extract/sample.docx
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/extract/docx.test.ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/extract/docx.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `docx.ts`**

```ts
// src/lib/jkai/extract/docx.ts
import mammoth from 'mammoth';
import { ExtractError, type ExtractResult } from './types';

export async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  let textResult: { value: string; messages: Array<{ message: string }> };
  let htmlResult: { value: string };
  try {
    textResult = await mammoth.extractRawText({ buffer });
    htmlResult = await mammoth.convertToHtml({ buffer });
  } catch (err) {
    throw new ExtractError('E_PARSE_FAILED', 'mammoth failed', err);
  }

  const headings: Array<{ level: number; text: string }> = [];
  const re = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlResult.value)) !== null) {
    const level = parseInt(m[1] ?? '1', 10);
    const text = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
    if (text) headings.push({ level, text });
  }

  return {
    text: textResult.value,
    meta: {
      kind: 'docx',
      headings,
      warnings: textResult.messages.map((mm) => mm.message),
    },
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/extract/docx.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jkai/extract/docx.ts tests/extract/docx.test.ts tests/fixtures/extract/sample.docx
git commit -m "feat(extract): DOCX extractor with heading detection (mammoth)"
```

---

### Task 6: Spreadsheet extractor (xlsx + csv read)

**Files:**
- Create: `src/lib/jkai/extract/spreadsheet.ts`
- Create: `tests/extract/spreadsheet.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/extract/spreadsheet.test.ts
import { describe, it, expect } from 'vitest';
import { extractSpreadsheet } from '../../src/lib/jkai/extract/spreadsheet';

describe('spreadsheet extractor', () => {
  it('reads csv into text + meta', async () => {
    const csv = 'name,age\nAlice,30\nBob,25\n';
    const r = await extractSpreadsheet(Buffer.from(csv, 'utf8'), 'text/csv', 'people.csv');
    expect(r.text).toContain('Alice');
    expect(r.text).toContain('Bob');
    if (r.meta.kind !== 'spreadsheet') throw new Error();
    expect(r.meta.sheets[0].rowCount).toBe(2);
    expect(r.meta.sheets[0].columns).toEqual(['name', 'age']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/extract/spreadsheet.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `spreadsheet.ts`**

```ts
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
  });

  return {
    text: textParts.join('\n\n'),
    meta: { kind: 'spreadsheet', sheets },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/extract/spreadsheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/extract/spreadsheet.ts tests/extract/spreadsheet.test.ts
git commit -m "feat(extract): spreadsheet extractor (xlsx + csv via exceljs)"
```

---

### Task 7: ffmpeg helper

**Files:**
- Create: `src/lib/jkai/extract/ffmpeg.ts`

- [ ] **Step 1: Write the file**

```ts
// src/lib/jkai/extract/ffmpeg.ts
import { spawn } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExtractError } from './types';

let ffmpegPath: string | null | undefined;
let ffprobePath: string | null | undefined;

async function which(bin: string): Promise<string | null> {
  return await new Promise((resolve) => {
    const p = spawn('which', [bin]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    p.on('error', () => resolve(null));
  });
}

export async function ensureFfmpeg(): Promise<{ ffmpeg: string; ffprobe: string }> {
  if (ffmpegPath === undefined) ffmpegPath = await which('ffmpeg');
  if (ffprobePath === undefined) ffprobePath = await which('ffprobe');
  if (!ffmpegPath || !ffprobePath) {
    throw new ExtractError(
      'E_FFMPEG_MISSING',
      'ffmpeg/ffprobe binary not found on PATH. Install with: apt install ffmpeg',
    );
  }
  return { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
}

export async function probeDurationSec(buffer: Buffer): Promise<number | undefined> {
  const { ffprobe } = await ensureFfmpeg();
  const dir = await mkdtemp(join(tmpdir(), 'extract-probe-'));
  const inPath = join(dir, 'in.bin');
  await writeFile(inPath, buffer);
  try {
    const out = await runProc(ffprobe, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inPath]);
    const n = parseFloat(out.trim());
    return Number.isFinite(n) ? n : undefined;
  } finally {
    await unlink(inPath).catch(() => {});
  }
}

export async function videoToWav(buffer: Buffer): Promise<Buffer> {
  const { ffmpeg } = await ensureFfmpeg();
  const dir = await mkdtemp(join(tmpdir(), 'extract-vid-'));
  const inPath = join(dir, 'in.bin');
  const outPath = join(dir, 'out.wav');
  await writeFile(inPath, buffer);
  try {
    await runProc(ffmpeg, ['-y', '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outPath]);
    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

function runProc(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
    });
    p.on('error', reject);
  });
}
```

- [ ] **Step 2: Sanity-check via Node**

```bash
cd ~/strange_rambling_svelte
node --import tsx -e "
import('./src/lib/jkai/extract/ffmpeg.ts').then(async (m) => {
  const r = await m.ensureFfmpeg();
  console.log('ok', r);
}).catch(e => { console.error('FAIL', e.message); process.exit(1); });
"
```
Expected: prints `ok { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '...' }`

- [ ] **Step 3: Commit**

```bash
git add src/lib/jkai/extract/ffmpeg.ts
git commit -m "feat(extract): ffmpeg helper with detection + video→wav"
```

---

### Task 8: Audio + Video extractors

**Files:**
- Create: `src/lib/jkai/extract/audio.ts`
- Create: `src/lib/jkai/extract/video.ts`

- [ ] **Step 1: Write `audio.ts`**

```ts
// src/lib/jkai/extract/audio.ts
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { ExtractError, type ExtractResult, type ExtractOptions } from './types';

export async function extractAudio(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  const modelCtx = await resolveDefaultModel('builder');
  const { client } = await getLLMClient(modelCtx);

  try {
    const file = new File([buffer], filename || 'audio.bin', { type: mimeType || 'audio/mpeg' });
    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      ...(options?.language ? { language: options.language } : {}),
    });
    const text = response.text ?? '';
    return {
      text,
      meta: {
        kind: 'audio',
        language: options?.language,
      },
    };
  } catch (err) {
    throw new ExtractError('E_TRANSCRIBE_FAILED', 'Whisper transcription failed', err);
  }
}
```

- [ ] **Step 2: Write `video.ts`**

```ts
// src/lib/jkai/extract/video.ts
import { extractAudio } from './audio';
import { videoToWav, probeDurationSec } from './ffmpeg';
import { ExtractError, type ExtractResult, type ExtractOptions, MAX_VIDEO_DURATION_SEC } from './types';

export async function extractVideo(
  buffer: Buffer,
  _mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  const duration = await probeDurationSec(buffer).catch(() => undefined);
  if (duration && duration > MAX_VIDEO_DURATION_SEC) {
    throw new ExtractError(
      'E_SOURCE_TOO_LARGE',
      `video is ${Math.round(duration)}s; max ${MAX_VIDEO_DURATION_SEC}s for v1`,
    );
  }

  const wav = await videoToWav(buffer);
  const audio = await extractAudio(wav, 'audio/wav', (filename || 'video') + '.wav', options);

  return {
    text: audio.text,
    meta: {
      kind: 'video',
      durationSec: duration,
      language: options?.language,
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'extract/(audio|video)' || echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jkai/extract/audio.ts src/lib/jkai/extract/video.ts
git commit -m "feat(extract): audio (Whisper) + video (ffmpeg→wav→audio) extractors"
```

---

### Task 9: Synthesis modules

**Files:**
- Create: `src/lib/jkai/extract/synth-html.ts`
- Create: `src/lib/jkai/extract/synth-docx.ts`
- Create: `src/lib/jkai/extract/synth-pdf.ts`
- Create: `src/lib/jkai/extract/synth-spreadsheet.ts`
- Create: `tests/extract/synth.test.ts`

- [ ] **Step 1: Write `synth-html.ts`**

```ts
// src/lib/jkai/extract/synth-html.ts
import { marked } from 'marked';
import type { SynthesizeResult } from './types';

export async function synthesizeHtml(markdown: string, title?: string): Promise<SynthesizeResult> {
  const body = await marked.parse(markdown, { async: true });
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title ?? 'Document')}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.55;} pre{background:#f5f5f5;padding:.75rem;overflow:auto;} code{font-family:ui-monospace,Menlo,monospace;}</style>
</head>
<body>
${body}
</body>
</html>`;
  return {
    buffer: Buffer.from(html, 'utf8'),
    mimeType: 'text/html',
    suggestedExtension: '.html',
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

- [ ] **Step 2: Write `synth-docx.ts`**

```ts
// src/lib/jkai/extract/synth-docx.ts
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import { marked } from 'marked';
import type { SynthesizeResult } from './types';

export async function synthesizeDocx(markdown: string, title?: string): Promise<SynthesizeResult> {
  const tokens = marked.lexer(markdown);
  const children: Paragraph[] = [];
  if (title) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  }

  for (const t of tokens as Array<Record<string, unknown>>) {
    if (t.type === 'heading') {
      const level = t.depth as number;
      const map: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      children.push(new Paragraph({ text: (t.text as string) ?? '', heading: map[level] ?? HeadingLevel.HEADING_3 }));
    } else if (t.type === 'paragraph') {
      children.push(new Paragraph({ children: [new TextRun((t.text as string) ?? '')] }));
    } else if (t.type === 'list') {
      for (const item of (t.items as Array<Record<string, unknown>>) ?? []) {
        children.push(new Paragraph({ text: '• ' + ((item.text as string) ?? '') }));
      }
    } else if (t.type === 'code') {
      children.push(new Paragraph({ children: [new TextRun({ text: (t.text as string) ?? '', font: 'Courier New' })] }));
    } else if (t.type === 'space') {
      children.push(new Paragraph(''));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = Buffer.from(await Packer.toBuffer(doc));
  return {
    buffer,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    suggestedExtension: '.docx',
  };
}
```

- [ ] **Step 3: Write `synth-pdf.ts`**

```ts
// src/lib/jkai/extract/synth-pdf.ts
import PDFDocument from 'pdfkit';
import type { SynthesizeResult } from './types';

export async function synthesizePdf(text: string, title?: string): Promise<SynthesizeResult> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  if (title) {
    doc.fontSize(20).text(title, { underline: false });
    doc.moveDown();
  }
  doc.fontSize(12).text(text, { align: 'left' });
  doc.end();
  await done;

  return {
    buffer: Buffer.concat(chunks),
    mimeType: 'application/pdf',
    suggestedExtension: '.pdf',
  };
}
```

- [ ] **Step 4: Write `synth-spreadsheet.ts`**

```ts
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
```

- [ ] **Step 5: Write the synth test**

```ts
// tests/extract/synth.test.ts
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
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/extract/synth.test.ts`
Expected: PASS (all four).

- [ ] **Step 7: Commit**

```bash
git add src/lib/jkai/extract/synth-*.ts tests/extract/synth.test.ts
git commit -m "feat(extract): synthesisers for html, docx, pdf, xlsx, csv"
```

---

### Task 10: Public API (`extract/index.ts`)

**Files:**
- Create: `src/lib/jkai/extract/index.ts`

- [ ] **Step 1: Write the file**

```ts
// src/lib/jkai/extract/index.ts
import {
  ExtractError,
  kindFromMime,
  MAX_INPUT_BYTES,
  type ExtractOptions,
  type ExtractResult,
  type SynthesizeInput,
  type SynthesizeResult,
} from './types';
import { extractPlainText } from './text';
import { extractMarkdown } from './markdown';
import { extractPdf } from './pdf';
import { extractDocx } from './docx';
import { extractSpreadsheet } from './spreadsheet';
import { extractAudio } from './audio';
import { extractVideo } from './video';
import { synthesizeHtml } from './synth-html';
import { synthesizeDocx } from './synth-docx';
import { synthesizePdf } from './synth-pdf';
import { synthesizeSpreadsheet } from './synth-spreadsheet';

export * from './types';

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  if (buffer.byteLength > MAX_INPUT_BYTES) {
    throw new ExtractError('E_SOURCE_TOO_LARGE', `input is ${buffer.byteLength} bytes; max ${MAX_INPUT_BYTES}`);
  }
  const kind = kindFromMime(mimeType, filename);
  if (!kind) {
    throw new ExtractError('E_UNSUPPORTED_MIME', `cannot extract from mime ${mimeType} (filename ${filename})`);
  }

  switch (kind) {
    case 'pdf': return extractPdf(buffer, options);
    case 'docx':
    case 'doc': return extractDocx(buffer);
    case 'markdown': return extractMarkdown(buffer);
    case 'text': return extractPlainText(buffer);
    case 'spreadsheet': return extractSpreadsheet(buffer, mimeType, filename);
    case 'audio': return extractAudio(buffer, mimeType, filename, options);
    case 'video': return extractVideo(buffer, mimeType, filename, options);
  }
}

export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
  const { format, source, content, title, sheetName } = input;
  const text = (): string => (typeof content === 'string' ? content : content.toString('utf8'));

  // Validate combinations per spec
  if (source === 'markdown' && format === 'html') return synthesizeHtml(text(), title);
  if (source === 'markdown' && format === 'docx') return synthesizeDocx(text(), title);
  if (source === 'markdown' && format === 'pdf') return synthesizePdf(text(), title);
  if (source === 'text' && format === 'pdf') return synthesizePdf(text(), title);
  if ((source === 'json' || source === 'csv' || source === 'xlsx') && (format === 'xlsx' || format === 'csv')) {
    return synthesizeSpreadsheet(source, format, content, sheetName);
  }

  throw new ExtractError('E_INVALID_INPUT', `unsupported source/format combination: ${source} → ${format}`);
}
```

- [ ] **Step 2: Sanity check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep extract/index || echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/jkai/extract/index.ts
git commit -m "feat(extract): public extractText() + synthesize() API"
```

---

### Task 11: Workflow node — definition + executor

**Files:**
- Create: `src/lib/workflows/nodes/file-extract.def.ts`
- Create: `src/lib/workflows/nodes/file-extract.ts`
- Modify: `src/lib/workflows/index.ts`

- [ ] **Step 1: Write the node definition**

```ts
// src/lib/workflows/nodes/file-extract.def.ts
import type { NodeDefinition } from '../types';

export const fileExtractDef: NodeDefinition = {
  type: 'file-extract',
  label: 'File Extract / Convert',
  category: 'integration',
  description:
    'Extract text + structured metadata from PDF/DOCX/MD/audio/video files in the file store, OR synthesise a new file (docx/pdf/html/xlsx/csv) from text/markdown/json/csv/xlsx.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['extract', 'synthesize'] },
      // extract
      fileName: { type: 'string', description: 'Source file in the workflow file store. Supports {{input.x}} templates.' },
      pageFrom: { type: 'number', description: 'PDF only: 1-indexed first page' },
      pageTo: { type: 'number', description: 'PDF only: 1-indexed last page (inclusive)' },
      language: { type: 'string', description: 'Audio/video: language hint for Whisper (BCP-47, e.g. en, es)' },
      // synthesize
      format: { type: 'string', enum: ['docx', 'pdf', 'html', 'xlsx', 'csv'] },
      source: { type: 'string', enum: ['markdown', 'text', 'json', 'csv', 'xlsx'] },
      contentPath: { type: 'string', description: 'Dot-path into input for synthesise content. Defaults to input.content.' },
      title: { type: 'string' },
      // shared
      persist: { type: 'boolean', description: 'Save the result as a new workflow file.' },
      outputName: { type: 'string', description: 'Required when persist=true. Name of the new file in the store.' },
    },
    required: ['mode'],
  },
  defaultConfig: { mode: 'extract', persist: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'dropdown',
      description: 'Extract pulls text out of a stored file. Synthesise builds a new file from input data.',
      options: [
        { value: 'extract', label: 'Extract text from file' },
        { value: 'synthesize', label: 'Synthesise new file' },
      ],
    },
    {
      key: 'fileName',
      label: 'Source file',
      type: 'template-textarea',
      description: 'Name of the file in the store. Supports {{input.field}} templates.',
      placeholder: 'docs/contract.pdf',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'pageFrom',
      label: 'First page (PDF only)',
      type: 'text',
      description: '1-indexed. Leave empty for all pages.',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'pageTo',
      label: 'Last page (PDF only)',
      type: 'text',
      description: 'Inclusive. Leave empty for last page.',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'language',
      label: 'Language (audio/video)',
      type: 'text',
      description: 'BCP-47 hint, e.g. en. Leave empty for auto-detect.',
      placeholder: 'en',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'format',
      label: 'Output format',
      type: 'dropdown',
      description: 'What kind of file to produce.',
      options: [
        { value: 'docx', label: 'DOCX (Word)' },
        { value: 'pdf', label: 'PDF' },
        { value: 'html', label: 'HTML' },
        { value: 'xlsx', label: 'XLSX (Excel)' },
        { value: 'csv', label: 'CSV' },
      ],
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'source',
      label: 'Input format',
      type: 'dropdown',
      description: 'Format of the content you are providing.',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'text', label: 'Plain text' },
        { value: 'json', label: 'JSON (array of rows)' },
        { value: 'csv', label: 'CSV' },
        { value: 'xlsx', label: 'XLSX (binary, base64)' },
      ],
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'contentPath',
      label: 'Content path',
      type: 'text',
      description: 'Dot-path into input (default: input.content).',
      placeholder: 'data.body',
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      description: 'Optional title for docx/pdf output.',
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'persist',
      label: 'Save to file store',
      type: 'dropdown',
      description: 'When on, the result becomes a new workflow file (browseable in /admin/files).',
      options: [
        { value: 'false', label: 'No (in-memory only)' },
        { value: 'true', label: 'Yes' },
      ],
    },
    {
      key: 'outputName',
      label: 'Saved file name',
      type: 'template-textarea',
      description: 'Required when "Save to file store" is on.',
      placeholder: 'reports/output.docx',
    },
  ],
  llmDescription:
    'Use file-extract to (a) pull plain text + structured metadata out of an existing PDF/DOCX/MD/audio/video file in the workflow file store, or (b) synthesise a new file (docx/pdf/html/xlsx/csv) from text/markdown/json/csv. In extract mode, output is { text, meta, sourceFile }. In synthesise mode, output is { base64, mimeType, sizeBytes, suggestedExtension } and a { file } sub-object when persist=true.',
  llmExamples: [
    { mode: 'extract', fileName: 'contract.pdf' },
    { mode: 'extract', fileName: 'meeting.mp4', language: 'en' },
    { mode: 'synthesize', format: 'docx', source: 'markdown', contentPath: 'input.report', persist: true, outputName: 'reports/{{input.id}}.docx' },
    { mode: 'synthesize', format: 'xlsx', source: 'json', contentPath: 'input.rows' },
  ],
};
```

- [ ] **Step 2: Write the executor**

```ts
// src/lib/workflows/nodes/file-extract.ts
import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { extractText, synthesize, ExtractError, type SynthesizeFormat, type SynthesizeSource } from '$lib/jkai/extract';

export { fileExtractDef } from './file-extract.def';

function permissionsFor(raw: unknown): WorkflowFilePermissions {
  const p = (raw ?? {}) as Partial<WorkflowFilePermissions>;
  return {
    read: p.read !== false,
    write: !!p.write,
    append: !!p.append,
    delete: !!p.delete,
  };
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function coerceContent(raw: unknown, source: SynthesizeSource): string | Buffer {
  if (source === 'xlsx') {
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    if (typeof raw === 'string') return Buffer.from(raw, 'base64');
    throw new ExtractError('E_INVALID_INPUT', 'xlsx source requires Buffer or base64 string');
  }
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw === null || raw === undefined) return '';
  return JSON.stringify(raw);
}

export const fileExtractExecutor: NodeExecutor = {
  type: 'file-extract',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const mode = (config.mode as 'extract' | 'synthesize') || 'extract';

    if (mode === 'extract') {
      const fileName = interpolateTemplate((config.fileName as string) || '', input).trim();
      if (!fileName) throw new Error('file-extract: fileName is required for extract mode');

      const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, fileName));
      if (!existing) throw new Error(`file-extract: file not found: ${fileName}`);
      const perms = permissionsFor(existing.permissions);
      if (!perms.read) throw new Error(`file-extract: read permission denied on ${fileName}`);

      const buf = await readBuffer(existing.diskPath);
      const pageFrom = config.pageFrom ? Number(config.pageFrom) : undefined;
      const pageTo = config.pageTo ? Number(config.pageTo) : undefined;
      const language = (config.language as string) || undefined;

      try {
        const result = await extractText(buf, existing.mimeType, existing.name, {
          pages: pageFrom ? { from: pageFrom, to: pageTo ?? pageFrom } : undefined,
          language,
        });

        let persisted: { id: string; name: string } | undefined;
        if (toBool(config.persist)) {
          const outputName = interpolateTemplate((config.outputName as string) || '', input).trim()
            || `${existing.name}.extracted.txt`;
          const outBuf = Buffer.from(result.text, 'utf8');
          persisted = await writeWorkflowFile(outputName, outBuf, 'text/plain');
        }

        return {
          output: {
            text: result.text,
            meta: result.meta,
            sourceFile: { id: existing.id, name: existing.name, mimeType: existing.mimeType },
            file: persisted,
          },
        };
      } catch (err) {
        if (err instanceof ExtractError) {
          throw new Error(`file-extract: ${err.code}: ${err.message}`);
        }
        throw err;
      }
    }

    // synthesize
    const format = config.format as SynthesizeFormat | undefined;
    const source = config.source as SynthesizeSource | undefined;
    if (!format || !source) throw new Error('file-extract: format and source are required for synthesize mode');

    const contentPath = (config.contentPath as string) || 'input.content';
    const raw = resolvePath({ input } as Record<string, unknown>, contentPath);
    const content = coerceContent(raw, source);
    const title = (config.title as string) || undefined;

    try {
      const result = await synthesize({ format, source, content, title });
      let persisted: { id: string; name: string } | undefined;
      if (toBool(config.persist)) {
        const outputName = interpolateTemplate((config.outputName as string) || '', input).trim();
        if (!outputName) throw new Error('file-extract: outputName is required when persist=true');
        persisted = await writeWorkflowFile(outputName, result.buffer, result.mimeType);
      }
      return {
        output: {
          base64: result.buffer.toString('base64'),
          mimeType: result.mimeType,
          sizeBytes: result.buffer.length,
          suggestedExtension: result.suggestedExtension,
          file: persisted,
        },
      };
    } catch (err) {
      if (err instanceof ExtractError) {
        throw new Error(`file-extract: ${err.code}: ${err.message}`);
      }
      throw err;
    }
  },

  getInputSchema(_config): JsonSchema {
    return { type: 'object', description: 'Extract: needs no input (file is loaded by name). Synthesise: input.content (or contentPath) supplies the content.' };
  },

  getOutputSchema(config): JsonSchema {
    const mode = config.mode as 'extract' | 'synthesize';
    if (mode === 'synthesize') {
      return {
        type: 'object',
        properties: {
          base64: { type: 'string' } as const,
          mimeType: { type: 'string' } as const,
          sizeBytes: { type: 'number' } as const,
          suggestedExtension: { type: 'string' } as const,
        } as Record<string, JsonSchema>,
      };
    }
    return {
      type: 'object',
      properties: {
        text: { type: 'string' } as const,
        meta: { type: 'object' } as const,
        sourceFile: { type: 'object' } as const,
      } as Record<string, JsonSchema>,
    };
  },
};

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return false;
}

async function writeWorkflowFile(name: string, buffer: Buffer, mimeType: string): Promise<{ id: string; name: string }> {
  const cleanName = name.replace(/^\/+/, '').slice(0, 200);
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, cleanName));
  if (existing) {
    await saveBuffer(existing.diskPath, buffer);
    await db.update(workflowFiles)
      .set({ sizeBytes: buffer.byteLength, mimeType, updatedAt: new Date() })
      .where(eq(workflowFiles.id, existing.id));
    return { id: existing.id, name: existing.name };
  }
  const diskPath = newDiskPath(cleanName);
  await saveBuffer(diskPath, buffer);
  const [inserted] = await db.insert(workflowFiles).values({
    name: cleanName,
    mimeType,
    sizeBytes: buffer.byteLength,
    diskPath,
    permissions: { read: true, write: true, append: false, delete: false },
  }).returning();
  return { id: inserted.id, name: inserted.name };
}
```

- [ ] **Step 3: Register the node**

Open `src/lib/workflows/index.ts`. Add the import next to `fileStoreDef` and the registration next to `registry.register(fileStoreDef, ...)`:

```ts
import { fileExtractDef, fileExtractExecutor } from './nodes/file-extract';
// ...
registry.register(fileExtractDef, fileExtractExecutor);
```

- [ ] **Step 4: Typecheck**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --threshold error 2>&1 | tail -20`
Expected: 0 errors. If there are errors, fix them inline (most likely import paths or type narrowing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/nodes/file-extract.def.ts src/lib/workflows/nodes/file-extract.ts src/lib/workflows/index.ts
git commit -m "feat(workflows): file-extract node (extract + synthesise modes)"
```

---

### Task 12: Admin/files API endpoints

**Files:**
- Create: `src/routes/api/files/[id]/extract/+server.ts`
- Create: `src/routes/api/files/[id]/convert/+server.ts`

- [ ] **Step 1: Write the extract endpoint**

```ts
// src/routes/api/files/[id]/extract/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { extractText, ExtractError } from '$lib/jkai/extract';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, { status: 400 });
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, id));
  if (!row) return json({ error: 'file not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const language = typeof body.language === 'string' ? body.language : undefined;

  const session = await locals.auth();
  const uploadedBy = session?.user?.email ?? row.uploadedBy ?? null;

  let result;
  try {
    const buf = await readBuffer(row.diskPath);
    result = await extractText(buf, row.mimeType, row.name, { language });
  } catch (err) {
    if (err instanceof ExtractError) {
      const status = err.code === 'E_UNSUPPORTED_MIME' || err.code === 'E_INVALID_INPUT' ? 415 : 500;
      return json({ error: err.message, code: err.code }, { status });
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const txtName = `${row.name}.extracted.txt`;
  const jsonName = `${row.name}.extracted.json`;

  const txtBuf = Buffer.from(result.text, 'utf8');
  const jsonBuf = Buffer.from(JSON.stringify(result, null, 2), 'utf8');

  const derivedFiles = [
    await upsertFile(txtName, txtBuf, 'text/plain', uploadedBy),
    await upsertFile(jsonName, jsonBuf, 'application/json', uploadedBy),
  ];

  return json({
    text: result.text,
    meta: result.meta,
    derivedFiles,
  });
};

async function upsertFile(name: string, buffer: Buffer, mimeType: string, uploadedBy: string | null) {
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, name));
  if (existing) {
    await saveBuffer(existing.diskPath, buffer);
    const [updated] = await db.update(workflowFiles)
      .set({ sizeBytes: buffer.byteLength, mimeType, updatedAt: new Date() })
      .where(eq(workflowFiles.id, existing.id))
      .returning();
    return summary(updated);
  }
  const diskPath = newDiskPath(name);
  await saveBuffer(diskPath, buffer);
  const [inserted] = await db.insert(workflowFiles).values({
    name,
    mimeType,
    sizeBytes: buffer.byteLength,
    diskPath,
    permissions: { read: true, write: true, append: false, delete: true },
    uploadedBy,
  }).returning();
  return summary(inserted);
}

function summary(row: typeof workflowFiles.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 2: Write the convert endpoint**

```ts
// src/routes/api/files/[id]/convert/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { synthesize, ExtractError, type SynthesizeFormat, type SynthesizeSource } from '$lib/jkai/extract';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, { status: 400 });
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, id));
  if (!row) return json({ error: 'file not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const source = body.source as SynthesizeSource;
  const format = body.format as SynthesizeFormat;
  const outputName = typeof body.outputName === 'string' ? body.outputName : null;
  const title = typeof body.title === 'string' ? body.title : undefined;
  if (!source || !format) return json({ error: 'source and format required' }, { status: 400 });

  const session = await locals.auth();
  const uploadedBy = session?.user?.email ?? row.uploadedBy ?? null;

  try {
    const buf = await readBuffer(row.diskPath);
    const content: string | Buffer = source === 'xlsx' ? buf : buf.toString('utf8');
    const result = await synthesize({ source, format, content, title });

    const name = outputName?.trim() || `${row.name}${result.suggestedExtension}`;
    const file = await upsertFile(name, result.buffer, result.mimeType, uploadedBy);
    return json({ file });
  } catch (err) {
    if (err instanceof ExtractError) {
      const status = err.code === 'E_INVALID_INPUT' || err.code === 'E_UNSUPPORTED_MIME' ? 415 : 500;
      return json({ error: err.message, code: err.code }, { status });
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
};

async function upsertFile(name: string, buffer: Buffer, mimeType: string, uploadedBy: string | null) {
  const cleanName = name.replace(/^\/+/, '').slice(0, 200);
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, cleanName));
  if (existing) {
    await saveBuffer(existing.diskPath, buffer);
    const [updated] = await db.update(workflowFiles)
      .set({ sizeBytes: buffer.byteLength, mimeType, updatedAt: new Date() })
      .where(eq(workflowFiles.id, existing.id))
      .returning();
    return summary(updated);
  }
  const diskPath = newDiskPath(cleanName);
  await saveBuffer(diskPath, buffer);
  const [inserted] = await db.insert(workflowFiles).values({
    name: cleanName,
    mimeType,
    sizeBytes: buffer.byteLength,
    diskPath,
    permissions: { read: true, write: true, append: false, delete: true },
    uploadedBy,
  }).returning();
  return summary(inserted);
}

function summary(row: typeof workflowFiles.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --threshold error 2>&1 | tail -10`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/files/[id]/extract/+server.ts src/routes/api/files/[id]/convert/+server.ts
git commit -m "feat(api): /api/files/[id]/extract and /convert endpoints"
```

---

### Task 13: admin/files UI — Extract + Convert buttons

**Files:**
- Modify: `src/routes/admin/files/+page.svelte`

- [ ] **Step 1: Read the current file**

```bash
cd ~/strange_rambling_svelte
wc -l src/routes/admin/files/+page.svelte
```

- [ ] **Step 2: Add Extract + Convert UI**

Open `src/routes/admin/files/+page.svelte` and:

1. Inside the `<script>` block, add helper state and two functions:

```ts
let busyId: string | null = $state(null);
let extractResult: { name: string; text: string; meta: unknown } | null = $state(null);
let convertModalFor: { id: string; name: string } | null = $state(null);
let convertSource: 'markdown' | 'text' | 'json' | 'csv' | 'xlsx' = $state('markdown');
let convertFormat: 'docx' | 'pdf' | 'html' | 'xlsx' | 'csv' = $state('pdf');

const EXTRACT_MIME_RE = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|text\/markdown|text\/plain|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|audio\/.+|video\/.+)$/;

function canExtract(mimeType: string, name: string): boolean {
  if (EXTRACT_MIME_RE.test(mimeType)) return true;
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.csv') || lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.xlsx');
}

async function runExtract(file: { id: string; name: string }) {
  busyId = file.id;
  extractResult = null;
  try {
    const res = await fetch(`/api/files/${file.id}/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!res.ok) {
      alert(`Extract failed: ${data.code ?? ''} ${data.error ?? 'unknown'}`);
      return;
    }
    extractResult = { name: file.name, text: data.text.slice(0, 5000), meta: data.meta };
    await invalidateAll();
  } finally {
    busyId = null;
  }
}

async function runConvert() {
  if (!convertModalFor) return;
  busyId = convertModalFor.id;
  try {
    const res = await fetch(`/api/files/${convertModalFor.id}/convert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: convertSource, format: convertFormat }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Convert failed: ${data.code ?? ''} ${data.error ?? 'unknown'}`);
      return;
    }
    convertModalFor = null;
    await invalidateAll();
  } finally {
    busyId = null;
  }
}
```

You may also need to add `import { invalidateAll } from '$app/navigation';` at the top if not already present.

2. Inside the per-file row template, add two buttons next to the existing actions (download/edit/delete). The buttons should appear as inline actions:

```svelte
{#if canExtract(file.mimeType, file.name)}
  <button class="row-link" disabled={busyId === file.id} onclick={() => runExtract(file)}>
    {busyId === file.id ? 'Extracting…' : 'Extract'}
  </button>
{/if}
<button class="row-link" disabled={busyId === file.id} onclick={() => (convertModalFor = { id: file.id, name: file.name })}>
  Convert
</button>
```

3. At the bottom of the template, add the result panel and convert modal:

```svelte
{#if extractResult}
  <section class="nm-sec" style="margin-top:1rem;">
    <h3>Extracted from {extractResult.name}</h3>
    <pre style="white-space:pre-wrap;max-height:280px;overflow:auto;">{extractResult.text}</pre>
    <details>
      <summary>Metadata</summary>
      <pre>{JSON.stringify(extractResult.meta, null, 2)}</pre>
    </details>
    <button class="nm-save-btn" onclick={() => (extractResult = null)}>Close</button>
  </section>
{/if}

{#if convertModalFor}
  <section class="nm-sec" style="margin-top:1rem;">
    <h3>Convert {convertModalFor.name}</h3>
    <label>From
      <select bind:value={convertSource} class="nm-text-input">
        <option value="markdown">Markdown</option>
        <option value="text">Plain text</option>
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
        <option value="xlsx">XLSX</option>
      </select>
    </label>
    <label>To
      <select bind:value={convertFormat} class="nm-text-input">
        <option value="docx">DOCX</option>
        <option value="pdf">PDF</option>
        <option value="html">HTML</option>
        <option value="xlsx">XLSX</option>
        <option value="csv">CSV</option>
      </select>
    </label>
    <div style="display:flex;gap:.5rem;margin-top:.75rem;">
      <button class="nm-save-btn" disabled={busyId === convertModalFor.id} onclick={runConvert}>
        {busyId === convertModalFor.id ? 'Converting…' : 'Convert'}
      </button>
      <button class="row-link" onclick={() => (convertModalFor = null)}>Cancel</button>
    </div>
  </section>
{/if}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --threshold error 2>&1 | tail -10`
Expected: 0 errors. Fix any inline.

- [ ] **Step 4: Manual smoke test**

```bash
cd ~/strange_rambling_svelte
npm run dev &
sleep 5
```

Visit `http://homeserv:5173/admin/files`. Upload a small `.md` file. Click Extract. Verify the result panel shows the text and a `<name>.extracted.txt` row appears. Then `kill %1` to stop.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/files/+page.svelte
git commit -m "feat(admin/files): Extract and Convert buttons + result panel"
```

---

### Task 14: Full build + typecheck

- [ ] **Step 1: Run all extract tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/extract/`
Expected: ALL PASS.

- [ ] **Step 2: Full svelte-check**

Run: `npx svelte-check --threshold error 2>&1 | tail -20`
Expected: 0 errors, 0 warnings (or only pre-existing warnings unrelated to this work).

- [ ] **Step 3: Production build**

Run: `npm run build 2>&1 | tail -30`
Expected: build succeeds.

- [ ] **Step 4: Commit any fixes**

If anything was changed:

```bash
git add -A
git commit -m "fix: address typecheck/build issues for file-extract"
```

---

### Task 15: Push + deploy

- [ ] **Step 1: Push**

```bash
cd ~/strange_rambling_svelte
git push
```

Expected: pushes successfully.

- [ ] **Step 2: Run deploy**

```bash
~/strange_rambling_svelte/scripts/deploy.sh
```

Expected: deploy completes; site reachable at `https://strangeramblings.com/admin/files`.

- [ ] **Step 3: VPS ffmpeg check**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'which ffmpeg || sudo apt install -y ffmpeg'
```

Expected: `ffmpeg` is on PATH on the VPS (install if missing).

- [ ] **Step 4: Smoke test in production**

Visit `https://strangeramblings.com/admin/files`, upload a small `.md` file, click Extract, confirm the result panel shows the text. Then upload a small PDF (or use the fixture) and confirm the same.

---

## Self-review

**Spec coverage:** Each spec section maps to a task —
- module layout → Tasks 2-10
- public API → Task 10
- node def + executor → Task 11
- admin/files endpoints → Task 12
- admin/files UI → Task 13
- error handling (`ExtractError` codes) → Task 2 + propagation in 11/12
- testing → Tasks 3-9 (per-module Vitest)
- migration/rollout (no DB) → Task 15
- ffmpeg system binary → Task 1 (verify) + Task 7

**Placeholder scan:** No "TBD"/"TODO"/"appropriate"/"similar to". All code is concrete and complete.

**Type consistency:** `ExtractResult`, `ExtractMeta`, `SynthesizeInput`, `SynthesizeResult`, `ExtractError` defined in Task 2, used unchanged in Tasks 3-12. `ExtractKind` and `kindFromMime` defined once in Task 2; consumed in Task 10. Source/format combinations in Task 10's `synthesize()` match the Task 11 node definition's enum values exactly.

**Notes:**
- Audio Whisper tests are not included as automated unit tests because they hit a real Whisper endpoint; they're verified via the production smoke test in Task 15.
- The video duration cap (30 min) and 50 MB byte cap are enforced in `extractText()` and `extractVideo()` and surface as `E_SOURCE_TOO_LARGE`.
