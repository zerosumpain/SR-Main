# Spec — Auto multimodal embedding of /drive files + `@files` semantic search in /jkai

**Status:** self-approved (autonomous Full-grade build, 2026-07-05)
**Kick-off:** "on /drive I want to embed every file on upload or edit … search images, audio, text … recall in /jkai by an @ command like `@files`."

## Goal

1. Every /drive file is embedded automatically on upload and on content edit, across
   modalities: text documents, **images** (visual content + OCR'd text), and **audio**
   (transcript). Deleting a file removes its embeddings.
2. In /jkai, an `@files` mention runs a semantic search over that content and returns a
   grounded, cited answer — e.g. *"find anything that refers to a blue shirt and glasses in @files"*
   matches an image of a person in a blue shirt and glasses, not just a filename.

## Precedents mirrored (no invention)

- **RAG pipeline** `src/lib/rag/` (chunk → embed → retrieve): chunking (`chunk.ts`) and the
  gateway embed shape (`embed.ts`) are reused. The new global store is a sibling module,
  not a modification of the shipped per-collection RAG.
- **Image → text**: `src/lib/jkai/intel/preprocess.ts:ocrHandwriting` (chat.completions
  `image_url` data-URL through `getLLMClient`).
- **Storage of embeddings in pgvector**: `intel_notes.embedding` / `intel_entities.embedding`
  (`vector(1536)` customType, SQL `<=>` cosine — `src/lib/jkai/intel/search.ts`).
- **Fire-and-forget post-write processing**: `src/lib/workflows/nodes/intel-write.ts`
  and the RAG `void buildCollection().catch()` pattern.
- **Site-tool for the orchestrator**: `src/lib/workflows/site-tools/tools/files.ts`
  (`file_list`/`file_read`), auto-exposed to Hermes via `src/lib/mcp/jsonrpc.ts` `tools/list`.
- **Composer affordance**: the `/` palette + `pinnedSkill` in `src/lib/components/jkai/ChatArea.svelte`.

## Decision Log

Every fork that would have been a question, resolved (reversible option preferred).

| # | Decision | Options considered | Why | Reversibility |
|---|---|---|---|---|
| D1 | **pgvector `file_embeddings` chunk table** as the global store | (A) pgvector table; (B) extend RAG Azure-NDJSON blob to a global index | Global/always-on/incremental needs per-file upsert+delete (one-row ops) and metadata-filtered query. NDJSON forces a full-blob rewrite per change and an O(N) in-memory rescan of the whole drive per query. Intel-recall reader's decisive recommendation. | High — retrieval isolated in `search.ts`; backend swappable |
| D2 | **`text-embedding-3-small` (1536-dim)**, pinned globally | 1536 small vs 3072 large | The repo's pgvector customType is hardcoded `vector(1536)` and pgvector's ANN cap is 2000-dim, so 3072 large can't be ANN-indexed. 1536 matches intel/deepdive, is ~6× cheaper (embed-on-every-upload; prefer-cheap feedback). Model+dim recorded per row. | High — re-embed corpus with a new customType later |
| D3 | **Multimodal**: image=caption+OCR, audio=best-effort transcript, video=deferred, text=existing `extractText` | full multimodal now vs staged | Image is the headline case (blue-shirt example) and low-risk (working `ocrHandwriting` precedent). Whisper `/audio/transcriptions` is unreachable through the z.ai/OpenRouter gateway, so audio uses an `input_audio` chat part (Gemini), best-effort, skip-on-failure. Video needs ffmpeg on host — deferred; files still store. | High — additive; audio/video are try/catch→skip |
| D4 | **New isolated `$lib/file-index/` module**; shipped per-collection RAG untouched | unify vs separate | De-risks a live feature; clean separation of "curated collection chat" vs "global @files search". Minor embedding redundancy accepted. | High — could unify later |
| D5 | **Content-hash-gated fire-and-forget** `indexFile(id)` from every byte-write site | sync vs async; where to hook | `indexFile` reads bytes, sha256, re-embeds only if hash changed → idempotent & safe to call anywhere. Metadata-only PATCH not hooked. Delete → FK cascade. Backfill endpoint covers pre-existing files + restart-loss. | High |
| D6 | **`file_search` site-tool** (not client-side injection) | tool vs pre-retrieval-inject | Prod runs the Hermes branch where SvelteKit does not inject context; a registered tool works on BOTH branches. Returns ranked raw hits; orchestrator composes the cited answer (one LLM turn, like `file_read`). | High |
| D7 | **`@files` → pin `jkai-files` skill** (already allowlisted) + `@` typeahead + Hermes skill mentions `file_search` | pin vs new flag vs client inject | Minimal, works on Hermes today; no server allowlist change. Typeahead cloned from `/` palette for discoverability. | High |
| D8 | **Single-owner scoping** | index all vs add owner column | `workflow_files` has no owner column; authed area is deny-by-default owner-only, so the whole drive is the owner's. | High — add owner column + filter later |
| D9 | **No ANN index initially** — exact SQL `<=>` scan | hnsw now vs later | Matches intel (no ANN index, works fine at this scale). Add hnsw if the corpus grows. | High |

## Files to touch (build order)

1. `src/lib/db/schema.ts` — add `contentHash` col to `workflowFiles`; add `fileEmbeddings` table + types. → `npx drizzle-kit push`.
2. `src/lib/file-index/hash.ts` — `sha256Hex(buf)`.
3. `src/lib/file-index/embed.ts` — pin `text-embedding-3-small`; `embedChunks`, `embedQuery` (reuse `normalize`).
4. `src/lib/file-index/describe.ts` — `describeImage(buf, mime)` (vision, pinned OpenRouter model, fallback→skip); `transcribeAudioBestEffort(buf, mime, name)`.
5. `src/lib/file-index/content.ts` — `fileToText(row, buf)`: kind dispatch → text | image caption | audio transcript | null.
6. `src/lib/file-index/store.ts` — `indexFile(id)`, `removeFile(id)`, `backfillMissing()`; hash-gate.
7. `src/lib/file-index/search.ts` — `searchFiles(query, opts)` → SQL `<=>` retrieval → ranked hits.
8. `src/lib/file-index/*.test.ts` — unit tests for hash, kind classification, chunk-gating (TDD for pure logic).
9. `src/lib/workflows/site-tools/tools/files.ts` — register `file_search`.
10. `src/lib/workflows/site-tools/registry.ts` — extend `files` toolset description.
11. `src/routes/api/files/upload/+server.ts` — `void indexFile(inserted.id)` after insert.
12. `src/routes/dav/[...path]/+server.ts` — `void indexFile(id)` after PUT byte write (update + insert branches).
13. `src/routes/api/files/[id]/convert/+server.ts` & `extract/+server.ts` — `void indexFile(id)` after `saveBuffer`.
14. `src/routes/api/files/index/backfill/+server.ts` (new) — owner-gated backfill trigger.
15. `src/lib/components/jkai/ChatArea.svelte` — `@files` detection in `send()` + `@` typeahead.
16. `~/.hermes-jkai/` `jkai-files` skill — mention `file_search` (cross-repo commit).

## Verification (stated before code)

- Typecheck: `NODE_OPTIONS=--max-old-space-size=8192 npm run check`.
- Unit: `npx vitest run src/lib/file-index`.
- Schema: `npx drizzle-kit push` succeeds; `file_embeddings` + `content_hash` present.
- Live (prod, after deploy):
  - Upload an image of a person in a blue shirt + glasses to /drive → `content_hash` set, `file_embeddings` rows appear.
  - POST `/api/files/index/backfill` embeds any remaining files.
  - In /jkai: "find anything referring to a blue shirt and glasses in @files" → orchestrator calls `file_search`, returns the image with a cited passage.

## Post-review fixes (adversarial review, 6 confirmed → all applied)

- **[HIGH] OOM cap** — `indexFile` now skips files > 25 MB (`MAX_INDEXABLE_BYTES`) before `readBuffer`, so a large WebDAV upload can't load multi-GB into RAM and OOM the 8 GB box.
- **[MED] Concurrency** — the delete/insert/hash-stamp runs under a per-file `pg_advisory_xact_lock` and re-verifies on-disk bytes inside the lock; out-of-order commits and the `unique(fileId,chunkOrd)` race are eliminated (a superseded racer declines).
- **[MED] WebDAV COPY** — file + folder COPY now fire `reindexFileInBackground` on each new row (were previously never indexed).
- **[LOW] No-text retirement** — files that pass the mime/size pre-check but yield no text now stamp `content_hash`, so they don't get re-read + re-sent to the vision/STT model on every backfill (bounds cost).
- **[LOW] Atomic upload 409** — the upload insert is wrapped: a concurrent same-name race returns a clean 409 and deletes the orphaned blob instead of a 500.
- **[LOW] Drift self-heal** — `POST /api/files/index/backfill?full=1` reconciles drift (re-hash every file, re-embed only changed), covering byte-writes made through paths that skip the hook.
- Plus a defensive NaN guard on `searchFiles` topK/minSim (false-positive in review, guarded anyway — free).

**Deferred (logged):** hooking the lower-traffic programmatic write sites (workflow `file-store`/`file-build`/`file-text-extract` nodes) — the `?full=1` reconcile covers these on demand. Video transcription (needs ffmpeg on host). Stale `file_embeddings.source` after a WebDAV MOVE rename (cosmetic; citation shows old name until content changes).
