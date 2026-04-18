# JKAI Multimedia I/O — Design

**Date:** 2026-04-18
**Status:** Design approved, pending implementation plan
**Scope:** Give `/jkai` the ability to accept multimedia inputs (files, images, audio, video, PDFs, documents) in both the web UI and WhatsApp channel, pass them to GLM-5 for native multimodal processing, and generate images / TTS audio / documents as replies via dedicated tools.

## Relationship to existing specs

- `2026-04-16-jkai-multimedia-tools-design.md` covers inline **rendered** artifacts (charts, maps, tables) that the LLM composes as chat responses. That work remains untouched. This spec adds a separate, complementary capability: raw file upload/download and raster/audio generation. A tool like `render_chart` produces a Vega-Lite artifact; a tool like `generate_image` produces an image file. Both render inline but go through different pipelines.

## Problem

Today `/jkai` is text-only. The chat endpoint accepts `message: string`. Users can't drop a photo in to ask "what's in this?", can't send a voice note on WhatsApp and have it interpreted, can't attach a log or PDF and ask for a summary, and the orchestrator can't produce images or spoken audio on request.

## Goals (v1)

- Accept images, audio, video, PDFs, documents, and plain-text/code files as chat attachments.
- Route them natively to GLM-5 (which handles all input modalities directly).
- WhatsApp-inbound media flows through the same pipeline: voice notes, photos, documents from WhatsApp are treated identically to web uploads.
- WhatsApp-outbound send gains image / audio / document capability so generated media can be delivered to WhatsApp users.
- Three new generation tools: `generate_image` (OpenRouter FLUX), `generate_audio_tts` (ElevenLabs), `write_document` (local file emission).
- Block-and-tell UX when the active model can't handle an attachment type.
- Unify `whatsappConversations` into `orchestratorChats` so there is one canonical message store.

## Non-goals (v1)

- Voice channel (push-to-talk, realtime voice). Deferred to a v2 spec.
- Video generation.
- Image editing / inpainting / variations.
- TTS voice cloning.
- Phone / PSTN channel.
- Automatic cleanup/pruning policy for conversation attachment footprint (manual prune tool only).
- Per-user quotas beyond the conversation-level guardrails below.

## Architecture

### Data model

New table `jkai_attachments`:

```sql
jkai_attachments (
  id              text PK (gen_random_uuid),
  conversation_id text FK → jkai_conversations.id ON DELETE CASCADE (nullable),
  message_id      text FK → orchestrator_chats.id ON DELETE SET NULL (nullable),
  source          text NOT NULL CHECK (source IN ('web','whatsapp','generated')),
  kind            text NOT NULL CHECK (kind IN ('image','audio','video','pdf','document','text')),
  mime_type       text NOT NULL,
  original_name   text,
  size_bytes      integer NOT NULL,
  disk_path       text NOT NULL,   -- relative to JKAI_MEDIA_ROOT, e.g. '2026/04/<uuid>.png'
  duration        real,             -- seconds, audio/video only
  metadata        jsonb,             -- EXIF, transcripts, gen params
  created_at      timestamptz NOT NULL DEFAULT now()
)

CREATE INDEX jkai_attachments_message_idx ON jkai_attachments(message_id);
CREATE INDEX jkai_attachments_conversation_idx ON jkai_attachments(conversation_id);
CREATE INDEX jkai_attachments_orphan_idx ON jkai_attachments(created_at) WHERE message_id IS NULL;
```

`orchestratorChats` and `jkai_conversations` are unchanged.

### WhatsApp unification (prerequisite refactor)

`whatsappConversations` is dropped. `orchestratorChats` becomes the single source of truth for every thread.

- Each WhatsApp phone number maps to exactly one `jkai_conversations` row with `source: 'whatsapp'`, `whatsapp_phone_number` set. Created on first inbound if absent.
- `orchestrator-bridge.ts` writes user + assistant messages directly to `orchestratorChats` with that `conversationId`.
- `loadConversationHistory(conversationId)` becomes a single query. The "merge WhatsApp + web" logic is deleted.
- `jkai_conversations.source = 'whatsapp-continuation'` is retained: clicking a WhatsApp thread in the sidebar opens the existing `source: 'whatsapp'` conversation directly (the continuation semantic is preserved; a second row is not created).

Migration script (run once, before deploy):

1. For each distinct `phone_number` in `whatsapp_conversations` without an existing `jkai_conversations` row, create one: `source: 'whatsapp'`, `whatsapp_phone_number: <number>`, `created_at: MIN(messages.created_at)`, `model_provider / model_id: <admin defaults>`.
2. For every row in `whatsapp_conversations`, insert a corresponding row into `orchestrator_chats` with the matched `conversation_id`, preserving `role`, `content`, `created_at`.
3. Drop the `whatsapp_conversations` table.
4. Remove WhatsApp-thread merge logic from `loadConversationHistory` and related call sites.

### Storage layout

Root: `~/.openclaw/jkai-media/` (overridable via `JKAI_MEDIA_ROOT`).

Layout: `<media_root>/<YYYY>/<MM>/<uuid>.<ext>` where `<ext>` is derived from the sniffed mime type. The original filename is stored only in the DB; disk names never use user-supplied strings.

Serving: `GET /api/jkai/attachments/[id]` — auth-gated (reuses existing `/jkai` route auth), streams bytes with the stored `mime_type` and `Content-Disposition: inline`. Used by both the web UI `<img>` / `<audio>` / `<video>` / download links and by the WhatsApp outbound send path when it needs to upload media back to WhatsApp.

Helper module `src/lib/jkai/media/storage.ts` exposes `saveBuffer(buf, ext) → { diskPath, sizeBytes }`, `readBuffer(diskPath) → Buffer`, `resolveAbsolutePath(diskPath) → string`, `deleteByDiskPath(diskPath) → void`.

### Ingest flows

**Web upload.** `POST /api/jkai/attachments` accepts a single-file multipart payload with form fields `conversationId` and the file. Server validates mime (sniffed server-side with `file-type`, never trust client header), validates size against per-kind limits, writes to disk, inserts a `jkai_attachments` row (`source: 'web'`, `message_id: NULL`), returns the full record. Client holds attachment IDs in composer state until send.

Voice-note recording uses the same endpoint. `MediaRecorder` captures Opus/WebM in the browser; the resulting blob is posted like any file. Hybrid UX:

- Short press-and-hold (< 300 ms before release): record-while-held, release auto-sends.
- Single tap: preview mode with waveform, stop, play, discard, send.

On chat send, `POST /api/workflows/orchestrator/chat` accepts `attachmentIds: string[]` alongside `message`. After the user message is inserted, the server runs `UPDATE jkai_attachments SET message_id = $new WHERE id = ANY($ids) AND message_id IS NULL`.

Discard before send: client calls `DELETE /api/jkai/attachments/[id]` → server deletes the row and the file.

Orphan sweep: a background job (hourly plus on-startup) deletes rows where `message_id IS NULL AND created_at < now() - interval '24h'`, unlinks their files. Catches abandoned uploads.

**WhatsApp inbound.** `WhatsAppInboundMessage` gains optional fields: `mediaType`, `mediaMimeType`, `mediaFilename`, `mediaBuffer`, `mediaDuration`. `service.ts` uses Baileys' `downloadMediaMessage` when a message contains `imageMessage` / `audioMessage` / `videoMessage` / `documentMessage`.

`orchestrator-bridge.ts`:

1. Resolves `conversationId` for the sender (find-or-create on the unified `jkai_conversations` table).
2. If media present: `saveBuffer(mediaBuffer, ext)` → insert `jkai_attachments` (`source: 'whatsapp'`, kind mapped from `mediaType`, `duration: mediaDuration`, `metadata: { whatsappMessageId }`, `message_id` set after the user message is inserted).
3. Insert user message to `orchestratorChats` with `content = text ?? placeholder` (placeholders: `[voice note]`, `[image]`, `[video]`, `[document: <filename>]`).
4. Call `generalChat` with the widened input.
5. Persist assistant reply, send outbound.

Download failure: insert user message with `[media download failed]` placeholder; no attachment row; reply with an apology and a retry suggestion.

### Chat-turn flow

`generalChat` signature widens from `generalChat(message: string, history, options)` to:

```ts
generalChat(
  input: { text: string; attachments?: AttachmentRef[] },
  history: Array<{ role: string; content: string; attachments?: AttachmentRef[] }>,
  options: ChatOptions,
)
```

`AttachmentRef` is the `jkai_attachments` row shape.

`loadConversationHistory` left-joins `jkai_attachments` on `message_id` and returns messages pre-shaped with attachments.

A new helper `buildMultimodalContent(text, attachments)` in `src/lib/jkai/media/multimodal.ts` constructs the OpenAI-compatible content-parts array GLM accepts:

```jsonc
{
  "role": "user",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } },
    { "type": "input_audio", "input_audio": { "data": "<b64>", "format": "ogg" } },
    { "type": "video_url",  "video_url":  { "url": "data:video/mp4;base64,..." } },
    { "type": "file",       "file": { "filename": "logs.pdf", "file_data": "data:application/pdf;base64,..." } }
  ]
}
```

Kind → part-type mapping:

| Kind | Part type | Notes |
|---|---|---|
| `image` | `image_url` | data URL |
| `audio` | `input_audio` | data URL, format from mime |
| `video` | `video_url` | data URL |
| `pdf` | `file` | data URL |
| `document`, `text` | `text` | inlined with a header framing: `\n\n--- File: <originalName> (<mime>, <N> chars) ---\n<contents>\n--- end ---\n` |

GLM-5 may prefer hosted URLs over base64 for large payloads. The implementation plan must verify this against current ZAI docs; if so, the helper emits `jkai-media://<id>` or the full `/api/jkai/attachments/[id]` URL for GLM to dereference through the auth-gated serve route.

Size guard: if the encoded payload exceeds `JKAI_MAX_TURN_BYTES` (default 100 MB), abort with a clear error before the API call.

History cap: `MAX_HISTORY = 30` remains. Attachments from older-than-cap messages are simply excluded from the GLM request.

### Generation tools

All three registered in `src/lib/workflows/site-tools/registry.ts` under a new `media` category. Each writes its output via `saveBuffer`, inserts a `jkai_attachments` row with `source: 'generated'` and `message_id` bound to the assistant turn, and returns `{ success: true, attachments: [AttachmentRef] }` to the LLM.

**`generate_image`**

- Params: `prompt: string`, `aspect_ratio?: '1:1'|'16:9'|'9:16'|'4:3'|'3:4'` (default `'1:1'`), `count?: number` (1–4, default 1).
- Backend: OpenRouter image endpoint. Default model `black-forest-labs/flux-1.1-pro`, overridable via `JKAI_IMAGE_MODEL`.
- Metadata: `{ prompt, model, aspectRatio }`.

**`generate_audio_tts`**

- Params: `text: string` (max 5000 chars), `voice?: string`, `model?: 'eleven_turbo_v2_5' | 'eleven_multilingual_v2'`.
- Defaults from env: `JKAI_TTS_VOICE`, `JKAI_TTS_MODEL` (fallback `eleven_turbo_v2_5`).
- Backend: ElevenLabs REST. New key `ELEVENLABS_API_KEY` added to the orchestrator's key store (same module as ZAI / OpenRouter keys).
- Output: MP3, `audio/mpeg`.
- Metadata: `{ text, voice, model, characters }`.

**`write_document`**

- Params: `filename: string` (sanitised: no path separators, length ≤ 255, extension from an allowlist), `content: string`, `format?: 'markdown'|'text'|'csv'|'json'|'code'` (inferred from extension if absent).
- Backend: none. Writes bytes to disk.
- Kind: `text` for plain text/markdown/code/csv/json; `document` for other allowlisted types.
- Metadata: `{ format }`.

`data/prompts/02-capabilities.md` and `data/prompts/03-tools.md` gain a "Creating media" section covering when to use each tool and example prompts. `keyword-classifier.ts` gets a `media` toolset with triggers: `image`, `photo`, `draw`, `render`, `picture`, `audio`, `voice`, `speak`, `say out loud`, `read this`, `document`, `report`, `csv`, `save as`, `export`.

### Model compatibility gate

New module `src/lib/server/models/capabilities.ts`:

```ts
export interface ModelCapabilities {
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
  documentText: boolean;  // always true — inlined as text
}
export function getModelCapabilities(ctx: ModelContext): ModelCapabilities;
```

Lookup table for known ZAI GLM models (vision models: image only; GLM-5: all true) and curated OpenRouter models. Unknown models default to `{ documentText: true, others: false }` — conservative.

- `GET /api/jkai/conversations/[id]` response gains `modelCapabilities`.
- Model-picker list endpoints return capabilities per option.

Client enforcement in `ChatArea.svelte`:

- Paperclip `accept` attribute is built from capabilities.
- Drag/paste of unsupported types → toast with a **Change model** action.
- Switching model while attachments are queued → chip red border + tooltip; Send disabled until resolved.

Server enforcement (defence in depth): chat endpoint rejects the turn with 400 if any `attachmentIds[i]`'s kind exceeds the selected model's capabilities.

History-on-switch: when the pinned model changes mid-conversation, history attachments the new model can't process are silently dropped from GLM requests but remain visible in the UI. The system prompt injects a note: *"Earlier messages in this conversation contained attachments of type X that the current model cannot process."*

### WhatsApp outbound

`service.ts` gains three methods:

- `sendImage(to, diskPath, mime, caption?)`.
- `sendAudio(to, diskPath, mime)` — sent as voice note (`ptt: true`) for `audio/ogg` / `audio/mpeg` / `audio/opus`.
- `sendDocument(to, diskPath, mime, filename, caption?)`.

`OrchestratorBridge` after `generalChat`:

- Text-only assistant reply → `sendMessage`.
- Reply with generated attachments: send text as caption on the first image/document when possible; audio is always its own message (WhatsApp does not support audio captions); remaining attachments follow as separate messages.

Outbound size ceiling matches WhatsApp's published limits. Over-sized items fall back to "I generated X, view it here: <url>" pointing at the `/api/jkai/attachments/[id]` URL (wrapped through the public site if an authenticated share URL exists by then — see Open questions).

Outbound send failure: retry once, then fall back to text-only with the share URL.

### Web UI

Composer changes in `ChatArea.svelte`:

- Paperclip button (left of textarea) opens file picker with `accept` from model capabilities.
- Drag-drop overlay on the chat panel ("Drop files to attach").
- Paste handler: clipboard images become attachments; clipboard text stays in the textarea.
- Mic button (right, next to Send). Hybrid UX described above.
- Attachment tray above the textarea: horizontal chips with thumbnail/icon, filename, size, remove-×, upload progress overlay.

Rendering changes — new component `src/lib/components/jkai/MessageAttachments.svelte`:

- Image → thumbnail up to 300×300, click → lightbox.
- Audio → `<audio controls>` with filename + duration.
- Video → `<video controls>`.
- PDF / document → filename chip with kind icon, size, download, "preview" toggle expanding to first ~2000 chars for text/code/markdown (code styling if `format = 'code'`).

Tool-generated attachments get a subtle "generated" label so they're distinguishable from attachments the model was shown.

Mobile: paperclip + mic always visible; attachment tray scrolls horizontally; lightbox is fullscreen; drag-drop overlay is desktop-only.

### Guardrails

Per-file hard limits (web upload; WhatsApp-inbound bypasses these but is still capped at 200 MB):

| Kind | Limit |
|---|---|
| Image | 15 MB |
| Audio | 50 MB |
| Video | 200 MB |
| PDF | 25 MB |
| Document / text / code | 2 MB |

Override via `JKAI_MEDIA_MAX_BYTES` and per-kind `JKAI_MEDIA_MAX_<KIND>_BYTES`.

Per-turn: max 10 attachments per user message; encoded payload cap `JKAI_MAX_TURN_BYTES` (100 MB default).

Per-conversation: soft cap 2 GB of attachments; a manual `pruneOldAttachments` tool exists in v1, automatic policy deferred.

Generation rate limits (env-overridable):

- `generate_image`: max 4 images per tool call, max 20 per conversation per 24h.
- `generate_audio_tts`: max 5000 chars per call, max 50 000 chars per conversation per 24h.

Cost tracking: both tools record to `recordConversationUsage`. `PriceSnapshot` is extended to cover image-generation ($/image) and TTS ($/char) units.

Validation:

- Mime sniffed server-side with `file-type`; client-declared mime ignored.
- Extension normalised from sniffed mime.
- Reject files where sniffed kind contradicts declared intent.
- `original_name` sanitised (strip path chars, cap at 255).

Observability:

- Generation tool results include `attachmentIds` in tool-call logs.
- Upload rejections logged with reason codes: `too_large`, `wrong_mime`, `over_rate_limit`, `unsupported_kind_for_model`.

## Components summary

| Component | Role |
|---|---|
| `jkai_attachments` (table) | Canonical record for every uploaded / received / generated file. |
| `src/lib/jkai/media/storage.ts` | Disk read/write helper; no DB. |
| `src/lib/jkai/media/multimodal.ts` | Builds GLM content-parts from text + attachments. |
| `src/lib/server/models/capabilities.ts` | Declares and looks up per-model modality support. |
| `src/routes/api/jkai/attachments/+server.ts` | `POST` upload, `GET` list, `DELETE` cleanup. |
| `src/routes/api/jkai/attachments/[id]/+server.ts` | `GET` stream, `DELETE` single. |
| `src/routes/api/workflows/orchestrator/chat/+server.ts` | Extended to accept `attachmentIds`. |
| `src/lib/workflows/chat/general-chat.ts` | Widened signature; calls `buildMultimodalContent`. |
| `src/lib/workflows/chat/conversation-history.ts` | Joins attachments onto history rows. |
| `src/lib/workflows/whatsapp/service.ts` | Adds `sendImage` / `sendAudio` / `sendDocument`; widened inbound type. |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Routes inbound media through the unified pipeline; uses unified `orchestratorChats`. |
| `src/lib/workflows/whatsapp/types.ts` | Widened `WhatsAppInboundMessage`. |
| `src/lib/workflows/site-tools/registry.ts` | Registers `generate_image`, `generate_audio_tts`, `write_document` in the new `media` category. |
| `src/lib/workflows/site-tools/keyword-classifier.ts` | Adds `media` toolset triggers. |
| `src/lib/components/jkai/ChatArea.svelte` | Adds paperclip, drag-drop, paste, mic, attachment tray; capability-aware blocking. |
| `src/lib/components/jkai/MessageAttachments.svelte` | New; renders attachments in messages. |
| `scripts/migrations/unify-whatsapp.ts` | One-shot data migration. |

## Build sequence (for the implementation plan)

1. Schema + migration: `jkai_attachments` table, unify `whatsappConversations` into `orchestratorChats`, drop old table.
2. Storage helper (`media/storage.ts`), media serve route, capabilities module.
3. Upload endpoint + orphan sweep; wire `attachmentIds` through chat endpoint (text + attachments → `generalChat`).
4. `buildMultimodalContent` helper; `generalChat` widened; history-with-attachments loader.
5. Generation tools: `write_document` (simplest, no external API), then `generate_image` (OpenRouter), then `generate_audio_tts` (ElevenLabs + key wiring).
6. WhatsApp inbound media: widen types, `downloadMediaMessage` call, bridge refactor to the unified message store.
7. WhatsApp outbound media: `sendImage` / `sendAudio` / `sendDocument`; bridge emits media when the assistant turn has generated attachments.
8. Web UI: composer changes, attachment tray, mic recorder, `MessageAttachments.svelte`.
9. Model capability gate: client accept-attr, drag/paste blocking, server 400 rejection.
10. Guardrails: size limits, per-conversation quotas, rate limits, telemetry, price snapshot extension.

## Testing approach

- Unit: storage helper (happy path, path-traversal attempts), mime sniffing, multimodal content builder (each kind), capability lookup, rate-limit logic.
- Integration: upload → send → GLM request → assistant reply end-to-end (with GLM mocked at the HTTP boundary); WhatsApp inbound media mocked from Baileys; WhatsApp outbound media with mocked `sock.sendMessage`.
- Migration dry-run verified against a prod DB snapshot before deploy.
- Manual QA pass per modality: jpeg, png, webp, mp3, opus, mp4, webm, pdf, txt, md, csv, ts.
- Each generation tool hit once with live API during staging.

## Open questions (to resolve in the implementation plan)

- Exact ZAI multimodal content-part names and whether data URLs or hosted URLs are preferred for large payloads. The spec assumes data URLs; verify and switch to `/api/jkai/attachments/[id]` references if that's what GLM expects.
- Whether `black-forest-labs/flux-1.1-pro` is the right default OpenRouter image model (check current pricing and quality). Fallback candidates: `stability-ai/stable-diffusion-3-large`, `black-forest-labs/flux-schnell` for budget.
- Exact ElevenLabs voice IDs to ship as defaults. Best to let John pick one voice ID and store it in env.
- Public share URL for WhatsApp oversize fallback: is there an existing auth'd share endpoint, or should the implementation plan add one (e.g. signed token URLs)?
- Baileys media download timeout tuning — whether to retry, and how long to wait before inserting the `[media download failed]` placeholder.

## Future work (out of this spec)

- Voice channel v2: push-to-talk in the web UI; realtime voice (speech-to-speech) — a separate spec will decide between OpenAI Realtime, Gemini Live, or a local STT + TTS turn-taking shim.
- Video generation (Veo / Runway / Replicate).
- Image editing / inpainting.
- Automatic attachment pruning policy for long-lived conversations.
- Per-user quotas if `/jkai` ever grows multi-user.
- Transcript caching: store Whisper transcripts on audio attachments when GLM can't process the audio natively (relevant if another non-multimodal model becomes primary).
