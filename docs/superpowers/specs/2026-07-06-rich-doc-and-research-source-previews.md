# Rich document + research-source previews (/drive · /jkai · @research)

**Date:** 2026-07-06
**Grade:** Full autonomous (kick-off: "autonomously improve …")
**Branch:** `feat/rich-doc-source-previews`

## Problem

Two preview surfaces render document/source content as **raw text** where a **rich
format** is expected:

1. **`/drive` + `/jkai` document previews** — the shared `FileViewerModal.svelte`
   renders `doc`-kind files (docx/doc, xlsx, pptx) by POSTing `/api/files/[id]/extract`
   and dumping the returned plain `text` into a `white-space: pre-wrap` block. Yet
   `docx.ts` **already computes `mammoth.convertToHtml`** and discards it; pptx/xlsx
   produce only flat tab-joined text. Result: a Word doc previews as an unstyled wall
   of text; a deck as a text blob; a spreadsheet as tab soup.

2. **`@research` sources** — `ResearchReferenceChips.svelte` renders each cited source
   as a bare external `<a>` link (opens a new tab / leaves the app). There is no
   in-app rich preview of the page the research actually read.

## Goal

- Word/PowerPoint/Excel previews render as **rich, formatted HTML** (headings, lists,
  tables, slide cards) in both `/drive` and `/jkai`.
- `@research` source chips open an **in-app rich reader modal** of the source material
  (the page's article content, formatted, with the cited passage highlighted and an
  "open original ↗" affordance).

## Precedents followed

- `FileViewerModal.svelte` — the modal shell, `.fv-prose` rich-markdown styling,
  reader/highlight logic, `portal`-to-body (SR modal-token guidance). The new
  research modal **mirrors** it.
- `FileReferenceChips.svelte` — `onOpen(ref)` button pattern (vs. the current
  research chip's bare `<a href>`).
- `docx.ts` already returns rich HTML via mammoth — we stop discarding it.
- `sanitize-chat.ts` — existing sanitiser; we add a **preview** profile that also
  allows `<img>` (mammoth inline images as `data:`), leaving the chat sanitiser
  untouched.

## Approach

### A. Rich document rendering (fixes /drive + /jkai)

- Add optional `html?: string` to `ExtractResult`.
- `docx.ts`: return the already-computed `mammoth.convertToHtml` value as `html`.
- `pptx.ts`: split runs per paragraph (`<a:p>`) instead of one blob; emit structured
  per-slide HTML (slide card: heading + bullet list + speaker notes).
- `spreadsheet.ts`: emit per-sheet `<table>` HTML (header row + body rows).
- `/api/files/[id]/extract`: pass `html` through in the JSON response; support a
  `{ preview: true }` body flag that **skips writing the `.extracted.txt/.json`
  derived files** (a plain preview should not litter the drive).
- `FileViewerModal.svelte`: for `doc` kind, when `html` is present and not in citation
  reader-mode, render sanitised `html` in a prose container (new `sanitizePreviewHtml`
  profile). Citation opens (with `highlight`) keep the reliable reader-text +
  passage-highlight, plus a one-click **Reader ⇄ Rich** toggle.

### B. Rich research-source reader (fixes @research)

- New read-only endpoint `GET /api/research/source/[id]` — owner-gated (the whole
  authed area is owner-only by default; research is private). Reconstructs the source
  text from `source_chunks` ordered by `chunkOrd`, returns
  `{ id, url, title, domain, sessionId, sessionTopic, text }`.
- New `ResearchSourceModal.svelte` — mirrors `FileViewerModal`: fetches the endpoint,
  renders the reconstructed material via `marked` + `sanitizePreviewHtml` as a rich
  reader, highlights the cited `passage`, shows a source header (title · domain ·
  score) and "open original ↗".
- `ResearchReferenceChips.svelte`: chip becomes an `onOpen(ref)` button (rich preview);
  keep a small external-link affordance. `ResearchRef` gains `sourceId`.
- `ChatArea.svelte`: wire `onOpen` → open `ResearchSourceModal`; add state; extend the
  persisted `ResearchSearchRef` shape with `sourceId`.
- `orchestrator/chat/+server.ts`: promote `sourceId` from the raw hit onto the ref.

## Files to touch

| File | Change |
|---|---|
| `src/lib/jkai/extract/types.ts` | add `html?: string` to `ExtractResult` |
| `src/lib/jkai/extract/docx.ts` | return `html` (mammoth, already computed) |
| `src/lib/jkai/extract/pptx.ts` | per-paragraph parse → structured slide HTML |
| `src/lib/jkai/extract/spreadsheet.ts` | per-sheet `<table>` HTML |
| `src/routes/api/files/[id]/extract/+server.ts` | return `html`; `preview` flag skips derived-file writes |
| `src/lib/security/sanitize-chat.ts` | add `sanitizePreviewHtml` (allows `<img>` + `data:`) |
| `src/lib/components/drive/FileViewerModal.svelte` | render rich `html` for docs; Reader⇄Rich toggle |
| `src/routes/api/research/source/[id]/+server.ts` | NEW — reconstruct source text (owner-gated) |
| `src/lib/components/jkai/ResearchSourceModal.svelte` | NEW — rich reader modal (mirrors FileViewerModal) |
| `src/lib/components/jkai/ResearchReferenceChips.svelte` | chip → `onOpen`; add `sourceId` |
| `src/lib/components/jkai/ChatArea.svelte` | wire research modal; `sourceId` on ref |
| `src/routes/api/workflows/orchestrator/chat/+server.ts` | promote `sourceId` onto research ref |

## Verification

- `npm run check` clean on touched files.
- Unit: extend `extract` tests — docx returns non-empty `html`; pptx `html` contains a
  slide card per slide; spreadsheet `html` contains a `<table>`.
- Live (post-deploy): upload a `.docx`/`.pptx`/`.xlsx` to `/drive`, open preview →
  formatted, not raw. In `/jkai`, an `@research` result → click a source chip → rich
  reader modal with highlighted passage + working "open original".

## Decision Log

1. **Reuse `/extract` (add `html`) vs. new preview endpoint.** → Reuse, adding `html`
   + a `preview` flag. Why: the modal already calls `/extract`; a second endpoint
   duplicates the extract dispatch. The `preview` flag fixes the pre-existing wart of
   preview writing derived files. Reversible (additive fields).
2. **Rich HTML source of truth for docs.** → mammoth HTML for docx (already computed);
   hand-built HTML for pptx/xlsx. Why: no new libs; mammoth is the existing precedent.
   `rtf/odt` have no rich path → fall back to text (logged, deferred). Reversible.
3. **Images in rich HTML.** → new `sanitizePreviewHtml` profile allows `<img>` with
   `data:`/http(s), rather than weakening the chat sanitiser. Why: preview is a
   controlled surface (user's own file); the chat sanitiser guards LLM output and must
   stay strict. Reversible (isolated profile).
4. **@research rich content = stored `source_chunks`, not live re-fetch.** → Reconstruct
   the stored material (offline, exact, always available) and render it as a reader.
   Why: the deep-research worker stores extracted page text (Tavily raw_content is
   markdown-ish → renders rich via `marked`); a live re-fetch adds latency + failure
   modes (paywalls, 404s, bot-blocks) for no richer *stored* HTML. "open original ↗"
   still reaches the live page. Reversible — a live-readability enhancement can layer
   on later.
5. **Citation (@files) doc opens: rich vs. highlight.** → Keep reliable reader-text +
   passage-highlight as default for citation opens; add a Reader⇄Rich toggle. Why:
   char-offset highlight needs plain text; a toggle gives rich without destabilising the
   well-tested citation flow. Non-citation opens (the /drive complaint) default to rich.
   Reversible.
6. **New research endpoint auth.** → Rely on the deny-by-default owner-only gate over
   the whole authed area (`/api/*`); no guest carve-out. Why: research is private;
   least privilege. Reversible.
