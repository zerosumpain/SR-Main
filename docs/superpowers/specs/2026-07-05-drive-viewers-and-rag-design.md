# Drive — default file viewers + redesign + "Interact using model" RAG

**Date:** 2026-07-05  ·  **Branch:** `feat/drive-rag-viewers`  ·  **Grade:** Full autonomous
**Kick-off:** "default renderer on double-click for images/xml/json/doc/others; proper OSS code renderer; redesign the page, remove mounting + guidance, add onboarding + live search filter; new capability: select files → 'interact using model' → RAG-index with a quality OpenRouter embedding model → chat via the jkai interface; persistent index on a lightweight/free Azure service. Do this autonomously."

## Goals

1. **Default viewers** — double-click any file in `/drive` opens an in-app viewer modal. Images, video, audio, PDF, Markdown, and code/JSON/XML/CSV/plain-text all render with a proper renderer (Shiki for code, `marked` for markdown, `mammoth` for Word docs). No more "download to see it".
2. **Redesign** — strip the WebDAV *mounting* UI + guidance from the page, add a friendly onboarding block that explains what Drive does, and add a **live search filter** that filters files/folders as you type.
3. **RAG** — select ≥1 files → **Interact using model**: build a persistent vector index (quality OpenRouter embedding model) stored on Azure Blob, then chat over just those files in a jkai-styled chat with cited answers.

## Precedent inventory (copy shapes, don't invent)

| Need | Precedent to copy |
|---|---|
| Code/JSON/XML render | `src/lib/canvas/nodes/ShikiCodeBlock.svelte` (Shiki, light+dark, collapse/copy) |
| Markdown render | `src/lib/components/jkai/ChatMessage.svelte` (`marked` + `sanitizeChatHtml`) |
| Word (.doc/.docx) → HTML | `mammoth` (already a dep; used in `$lib/jkai/extract/docx.ts`) |
| Chat bubble + streaming feel | `ChatMessage.svelte` presentation |
| Streaming completion (SSE) | `$lib/deepdive/ai.ts` → `streamCompletion` (z.ai→OpenRouter fallback, idle watchdog, `disableThinking`) |
| Embeddings | `$lib/jkai/intel/embed.ts` pattern → `getLLMClient({provider:'openrouter', modelId})` + `client.embeddings.create` |
| Retrieval→context block | `$lib/jkai/intel/context.ts` `formatContext` (labelled block, threshold, `''` when empty) |
| Byte read by file id | `$lib/file-store/storage.ts` `readBuffer(row.diskPath)` (fs↔Azure auto-dispatch) |
| Text extraction | `$lib/jkai/extract` `extractText(buf, mime, name)` (pdf/docx/md/text/csv/xlsx) + `kindFromMime` gate |
| Enumerate files by id | `download-zip/+server.ts` → `inArray(workflowFiles.id, ids)` |
| Owner-gated `/api/*` | automatic via `hooks.server.ts` (keep out of every bypass list) |
| New table (owner=email, uuid id, jsonb, tz ts) | `workflowFiles` (schema.ts:1487) + `intelNotes` |
| Blob index persistence | `file-store/storage.ts` under a `rag-index/` prefix (Azure 'drive' container, Cool/LRS — already provisioned) |

## Data model (additive; drizzle-kit push is safe — CREATE TABLE only)

Add to `src/lib/db/schema.ts` (near intel tables). **No `vector` column** — heavy vectors live in the blob, so push never touches the pgvector extension.

```ts
export const ragCollections = pgTable('rag_collections', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull(),
  owner: text('owner').notNull(),                       // email
  status: text('status').notNull().default('pending'), // pending|indexing|ready|error
  embeddingModel: text('embedding_model').notNull(),
  embeddingDim: integer('embedding_dim').notNull().default(0),
  fileIds: jsonb('file_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  fileNames: jsonb('file_names').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  chunkCount: integer('chunk_count').notNull().default(0),
  indexBlobKey: text('index_blob_key'),                // rag-index/<id>.ndjson
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerIdx: index('rag_collections_owner_idx').on(t.owner) }));

export const ragMessages = pgTable('rag_messages', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  collectionId: text('collection_id').notNull().references(() => ragCollections.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),                         // user|assistant
  content: text('content').notNull(),
  citations: jsonb('citations').$type<Array<{ n: number; source: string; ord: number }>>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byCollection: index('rag_messages_collection_idx').on(t.collectionId) }));
```

## RAG engine — new `src/lib/rag/` (all fresh; no chunker exists to reuse)

- `types.ts` — `RagChunk = { id, text, vector:number[], source:string, ord:number, charStart, charEnd }`; `RagIndex = { collection, model, dim, count, normalized:true, chunks:RagChunk[] }`; config consts.
- `chunk.ts` — `chunkText(text, {chunkChars=1000, overlapChars=150})`: split on paragraph → sentence boundaries, ~1000 chars with 150 overlap. **Pure → TDD.**
- `embed.ts` — `EMBEDDING_MODEL='openai/text-embedding-3-large'` (verified 3072-dim on OpenRouter 2026-07-05), fallback `'openai/text-embedding-3-small'`. `embedBatch(texts)` via `getLLMClient({provider:'openrouter', modelId})` `client.embeddings.create({input:[...]})`; unit-normalize each vector at write time (query becomes a dot product).
- `index-store.ts` — `saveIndex/readIndex/deleteIndex(collectionId)` = NDJSON buffer via `file-store/storage.ts` (`saveBuffer/readBuffer/deleteFile`) at `join(storeRoot(),'rag-index',`${id}.ndjson`)`. fs↔Azure auto-dispatch, so persistent + free on the existing 'drive' Cool/LRS container.
- `retrieve.ts` — `retrieve(index, queryVector, {topK=10, minSim=0.2})`: dot-product rank, threshold, return top chunks; `buildContextBlock(chunks)` → labelled `--- Documents ---` block with `[n]` markers + a source map (mirrors `context.ts formatContext`, `''` when empty).
- `pipeline.ts` — `buildCollection(collectionId)`: load rows via `inArray`, `readBuffer`→`extractText` (gate on `kindFromMime`, skip audio/video + ENOENT), chunk, embed in batches, `saveIndex`, update row status/chunkCount. `answer(collectionId, question, {onToken})`: read index → embed query → retrieve → `streamCompletion(systemPrompt, question, {disableThinking:true, maxTokens:3000, onToken})` with a "answer only from the context, cite [n]" system prompt; return `{text, citations}`.

## API — new `src/routes/api/files/rag/` (owner-gated automatically)

- `POST /api/files/rag` `{fileIds:string[], name?}` → create `ragCollections` row (owner=session email), kick off `buildCollection` (await; sets status ready/error), return the row.
- `GET /api/files/rag` → list caller's collections (for the Drive "Knowledge bases" section).
- `GET /api/files/rag/[id]` → collection + persisted `ragMessages`.
- `DELETE /api/files/rag/[id]` → delete blob + row (cascade messages).
- `POST /api/files/rag/[id]/reindex` → rebuild index (re-reads current file bytes).
- `GET /api/files/rag/[id]/chat?q=...` → **SSE**: persist the user turn, stream `token{delta}` events from `answer(...)`, persist the assistant turn + citations on `done{citations}`. Mirror the intel/deepdive SSE event vocabulary (`connected|token|done|error`).

## UI

- **`src/lib/components/drive/FileViewerModal.svelte`** (new) — portal-to-body OPAQUE modal (per modal-tokens rule; local append/remove action, not the shared portal). Branches by mime/extension: image (`<img>` + zoom), video (`<video>`), audio (`<audio>`), pdf (`<iframe>`/`<object>` on `/api/files/[id]/download?inline=1`), markdown (`marked`+sanitize), docx/doc (fetch bytes → `mammoth` client-side? no — server: reuse `/api/files/[id]/extract` then render), code/json/xml/csv/text (fetch text → `ShikiCodeBlock`, lang from extension; pretty-print JSON). Footer: Download + (if eligible) Extract/Convert reuse.
- **`src/lib/components/drive/RagChatPanel.svelte`** (new) — slide-over on `/drive`; header (collection name, file chips, model), scrollable transcript rendered with the `ChatMessage` markdown pattern (`marked`+`sanitizeChatHtml`), citation chips linking back to source files, composer that opens an `EventSource` to the chat SSE and appends streamed tokens. Reuses SR tokens; no new fonts/colours.
- **`src/lib/components/drive/InteractModelModal.svelte`** (new) — appears on "Interact using model": shows selected file names, name field (auto-filled), the embedding model, a "Build index" button → `POST /api/files/rag`, progress, then opens `RagChatPanel`.
- **`src/routes/drive/+page.svelte`** (edit) —
  - **Remove WebDAV** in all 4 places: script state 108-120 + fns 471-511; markup section 862-987; CSS 1675-1832; keep shared `.form/.row/.field`.
  - **Search filter**: `let query=$state('')`; a `.nm-text-input` in `.select-bar`; filter the `visibleFiles`/`subfolders` derivations (case-insensitive on name).
  - **Onboarding**: a dismissible `.nm-sec` intro block (localStorage `drive:onboarded`) — 3–4 mono bullets (drop to upload · double-click to preview · select + Interact using model · search to filter), modelled on `.empty`/`.dav-howto`.
  - **Double-click**: `ondblclick` on grid tile + list row → open `FileViewerModal` for that file.
  - **Interact button**: in the active-selection cluster (704-720) after Download → opens `InteractModelModal` with `selectedFiles`.
  - **Knowledge bases section**: a `.nm-sec` listing existing collections (from a new server-load query or `GET /api/files/rag`) — open chat / re-index / delete.
- **`src/routes/drive/+page.server.ts`** (edit) — drop `webdavCredentials` import + query; add `ragCollections` list for the owner.

## Verification (state before building)

- **Chunker**: `npx vitest run tests/lib/rag/chunk.test.ts` — boundaries, overlap, no-loss, tiny/huge inputs.
- **Retrieve**: `npx vitest run tests/lib/rag/retrieve.test.ts` — ranking, threshold, empty→`''`.
- **Type**: `NODE_OPTIONS=--max-old-space-size=8192 npm run check` clean.
- **End-to-end (local prod build)**: `PORT=4183 node --env-file=.env build/index.js`; owner-session curl: `POST /api/files/rag` with 2 file ids → status `ready`, `chunkCount>0`, blob written; `GET .../chat?q=...` SSE emits `token` then `done`; answer references file content.
- **Viewer**: load `/drive`, double-click a `.json`/`.md`/image → modal renders (Playwright screenshot).
- **Live**: after deploy, `.deploy-sha` matches HEAD; `curl https://strangeramblings.com/drive` (owner) shows the new onboarding string + no WebDAV mount copy; grep the built page/bundle for a unique new class (`rag-interact-btn`).

## Decision Log

1. **Chat host: dedicated RAG chat vs reuse `/jkai` orchestrator.** Options: (a) reuse `/jkai` ChatArea + generalChat `intelContextOverride`; (b) new self-contained RAG chat on `streamCompletion`. **Chose (b).** Why: the live `/jkai` send path is **Hermes** (`JKAI_HERMES_CANVAS_CHAT=1`) with no in-repo injection seam — deterministic context injection only exists in the *legacy* `generalChat`, and forcing it would mean editing the production orchestrator endpoint (regression risk to the primary chat) or cross-repo Hermes work. (b) is deterministic, self-contained, reuses the jkai *look* (`ChatMessage`) + the blessed `deepdive/ai.ts` wrapper, and touches nothing on the prod chat path. Reversible: pure addition.
2. **Index storage: Azure Blob (path-prefix in 'drive' container) vs new 'rag' container vs pgvector.** **Chose Azure Blob via `file-store/storage.ts` under `rag-index/`.** Why: pgvector's Drizzle type is globally pinned to `vector(1536)` → a quality 3072-dim model has no DB home; the user explicitly asked for a lightweight/free Azure service; the 'drive' container (Cool/LRS) is already provisioned and the storage seam already fs↔Azure-dispatches (free local dev). Prefix over a new Terraform container = zero infra change, more reversible (Azure has no per-container cost; add a container later if isolation is wanted). Reversible.
3. **Embedding model.** **Chose `openai/text-embedding-3-large` (3072-dim), fallback `-3-small`.** Why: user asked to bias quality; empirically verified OpenRouter serves it (2026-07-05, dim=3072). Blob index is dimension-agnostic so no schema impact. Model+dim stored per-collection so retrieval matches. Reversible.
4. **Remove mounting = strip UI only, keep backend.** **Chose:** delete the WebDAV *mounting* UI + guidance from `/drive`; leave the `/dav/` endpoint + `webdav_credentials` table intact. Why: "remove the mounting functionality and guidance" targets the page; ripping out the documented WebDAV backend + table is destructive and out of scope. Reversible (re-add UI later; existing mounts keep working).
5. **Generation model.** Reuse `streamCompletion` default (z.ai glm-5.1 → OpenRouter fallback) with `disableThinking:true`, `maxTokens 3000` (per `feedback_glm_reasoning_tokens.md`). Reversible.
6. **Transcript persistence.** New `rag_messages` table, not `jkai_conversations`/`orchestrator_chats`. Why: keeps RAG self-contained + out of jkai cost metrics; simpler. Trade-off: no jkai cost accounting for RAG turns (acceptable — separate feature). Reversible.
7. **Chunking params (no precedent).** ~1000 chars, 150 overlap, paragraph→sentence split; topK 10, minSim 0.2. Tunable consts. Reversible.
