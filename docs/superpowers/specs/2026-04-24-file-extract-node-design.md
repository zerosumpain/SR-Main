# File Extract / Synthesise Node — Design

**Date:** 2026-04-24
**Status:** Draft (awaiting user review)
**Scope:** New `file-extract` workflow node + admin/files integration for bidirectional text ↔ document conversion.

## Goal

Give workflows (and `/admin/files` users) a single node that can:

1. **Extract** text + structured metadata from uploaded artefacts: PDF, DOC, DOCX, Markdown, plain text, voice notes (audio), and videos (audio track only for v1).
2. **Synthesise** new artefacts from text/structured data: md → docx, md → pdf, md → html, text → pdf, json/csv → xlsx, csv ↔ xlsx, json → csv.

Today, `/admin/files` stores files but cannot read into them, and workflow nodes have no extraction path. Audio transcription (`transcribeAudio()`) and vision OCR (`ocrHandwriting()`) exist in `src/lib/jkai/intel/preprocess.ts` but are wired only into the intel ingest path. We reuse those primitives.

## Non-goals (v1)

- Visual analysis of video frames, scene detection, or slide extraction. Video → audio → transcript only.
- DOCX → PDF, HTML → PDF, PPTX synthesis, TTS. (Heavy deps; defer.)
- Streaming output. Extraction returns a single result blob; large jobs run synchronously inside the executor.
- Re-running extraction automatically when a file is re-uploaded. Extraction is explicit.
- OCR of scanned PDFs (image-only PDFs). Out of scope; user must provide text-bearing PDFs. Caller can run `ocrHandwriting()` separately on each page if needed in a future iteration.

## Architecture

### New module: `src/lib/jkai/extract/`

A pure module — no DB access, no permissions, no executor concerns. Takes buffers and mime types in; returns text/meta or buffers out. Reused by both the workflow node executor and the admin API endpoint.

```
src/lib/jkai/extract/
  index.ts            public API: extractText(), synthesize()
  types.ts            ExtractResult, SynthesizeInput, ExtractError, ExtractOptions
  pdf.ts              pdf-parse wrapper, returns per-page text
  docx.ts             mammoth wrapper (docx, doc best-effort)
  spreadsheet.ts      exceljs (read xlsx/csv → rows), and write xlsx/csv
  markdown.ts         marked → text strip; also marked → html
  text.ts             utf-8 / latin-1 text passthrough
  audio.ts            calls intel/preprocess.transcribeAudio (Whisper-1)
  video.ts            ffmpeg → wav → audio.ts; returns transcript + duration
  ffmpeg.ts           detect system binary, spawn-based wrapper
  synth-docx.ts       md → docx (via marked AST → docx package)
  synth-pdf.ts        md/text → pdf (pdfkit)
  synth-html.ts       md → html (marked, sanitised)
  synth-spreadsheet.ts json/csv → xlsx/csv (exceljs)
```

### Public API (`extract/index.ts`)

```ts
export type ExtractKind =
  | 'pdf' | 'docx' | 'doc' | 'markdown' | 'text'
  | 'audio' | 'video' | 'spreadsheet';

export interface ExtractResult {
  text: string;                    // canonical plain text, always populated
  meta: ExtractMeta;               // type-discriminated structured data
}

export type ExtractMeta =
  | { kind: 'pdf'; pageCount: number; pages: Array<{ index: number; text: string; error?: string }> }
  | { kind: 'docx'; headings: Array<{ level: number; text: string }>; warnings: string[] }
  | { kind: 'markdown'; headings: Array<{ level: number; text: string }> }
  | { kind: 'text'; encoding: 'utf-8' | 'latin-1' }
  | { kind: 'audio'; durationSec?: number; segments?: Array<{ start: number; end: number; text: string }>; language?: string }
  | { kind: 'video'; durationSec?: number; segments?: Array<{ start: number; end: number; text: string }>; language?: string }
  | { kind: 'spreadsheet'; sheets: Array<{ name: string; rowCount: number; columns: string[] }> };

export interface ExtractOptions {
  // PDF: 1-indexed page range; omit for all
  pages?: { from: number; to: number };
  // Audio/video: language hint passed to Whisper
  language?: string;
}

export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  options?: ExtractOptions,
): Promise<ExtractResult>;

export type SynthesizeFormat =
  | 'docx' | 'pdf' | 'html'           // from text/markdown
  | 'xlsx' | 'csv';                   // from json/csv

export interface SynthesizeInput {
  format: SynthesizeFormat;
  source: 'markdown' | 'text' | 'json' | 'csv' | 'xlsx';
  content: string | Buffer;           // Buffer for source=csv|xlsx, string for the rest
  // Optional knobs
  title?: string;                     // used as docx/pdf title
  sheetName?: string;                 // for xlsx output, default 'Sheet1'
}

// Valid (source → format) combinations:
//   markdown → docx | pdf | html
//   text     → pdf
//   json     → xlsx | csv
//   csv      → xlsx | csv (passthrough/normalise)
//   xlsx     → csv
// Any other combination throws E_INVALID_INPUT.

export interface SynthesizeResult {
  buffer: Buffer;
  mimeType: string;
  suggestedExtension: string;         // e.g. '.docx'
}

export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
```

Errors are thrown as `ExtractError` instances with a stable `code`:

```ts
export class ExtractError extends Error {
  constructor(public code: ExtractErrorCode, message: string, public cause?: unknown) { ... }
}

export type ExtractErrorCode =
  | 'E_UNSUPPORTED_MIME'      // mime → kind mapping has no entry
  | 'E_FFMPEG_MISSING'        // ffmpeg binary not found on PATH (video only)
  | 'E_PARSE_FAILED'          // underlying parser threw
  | 'E_TRANSCRIBE_FAILED'     // Whisper call failed
  | 'E_INVALID_INPUT'         // synthesize: source/format combination invalid
  | 'E_SOURCE_TOO_LARGE';     // > MAX_INPUT_BYTES (50 MB, matches upload limit)
```

PDF pages are best-effort: if a single page throws, its `pages[i].text` is empty and `pages[i].error` is set; `text` (concatenated) skips the failing page; the call still resolves.

### MIME → kind mapping

Centralised in `extract/types.ts`. Reuses entries from existing `src/lib/jkai/media/mime.ts` where they overlap. New mappings:

| MIME | kind |
|---|---|
| `application/pdf` | `pdf` |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `docx` |
| `application/msword` | `doc` |
| `text/markdown`, `text/x-markdown` | `markdown` |
| `text/plain`, `application/json`, `application/yaml`, `text/csv` | `text` |
| `audio/*` | `audio` |
| `video/*` | `video` |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel`, `text/csv` (when explicitly requested) | `spreadsheet` |

Filename extension is used as a tiebreaker when MIME is `application/octet-stream`.

### Workflow node: `file-extract`

Modelled on `file-store.def.ts`. Single config schema with a `mode` discriminator (`extract` | `synthesize`).

**Definition** (`src/lib/workflows/nodes/file-extract.def.ts`):

```ts
configSchema:
  mode: 'extract' | 'synthesize'
  // extract mode
  fileName?: string                        // resolved against workflow file store; templated
  pageFrom?: number, pageTo?: number       // PDF-only
  language?: string                        // audio/video
  // synthesize mode
  format?: SynthesizeFormat                // docx | pdf | html | xlsx | csv
  source?: 'markdown' | 'text' | 'json' | 'csv' | 'xlsx'
  contentPath?: string                     // dot-path into input; default 'input.content'
  title?: string
  // shared
  persist?: boolean                        // default false
  outputName?: string                      // required when persist=true
```

**Inputs:** `input` (any).
**Outputs:** `output` (object).

**Output shape (extract):**
```ts
{ text: string, meta: ExtractMeta, sourceFile: { id: string, name: string, mimeType: string } }
```

**Output shape (synthesize):**
```ts
{
  // always present
  base64: string, mimeType: string, sizeBytes: number, suggestedExtension: string,
  // present only when persist=true
  file?: { id: string, name: string }
}
```

The `base64` field on synthesis output keeps the artefact in-band so a downstream node (e.g. Gmail send) can attach it without a round-trip through storage.

### Executor: `src/lib/workflows/nodes/file-extract.ts`

Thin orchestration. Pseudocode:

```ts
export async function executeFileExtract(ctx: NodeContext): Promise<NodeOutput> {
  const cfg = resolveConfig(ctx);

  if (cfg.mode === 'extract') {
    const file = await loadWorkflowFile(cfg.fileName, ctx);   // permission: read
    const buffer = await storage.readBuffer(file);
    const result = await extractText(buffer, file.mimeType, file.name, {
      pages: cfg.pageFrom ? { from: cfg.pageFrom, to: cfg.pageTo ?? cfg.pageFrom } : undefined,
      language: cfg.language,
    });
    let persistedFile;
    if (cfg.persist) {
      persistedFile = await persistDerived(file, cfg.outputName, result, ctx);  // permission: write
    }
    return { output: { text: result.text, meta: result.meta, sourceFile: { id: file.id, name: file.name, mimeType: file.mimeType }, file: persistedFile } };
  }

  // synthesize
  const content = ctx.resolvePath(cfg.contentPath ?? 'input.content');
  const result = await synthesize({ format: cfg.format, source: cfg.source, content, title: cfg.title });
  let persistedFile;
  if (cfg.persist) {
    persistedFile = await createWorkflowFile(cfg.outputName, result.buffer, result.mimeType, ctx);
  }
  return { output: { base64: result.buffer.toString('base64'), mimeType: result.mimeType, sizeBytes: result.buffer.length, suggestedExtension: result.suggestedExtension, file: persistedFile } };
}
```

`loadWorkflowFile`, `persistDerived`, and `createWorkflowFile` reuse the existing helpers behind the `file-store` executor (refactor: extract them into a shared `workflows/files/store.ts` if they're currently inlined in `file-store.ts`). Permissions are enforced exactly as for `file-store`.

### Persisted derived file naming

For extract + `persist: true`:
- `<outputName>` if provided
- otherwise `<sourceName>.extracted.txt` (text) and `<sourceName>.extracted.json` (full result)

For synthesize + `persist: true`: `<outputName>` (required when persist=true; node throws `E_INVALID_INPUT` otherwise).

### admin/files integration

**API:** `POST /api/files/[id]/extract` — body `{}`. Loads the row, calls `extractText()`, persists `<name>.extracted.txt` and `<name>.extracted.json` as new `workflowFile` rows owned by the same user. Returns `{ text, meta, derivedFiles: [...] }`. Cloudflare Access protects the route exactly as the existing upload endpoint does.

**UI:** `src/routes/admin/files/+page.svelte` — add an "Extract" button per file row, visible only for supported MIME types (PDF, docx, doc, md, audio/*, video/*, plain text, spreadsheet). Clicking:

1. POSTs to the extract endpoint (with a spinner state on the row).
2. On success, refreshes the list (the derived files appear), and opens a results panel showing the first 5 KB of `text` and the `meta` summary.
3. On error, shows the error code + message on the row.

A second button — "Convert" — opens a small modal: pick target format + source format → POSTs to `POST /api/files/[id]/convert` (synthesis variant). Result becomes a new `workflowFile`. This mirrors the `synthesize` path of the node so the same code path is exercised.

### ffmpeg handling

- Detect at first use: `which ffmpeg` (cached). If missing, throw `E_FFMPEG_MISSING` with a message pointing at `apt install ffmpeg`.
- Run via `child_process.spawn` with explicit args; no shell. Input read from a temp file (system tmpdir), output written to another temp file, both deleted in `finally`.
- Conversion: `ffmpeg -i <in> -vn -ac 1 -ar 16000 -f wav <out>` — mono 16 kHz wav, the format Whisper prefers. Cap input duration at 30 minutes for v1 to bound cost and runtime; throw `E_SOURCE_TOO_LARGE` if exceeded (probe with `ffprobe -v quiet -show_entries format=duration ...`).

### Dependencies to add

| Package | Purpose | Notes |
|---|---|---|
| `pdf-parse` | PDF → text + page count | Pure JS, no native deps |
| `mammoth` | DOCX → text/html, DOC best-effort | Pure JS |
| `marked` | Markdown parsing (AST + html) | Pure JS |
| `docx` | DOCX synthesis from structured input | Pure JS |
| `pdfkit` | PDF synthesis from streams | Pure JS, ~1 MB |
| `exceljs` | XLSX read/write, CSV read/write | Pure JS |

System: `ffmpeg` + `ffprobe` binaries on `PATH`. Detected at runtime; missing binary surfaces `E_FFMPEG_MISSING`.

Whisper transcription and image OCR reuse existing `transcribeAudio()` / `ocrHandwriting()` from `src/lib/jkai/intel/preprocess.ts`. No new LLM client deps. (Note: `CLAUDE.md` references `$lib/vertex`; the actual runtime uses the Z.AI/OpenRouter client at `src/lib/jkai/llm-client.ts`. We follow the established pattern, not the doc.)

## Error handling

- All extract/synthesise errors throw `ExtractError(code, message, cause)`.
- Executor catches `ExtractError` and rethrows as a `NodeRunError` carrying `{ code, message }` so the run log shows a structured cause and the workflow's error branch (if any) receives it on its `error` port.
- Partial PDF success is treated as success (per-page errors live in `meta.pages[].error`).
- The admin/files endpoint maps `ExtractError` to HTTP 4xx (unsupported/invalid input) or 5xx (transcribe failed, ffmpeg missing) with the `code` in the body.

## Testing

Vitest unit tests per `extract/` module:

- `pdf.test.ts` — small fixture PDF, asserts page count and text presence; corrupt PDF asserts `E_PARSE_FAILED`.
- `docx.test.ts` — fixture docx with headings; assert `meta.headings` and text.
- `markdown.test.ts` — heading extraction and clean text strip.
- `spreadsheet.test.ts` — round-trip a small csv → xlsx → csv; assert row equality.
- `synth-docx.test.ts`, `synth-pdf.test.ts` — assert mime + non-empty buffer; opening shape (docx is a zip starting with `PK`, pdf starts with `%PDF`).
- `audio.test.ts`, `video.test.ts` — gated behind an env flag (`RUN_TRANSCRIBE_TESTS=1`); offline by default. ffmpeg presence check has its own unit test that mocks `which`.
- `ffmpeg.test.ts` — mocked spawn; asserts arg list and tmp file cleanup on both success and failure paths.

Executor integration test (`file-extract.test.ts`): runs a mock workflow, asserts permission failures throw, and that `persist: true` creates a new `workflowFile` row.

API endpoint test (`/api/files/[id]/extract`): supertest-style — supported MIME → 200 + derivedFiles; unsupported → 415; missing file → 404.

Fixtures live under `tests/fixtures/extract/`.

## Migration / rollout

No DB schema changes. New files only:

- `src/lib/jkai/extract/**`
- `src/lib/workflows/nodes/file-extract.def.ts` + `file-extract.ts`
- `src/routes/api/files/[id]/extract/+server.ts`
- `src/routes/api/files/[id]/convert/+server.ts`
- Modifications to `src/routes/admin/files/+page.svelte` for the new buttons.

Node registration: add `file-extract` to the workflow node registry alongside `file-store`.

Deploy: standard `scripts/deploy.sh`. Server needs `apt install ffmpeg` once if not present — flag in deploy notes.

## Open questions for review

1. Should the `convert` UI in admin/files be modal-based (as proposed) or a separate page (`/admin/files/convert`)? Modal feels lighter for a single-file action.
2. Hard cap on synthesis input size? Proposing 10 MB of input text for synthesis to bound memory; happy to revisit.
3. Should derived files (`<name>.extracted.txt`) be tagged in the DB so admin/files can visually group them under their source? Out of scope unless requested.

---

## Appendix A — File layout summary

```
src/lib/jkai/extract/                       (new module, ~10 files)
src/lib/workflows/nodes/file-extract.def.ts (new)
src/lib/workflows/nodes/file-extract.ts     (new)
src/lib/workflows/files/store.ts            (extracted helper, optional refactor)
src/routes/api/files/[id]/extract/+server.ts (new)
src/routes/api/files/[id]/convert/+server.ts (new)
src/routes/admin/files/+page.svelte         (Extract + Convert buttons)
tests/fixtures/extract/**                   (fixture files)
```
