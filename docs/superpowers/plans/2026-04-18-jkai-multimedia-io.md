# JKAI Multimedia I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/jkai` to accept, process, and generate multimedia (images, audio, video, PDFs, documents) across the web UI and WhatsApp channel, routing inputs natively to GLM-5 and exposing generation via three tools (`write_document`, `generate_image`, `generate_audio_tts`).

**Architecture:** A new `jkai_attachments` table holds every file regardless of origin (web / whatsapp / generated). Files live on local disk under `~/.openclaw/jkai-media/<YYYY>/<MM>/<uuid>.<ext>` and are served via an auth-gated `/api/jkai/attachments/[id]` route. The chat endpoint accepts `attachmentIds[]`; `generalChat` builds OpenAI-compatible multimodal content parts for GLM. Generation tools write output via the same storage helper and return attachment refs the UI renders inline. WhatsApp is unified by dropping `whatsappConversations` and routing all threads through `orchestratorChats`.

**Tech Stack:** SvelteKit 2 / Svelte 5, Drizzle ORM (PostgreSQL), Vitest, Baileys (WhatsApp), OpenAI-compatible SDK (ZAI GLM + OpenRouter), ElevenLabs REST, `file-type` for mime sniffing.

**Spec:** `docs/superpowers/specs/2026-04-18-jkai-multimedia-io-design.md`

---

## File Structure

**New files (source):**

- `src/lib/jkai/media/storage.ts` — disk read/write/delete, path derivation.
- `src/lib/jkai/media/multimodal.ts` — builds GLM content parts from text + attachments.
- `src/lib/jkai/media/mime.ts` — mime-to-kind mapping, extension inference.
- `src/lib/jkai/media/rate-limits.ts` — generation quota checks.
- `src/lib/jkai/media/sweep.ts` — orphan attachment cleanup.
- `src/lib/server/models/capabilities.ts` — per-model modality support.
- `src/routes/api/jkai/attachments/+server.ts` — `POST` upload.
- `src/routes/api/jkai/attachments/[id]/+server.ts` — `GET` stream, `DELETE` single.
- `src/lib/workflows/site-tools/tools/media-write-document.ts` — `write_document` handler.
- `src/lib/workflows/site-tools/tools/media-generate-image.ts` — `generate_image` handler.
- `src/lib/workflows/site-tools/tools/media-generate-audio-tts.ts` — `generate_audio_tts` handler.
- `src/lib/components/jkai/MessageAttachments.svelte` — renders attachments in messages.
- `src/lib/components/jkai/ComposerAttachmentTray.svelte` — chips above the textarea.
- `src/lib/components/jkai/VoiceRecorder.svelte` — mic recording UX.
- `scripts/migrations/2026-04-18-unify-whatsapp.ts` — data migration script.

**New files (tests):**

- `tests/lib/jkai/media/storage.test.ts`
- `tests/lib/jkai/media/multimodal.test.ts`
- `tests/lib/jkai/media/mime.test.ts`
- `tests/lib/jkai/media/rate-limits.test.ts`
- `tests/lib/server/models/capabilities.test.ts`
- `tests/routes/api/jkai/attachments.test.ts`
- `tests/lib/workflows/site-tools/media-tools.test.ts`
- `tests/lib/workflows/whatsapp/media-inbound.test.ts`

**Modified files:**

- `src/lib/db/schema.ts` — add `jkai_attachments`, remove `whatsappConversations` after migration.
- `src/routes/api/workflows/orchestrator/chat/+server.ts` — accept `attachmentIds`.
- `src/lib/workflows/chat/general-chat.ts` — widen signature; use `buildMultimodalContent`.
- `src/lib/workflows/chat/conversation-history.ts` — join attachments.
- `src/lib/workflows/whatsapp/types.ts` — widen `WhatsAppInboundMessage`.
- `src/lib/workflows/whatsapp/service.ts` — add `sendImage`, `sendAudio`, `sendDocument`; inbound download.
- `src/lib/workflows/whatsapp/orchestrator-bridge.ts` — unified store; media passthrough.
- `src/lib/workflows/site-tools/registry.ts` — register 3 media tools.
- `src/lib/workflows/site-tools/keyword-classifier.ts` — `media` toolset triggers.
- `src/lib/components/jkai/ChatArea.svelte` — paperclip, drag-drop, paste, mic, tray, capability gate.
- `src/routes/api/jkai/conversations/[id]/+server.ts` — include `modelCapabilities` + attachments.
- `src/lib/server/models/types.ts` — extend `PriceSnapshot` with image/tts units.
- `data/prompts/02-capabilities.md`, `data/prompts/03-tools.md` — Creating Media section.

**Env vars (document in `.env.example`):**

- `JKAI_MEDIA_ROOT` (default `~/.openclaw/jkai-media/`)
- `JKAI_MEDIA_MAX_BYTES` (default 209715200 = 200 MB ceiling)
- `JKAI_MAX_TURN_BYTES` (default 104857600 = 100 MB)
- `JKAI_IMAGE_MODEL` (default `black-forest-labs/flux-1.1-pro`)
- `JKAI_TTS_VOICE`, `JKAI_TTS_MODEL` (default `eleven_turbo_v2_5`)
- `ELEVENLABS_API_KEY`

**Dependencies to add:**

- `file-type` (already in use?) — verify in Task 2; add if missing.

---

## Testing approach

- Unit tests for pure logic: storage helpers (with a temp media root), mime mapping, multimodal content builder, capability lookup, rate-limit counters.
- Endpoint tests use Vitest + real HTTP-style calls through the SvelteKit `POST`/`GET` handlers with a mocked DB and mocked filesystem (`vi.mock('node:fs/promises')` where useful; otherwise point `JKAI_MEDIA_ROOT` at a `tmp/` dir cleaned between tests).
- Generation tools mock the outbound fetch (OpenRouter, ElevenLabs); `write_document` writes to disk for real in a temp dir.
- Svelte components are not unit-tested in this repo; UI tasks end with a **manual QA** step listing the exact interactions to verify.
- Migration script: dry-run against a snapshot DB before deploy. A small integration test seeds `whatsapp_conversations`, runs the script, and asserts post-state.

**Common commands:**

- `npm test` — full suite (vitest run)
- `npm run test:watch` — interactive
- `npx vitest run tests/path/file.test.ts` — one file
- `npm run check` — svelte-check + tsc
- `npx drizzle-kit push` — apply schema changes against local dev DB

---

## Task 1: Add `jkai_attachments` schema

**Files:**
- Modify: `src/lib/db/schema.ts` (append new table near orchestratorChats definition around line 697)

- [ ] **Step 1: Add the table definition**

Append to `src/lib/db/schema.ts` directly after the `orchestratorChats` export (around line 697):

```ts
// ==========================================
// JKAI Attachments (multimedia I/O)
// ==========================================

export const jkaiAttachments = pgTable('jkai_attachments', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => orchestratorChats.id, { onDelete: 'set null' }),
  source: text('source').notNull(), // 'web' | 'whatsapp' | 'generated'
  kind: text('kind').notNull(), // 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text'
  mimeType: text('mime_type').notNull(),
  originalName: text('original_name'),
  sizeBytes: integer('size_bytes').notNull(),
  diskPath: text('disk_path').notNull(),
  duration: doublePrecision('duration'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiAttachment = typeof jkaiAttachments.$inferSelect;
export type NewJkaiAttachment = typeof jkaiAttachments.$inferInsert;
```

- [ ] **Step 2: Push schema to local dev DB and inspect**

Run:
```bash
npx drizzle-kit push
```

Expected: Drizzle lists `+ jkai_attachments` as created. Confirm with:
```bash
psql "postgresql://app:test@localhost:5433/strange_rambling" -c "\d jkai_attachments"
```

- [ ] **Step 3: Add indexes via raw migration**

Create `scripts/migrations/2026-04-18-jkai-attachments-indexes.sql`:

```sql
CREATE INDEX IF NOT EXISTS jkai_attachments_message_idx
  ON jkai_attachments(message_id);
CREATE INDEX IF NOT EXISTS jkai_attachments_conversation_idx
  ON jkai_attachments(conversation_id);
CREATE INDEX IF NOT EXISTS jkai_attachments_orphan_idx
  ON jkai_attachments(created_at) WHERE message_id IS NULL;
```

Apply:
```bash
psql "postgresql://app:test@localhost:5433/strange_rambling" -f scripts/migrations/2026-04-18-jkai-attachments-indexes.sql
```

Expected: 3 × `CREATE INDEX` (or `NOTICE:  relation already exists, skipping`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts scripts/migrations/2026-04-18-jkai-attachments-indexes.sql
git commit -m "feat(jkai): add jkai_attachments schema + indexes"
```

---

## Task 2: Mime-to-kind mapping helper

**Files:**
- Create: `src/lib/jkai/media/mime.ts`
- Test: `tests/lib/jkai/media/mime.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/jkai/media/mime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kindFromMime, extensionForMime, isAllowedMime } from '$lib/jkai/media/mime';

describe('kindFromMime', () => {
  it('maps images', () => {
    expect(kindFromMime('image/jpeg')).toBe('image');
    expect(kindFromMime('image/png')).toBe('image');
    expect(kindFromMime('image/webp')).toBe('image');
  });
  it('maps audio', () => {
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('audio/ogg')).toBe('audio');
    expect(kindFromMime('audio/webm')).toBe('audio');
  });
  it('maps video', () => {
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('video/webm')).toBe('video');
  });
  it('maps pdf distinctly from document', () => {
    expect(kindFromMime('application/pdf')).toBe('pdf');
  });
  it('maps text', () => {
    expect(kindFromMime('text/plain')).toBe('text');
    expect(kindFromMime('text/markdown')).toBe('text');
    expect(kindFromMime('application/json')).toBe('text');
    expect(kindFromMime('text/csv')).toBe('text');
  });
  it('maps office docs to document', () => {
    expect(kindFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
  });
  it('returns null for unknown', () => {
    expect(kindFromMime('application/x-bogus')).toBeNull();
  });
});

describe('extensionForMime', () => {
  it('returns canonical extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('audio/mpeg')).toBe('mp3');
    expect(extensionForMime('audio/ogg')).toBe('ogg');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('application/pdf')).toBe('pdf');
    expect(extensionForMime('text/plain')).toBe('txt');
    expect(extensionForMime('text/markdown')).toBe('md');
    expect(extensionForMime('text/csv')).toBe('csv');
    expect(extensionForMime('application/json')).toBe('json');
  });
  it('returns bin for unknown', () => {
    expect(extensionForMime('application/x-bogus')).toBe('bin');
  });
});

describe('isAllowedMime', () => {
  it('allows standard media + text', () => {
    expect(isAllowedMime('image/jpeg')).toBe(true);
    expect(isAllowedMime('audio/mpeg')).toBe(true);
    expect(isAllowedMime('video/mp4')).toBe(true);
    expect(isAllowedMime('application/pdf')).toBe(true);
    expect(isAllowedMime('text/plain')).toBe(true);
  });
  it('rejects executables and unknown', () => {
    expect(isAllowedMime('application/x-msdownload')).toBe(false);
    expect(isAllowedMime('application/x-bogus')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/lib/jkai/media/mime.test.ts
```

Expected: FAIL — `$lib/jkai/media/mime` not found.

- [ ] **Step 3: Implement `mime.ts`**

Create `src/lib/jkai/media/mime.ts`:

```ts
export type AttachmentKind = 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';

const MIME_TO_KIND: Record<string, AttachmentKind> = {
  // images
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'image/gif': 'image', 'image/heic': 'image', 'image/heif': 'image',
  // audio
  'audio/mpeg': 'audio', 'audio/mp3': 'audio', 'audio/ogg': 'audio',
  'audio/webm': 'audio', 'audio/wav': 'audio', 'audio/x-wav': 'audio',
  'audio/aac': 'audio', 'audio/mp4': 'audio', 'audio/opus': 'audio',
  'audio/flac': 'audio',
  // video
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
  'video/x-matroska': 'video',
  // pdf
  'application/pdf': 'pdf',
  // text (inlined)
  'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'text',
  'text/html': 'text', 'text/xml': 'text', 'text/x-log': 'text',
  'application/json': 'text', 'application/xml': 'text',
  'application/x-yaml': 'text', 'text/yaml': 'text',
  'text/javascript': 'text', 'application/typescript': 'text',
  'text/x-python': 'text', 'text/x-rust': 'text', 'text/x-go': 'text',
  'text/x-c': 'text', 'text/x-c++': 'text',
  // binary docs
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/msword': 'document',
  'application/vnd.ms-excel': 'document',
  'application/rtf': 'document',
  'application/zip': 'document',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
  'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/opus': 'opus',
  'audio/flac': 'flac',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv',
  'text/html': 'html', 'text/xml': 'xml', 'text/x-log': 'log',
  'application/json': 'json', 'application/xml': 'xml',
  'application/x-yaml': 'yaml', 'text/yaml': 'yaml',
  'text/javascript': 'js', 'application/typescript': 'ts',
  'text/x-python': 'py', 'text/x-rust': 'rs', 'text/x-go': 'go',
  'text/x-c': 'c', 'text/x-c++': 'cpp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/rtf': 'rtf',
  'application/zip': 'zip',
};

export function kindFromMime(mime: string): AttachmentKind | null {
  return MIME_TO_KIND[mime] ?? null;
}

export function extensionForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? 'bin';
}

export function isAllowedMime(mime: string): boolean {
  return mime in MIME_TO_KIND;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/jkai/media/mime.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/media/mime.ts tests/lib/jkai/media/mime.test.ts
git commit -m "feat(jkai): add mime-to-kind mapping helper"
```

---

## Task 3: Storage helper (disk I/O)

**Files:**
- Create: `src/lib/jkai/media/storage.ts`
- Test: `tests/lib/jkai/media/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/jkai/media/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jkai-media-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('storage', () => {
  it('saveBuffer writes to YYYY/MM/<uuid>.<ext> and reports size', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const buf = Buffer.from('hello');
    const { diskPath, sizeBytes } = await saveBuffer(buf, 'txt');
    expect(sizeBytes).toBe(5);
    expect(diskPath).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]+\.txt$/);
    const s = await stat(join(tmpRoot, diskPath));
    expect(s.size).toBe(5);
  });

  it('readBuffer returns the bytes written', async () => {
    const { saveBuffer, readBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from('abc'), 'txt');
    const back = await readBuffer(diskPath);
    expect(back.toString('utf8')).toBe('abc');
  });

  it('deleteByDiskPath removes the file', async () => {
    const { saveBuffer, deleteByDiskPath } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from('x'), 'txt');
    await deleteByDiskPath(diskPath);
    await expect(readFile(join(tmpRoot, diskPath))).rejects.toThrow();
  });

  it('resolveAbsolutePath rejects path traversal', async () => {
    const { resolveAbsolutePath } = await import('$lib/jkai/media/storage');
    expect(() => resolveAbsolutePath('../etc/passwd')).toThrow();
    expect(() => resolveAbsolutePath('/etc/passwd')).toThrow();
    expect(() => resolveAbsolutePath('2026/04/abc.txt')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/lib/jkai/media/storage.test.ts
```

Expected: FAIL — `$lib/jkai/media/storage` not found.

- [ ] **Step 3: Implement `storage.ts`**

Create `src/lib/jkai/media/storage.ts`:

```ts
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve, normalize, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

function mediaRoot(): string {
  const raw = process.env.JKAI_MEDIA_ROOT ?? join(homedir(), '.openclaw', 'jkai-media');
  return resolve(raw);
}

function newUuid(): string {
  return (globalThis.crypto ?? require('node:crypto')).randomUUID();
}

export function resolveAbsolutePath(diskPath: string): string {
  if (isAbsolute(diskPath)) throw new Error('absolute paths not allowed');
  const root = mediaRoot();
  const abs = resolve(root, diskPath);
  const normAbs = normalize(abs);
  const normRoot = normalize(root);
  if (!normAbs.startsWith(normRoot + sep) && normAbs !== normRoot) {
    throw new Error('path traversal blocked');
  }
  return normAbs;
}

export async function saveBuffer(
  buf: Buffer,
  ext: string,
): Promise<{ diskPath: string; sizeBytes: number }> {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = newUuid();
  const cleanExt = ext.replace(/^\.+/, '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const diskPath = `${yyyy}/${mm}/${uuid}.${cleanExt}`;
  const abs = resolveAbsolutePath(diskPath);
  await mkdir(join(mediaRoot(), yyyy, mm), { recursive: true });
  await writeFile(abs, buf);
  return { diskPath, sizeBytes: buf.byteLength };
}

export async function readBuffer(diskPath: string): Promise<Buffer> {
  return readFile(resolveAbsolutePath(diskPath));
}

export async function deleteByDiskPath(diskPath: string): Promise<void> {
  try {
    await unlink(resolveAbsolutePath(diskPath));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

export { mediaRoot };
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/jkai/media/storage.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/media/storage.ts tests/lib/jkai/media/storage.test.ts
git commit -m "feat(jkai): add media storage helper"
```

---

## Task 4: Model capabilities module

**Files:**
- Create: `src/lib/server/models/capabilities.ts`
- Test: `tests/lib/server/models/capabilities.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/server/models/capabilities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getModelCapabilities } from '$lib/server/models/capabilities';

describe('getModelCapabilities', () => {
  it('glm-5 supports everything', () => {
    expect(getModelCapabilities({ provider: 'zai', modelId: 'glm-5' })).toEqual({
      image: true, audio: true, video: true, pdf: true, documentText: true,
    });
  });
  it('glm-4.5v is image-only', () => {
    const c = getModelCapabilities({ provider: 'zai', modelId: 'glm-4.5v' });
    expect(c.image).toBe(true);
    expect(c.audio).toBe(false);
    expect(c.video).toBe(false);
    expect(c.pdf).toBe(false);
    expect(c.documentText).toBe(true);
  });
  it('openrouter vision models get image', () => {
    const c = getModelCapabilities({ provider: 'openrouter', modelId: 'anthropic/claude-3.5-sonnet' });
    expect(c.image).toBe(true);
    expect(c.pdf).toBe(true);
  });
  it('unknown openrouter model defaults to text-only', () => {
    const c = getModelCapabilities({ provider: 'openrouter', modelId: 'unknown/weird-model' });
    expect(c).toEqual({
      image: false, audio: false, video: false, pdf: false, documentText: true,
    });
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/lib/server/models/capabilities.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `capabilities.ts`**

Create `src/lib/server/models/capabilities.ts`:

```ts
import type { ModelContext } from './types';

export interface ModelCapabilities {
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
  documentText: boolean;
}

const ALL: ModelCapabilities = { image: true, audio: true, video: true, pdf: true, documentText: true };
const IMAGE_ONLY: ModelCapabilities = { image: true, audio: false, video: false, pdf: false, documentText: true };
const IMAGE_PDF: ModelCapabilities = { image: true, audio: false, video: false, pdf: true, documentText: true };
const TEXT_ONLY: ModelCapabilities = { image: false, audio: false, video: false, pdf: false, documentText: true };

const ZAI_CAPS: Record<string, ModelCapabilities> = {
  'glm-5': ALL,
  'glm-5.1': ALL,
  'glm-4.5v': IMAGE_ONLY,
  'glm-4v': IMAGE_ONLY,
  'glm-4.6': TEXT_ONLY,
  'glm-4.5': TEXT_ONLY,
};

const OPENROUTER_CAPS: Record<string, ModelCapabilities> = {
  'anthropic/claude-3.5-sonnet': IMAGE_PDF,
  'anthropic/claude-3.7-sonnet': IMAGE_PDF,
  'anthropic/claude-opus-4.1': IMAGE_PDF,
  'anthropic/claude-sonnet-4.5': IMAGE_PDF,
  'openai/gpt-4o': IMAGE_ONLY,
  'openai/gpt-4.1': IMAGE_ONLY,
  'google/gemini-2.5-pro': ALL,
  'google/gemini-2.5-flash': ALL,
  'x-ai/grok-2-vision': IMAGE_ONLY,
};

export function getModelCapabilities(ctx: ModelContext): ModelCapabilities {
  if (ctx.provider === 'zai') return ZAI_CAPS[ctx.modelId] ?? TEXT_ONLY;
  if (ctx.provider === 'openrouter') return OPENROUTER_CAPS[ctx.modelId] ?? TEXT_ONLY;
  return TEXT_ONLY;
}

export function canAcceptKind(caps: ModelCapabilities, kind: string): boolean {
  switch (kind) {
    case 'image': return caps.image;
    case 'audio': return caps.audio;
    case 'video': return caps.video;
    case 'pdf':   return caps.pdf;
    case 'document':
    case 'text':  return caps.documentText;
    default: return false;
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/server/models/capabilities.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/models/capabilities.ts tests/lib/server/models/capabilities.test.ts
git commit -m "feat(jkai): add per-model capability lookup"
```

---

## Task 5: Attachment serve endpoint (GET by id)

**Files:**
- Create: `src/routes/api/jkai/attachments/[id]/+server.ts`

- [ ] **Step 1: Implement the GET handler**

Create `src/routes/api/jkai/attachments/[id]/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, deleteByDiskPath } from '$lib/jkai/media/storage';

export const GET: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, params.id!)).limit(1);
  if (!row) throw error(404, 'attachment not found');
  let buf: Buffer;
  try {
    buf = await readBuffer(row.diskPath);
  } catch {
    throw error(410, 'attachment file missing on disk');
  }
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(row.sizeBytes),
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.originalName ?? row.id)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, params.id!)).limit(1);
  if (!row) throw error(404, 'attachment not found');
  await deleteByDiskPath(row.diskPath);
  await db.delete(jkaiAttachments).where(eq(jkaiAttachments.id, row.id));
  return json({ deleted: true });
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run check
```

Expected: no errors relating to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/jkai/attachments/\[id\]/+server.ts
git commit -m "feat(jkai): add attachments serve + delete endpoint"
```

---

## Task 6: Attachment upload endpoint

**Files:**
- Create: `src/routes/api/jkai/attachments/+server.ts`
- Test: `tests/routes/api/jkai/attachments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/routes/api/jkai/attachments.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const inserted: any[] = [];
const selected: any[] = [];

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({ values: (v: any) => ({ returning: async () => { inserted.push(v); return [{ ...v, id: 'att-1' }]; } }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => selected }) }) }),
  },
}));
vi.mock('$lib/db/schema', () => ({ jkaiAttachments: {} }));

describe('POST /api/jkai/attachments', () => {
  beforeEach(() => {
    inserted.length = 0;
    selected.length = 0;
    process.env.JKAI_MEDIA_ROOT = process.env.JKAI_MEDIA_ROOT || '/tmp/jkai-media-test';
  });
  it('rejects missing file', async () => {
    const { POST } = await import('$/routes/api/jkai/attachments/+server');
    const fd = new FormData();
    fd.append('conversationId', 'conv-1');
    const req = new Request('http://x/api/jkai/attachments', { method: 'POST', body: fd });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(400);
  });
  it('accepts a png and inserts a row', async () => {
    const { POST } = await import('$/routes/api/jkai/attachments/+server');
    const fd = new FormData();
    fd.append('conversationId', 'conv-1');
    // minimal PNG header: 89 50 4E 47 0D 0A 1A 0A + IHDR chunk header
    const png = new Uint8Array([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
      0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
      0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xde,
    ]);
    fd.append('file', new Blob([png], { type: 'image/png' }), 'tiny.png');
    const req = new Request('http://x/api/jkai/attachments', { method: 'POST', body: fd });
    const res = await POST({ request: req } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe('image');
    expect(body.mimeType).toBe('image/png');
    expect(inserted.length).toBe(1);
  });
});
```

Note the test uses `$/routes/...` — configure vitest path alias if not already present. Verify with:
```bash
grep -n '"$/"' vitest.config.ts svelte.config.js 2>/dev/null
```
If absent, use a relative import path instead: `import('../../../../src/routes/api/jkai/attachments/+server')`.

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/routes/api/jkai/attachments.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Confirm `file-type` dependency**

Check `package.json`:

```bash
node -e "const p=require('./package.json');console.log(p.dependencies['file-type']||p.devDependencies['file-type']||'MISSING');"
```

If MISSING:
```bash
npm install file-type
```

- [ ] **Step 4: Implement the POST handler**

Create `src/routes/api/jkai/attachments/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { fileTypeFromBuffer } from 'file-type';
import { saveBuffer } from '$lib/jkai/media/storage';
import { kindFromMime, extensionForMime, isAllowedMime } from '$lib/jkai/media/mime';

const LIMITS_BY_KIND: Record<string, number> = {
  image: 15 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  document: 2 * 1024 * 1024,
  text: 2 * 1024 * 1024,
};

function sanitizeFilename(name: string | null | undefined): string | null {
  if (!name) return null;
  const stripped = name.replace(/[\/\\\0]/g, '_');
  return stripped.slice(0, 255);
}

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('file');
  const conversationId = form.get('conversationId') as string | null;
  if (!(file instanceof File)) {
    throw error(400, 'file is required');
  }
  if (file.size === 0) {
    throw error(400, 'file is empty');
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Sniff mime from bytes; fall back to declared type for text formats
  // (file-type doesn't detect plain text/markdown/csv).
  let sniffed = (await fileTypeFromBuffer(buf))?.mime;
  let mime = sniffed ?? file.type ?? 'application/octet-stream';

  // For text-ish declared types, trust the client because file-type won't detect them
  if (!sniffed && file.type && file.type.startsWith('text/')) {
    mime = file.type;
  } else if (!sniffed && (file.type === 'application/json' || file.type === 'application/x-yaml')) {
    mime = file.type;
  }

  if (!isAllowedMime(mime)) {
    throw error(415, `unsupported mime type: ${mime}`);
  }

  const kind = kindFromMime(mime)!;
  const limit = LIMITS_BY_KIND[kind];
  if (file.size > limit) {
    throw error(413, `file too large (${kind} limit: ${limit} bytes)`);
  }

  const ext = extensionForMime(mime);
  const { diskPath, sizeBytes } = await saveBuffer(buf, ext);

  const [row] = await db.insert(jkaiAttachments).values({
    conversationId: conversationId || null,
    messageId: null,
    source: 'web',
    kind,
    mimeType: mime,
    originalName: sanitizeFilename(file.name),
    sizeBytes,
    diskPath,
    duration: null,
    metadata: null,
  }).returning();

  return json(row);
};
```

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/routes/api/jkai/attachments.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/jkai/attachments/+server.ts tests/routes/api/jkai/attachments.test.ts
git commit -m "feat(jkai): add attachment upload endpoint"
```

---

## Task 7: Orphan sweep helper

**Files:**
- Create: `src/lib/jkai/media/sweep.ts`
- Modify: `src/hooks.server.ts` (call on startup)

- [ ] **Step 1: Implement sweep logic**

Create `src/lib/jkai/media/sweep.ts`:

```ts
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { and, isNull, lt } from 'drizzle-orm';
import { deleteByDiskPath } from './storage';

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export async function sweepOrphanAttachments(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - ORPHAN_AGE_MS);
  const orphans = await db
    .select()
    .from(jkaiAttachments)
    .where(and(isNull(jkaiAttachments.messageId), lt(jkaiAttachments.createdAt, cutoff)));
  let deleted = 0;
  for (const row of orphans) {
    try {
      await deleteByDiskPath(row.diskPath);
      await db.delete(jkaiAttachments).where(/* @ts-expect-error eq */ undefined as any);
    } catch (err) {
      console.warn('[media-sweep] failed to delete', row.id, err);
    }
  }
  return { deleted };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startOrphanSweep(): void {
  if (timer) return;
  sweepOrphanAttachments().catch((e) => console.warn('[media-sweep] initial run failed', e));
  timer = setInterval(() => {
    sweepOrphanAttachments().catch((e) => console.warn('[media-sweep] periodic run failed', e));
  }, 60 * 60 * 1000);
}
```

Fix the delete call — the `@ts-expect-error` is a placeholder; use proper Drizzle syntax:

```ts
import { eq } from 'drizzle-orm';
// inside the loop:
      await db.delete(jkaiAttachments).where(eq(jkaiAttachments.id, row.id));
```

- [ ] **Step 2: Register startup hook**

Open `src/hooks.server.ts`. Locate the module-level initialization area (near other background starters). Add:

```ts
import { startOrphanSweep } from '$lib/jkai/media/sweep';
startOrphanSweep();
```

If `src/hooks.server.ts` doesn't exist, create it with that single import + call.

- [ ] **Step 3: Typecheck**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jkai/media/sweep.ts src/hooks.server.ts
git commit -m "feat(jkai): orphan attachment sweep on startup + hourly"
```

---

## Task 8: Multimodal content builder

**Files:**
- Create: `src/lib/jkai/media/multimodal.ts`
- Test: `tests/lib/jkai/media/multimodal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/media/multimodal.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jkai-mm-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('buildMultimodalContent', () => {
  it('returns a plain string when no attachments and text is simple', async () => {
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('hello', []);
    expect(parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('inlines text files with header framing', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from('console.log(1)'), 'js');
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('explain', [
      {
        id: 'a1', conversationId: null, messageId: null, source: 'web',
        kind: 'text', mimeType: 'text/javascript',
        originalName: 'code.js', sizeBytes: 14, diskPath,
        duration: null, metadata: null, createdAt: new Date(),
      } as any,
    ]);
    expect(parts[0]).toEqual({ type: 'text', text: 'explain' });
    expect(parts[1].type).toBe('text');
    expect(parts[1].text).toContain('--- File: code.js');
    expect(parts[1].text).toContain('console.log(1)');
    expect(parts[1].text).toContain('--- end ---');
  });

  it('image becomes image_url data URL', async () => {
    const { saveBuffer } = await import('$lib/jkai/media/storage');
    const { diskPath } = await saveBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'png');
    const { buildMultimodalContent } = await import('$lib/jkai/media/multimodal');
    const parts = await buildMultimodalContent('', [{
      id: 'a1', conversationId: null, messageId: null, source: 'web',
      kind: 'image', mimeType: 'image/png', originalName: null,
      sizeBytes: 4, diskPath, duration: null, metadata: null, createdAt: new Date(),
    } as any]);
    expect(parts[0].type).toBe('image_url');
    expect(parts[0].image_url.url).toMatch(/^data:image\/png;base64,/);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/lib/jkai/media/multimodal.test.ts
```

- [ ] **Step 3: Implement `multimodal.ts`**

Create `src/lib/jkai/media/multimodal.ts`:

```ts
import { readBuffer } from './storage';
import type { JkaiAttachment } from '$lib/db/schema';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

const AUDIO_FORMAT_MAP: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg',
  'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/opus': 'opus', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/mp4': 'mp4',
};

function dataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function buildMultimodalContent(
  text: string,
  attachments: JkaiAttachment[],
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  if (text && text.length > 0) {
    parts.push({ type: 'text', text });
  }
  for (const att of attachments) {
    const buf = await readBuffer(att.diskPath);
    if (att.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url: dataUrl(att.mimeType, buf) } });
    } else if (att.kind === 'audio') {
      const format = AUDIO_FORMAT_MAP[att.mimeType] ?? 'mp3';
      parts.push({ type: 'input_audio', input_audio: { data: buf.toString('base64'), format } });
    } else if (att.kind === 'video') {
      parts.push({ type: 'video_url', video_url: { url: dataUrl(att.mimeType, buf) } });
    } else if (att.kind === 'pdf') {
      parts.push({ type: 'file', file: { filename: att.originalName ?? 'file.pdf', file_data: dataUrl(att.mimeType, buf) } });
    } else if (att.kind === 'document') {
      // binary docs — send as file
      parts.push({ type: 'file', file: { filename: att.originalName ?? 'document', file_data: dataUrl(att.mimeType, buf) } });
    } else if (att.kind === 'text') {
      const name = att.originalName ?? 'file';
      const body = buf.toString('utf8');
      parts.push({
        type: 'text',
        text: `\n\n--- File: ${name} (${att.mimeType}, ${body.length} chars) ---\n${body}\n--- end ---`,
      });
    }
  }
  return parts;
}

export function encodedSizeBytes(parts: ContentPart[]): number {
  let n = 0;
  for (const p of parts) {
    if (p.type === 'text') n += p.text.length;
    else if (p.type === 'image_url') n += p.image_url.url.length;
    else if (p.type === 'input_audio') n += p.input_audio.data.length;
    else if (p.type === 'video_url') n += p.video_url.url.length;
    else if (p.type === 'file') n += p.file.file_data.length;
  }
  return n;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npx vitest run tests/lib/jkai/media/multimodal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/media/multimodal.ts tests/lib/jkai/media/multimodal.test.ts
git commit -m "feat(jkai): add multimodal content builder"
```

---

## Task 9: Widen `generalChat` + history-with-attachments

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`
- Modify: `src/lib/workflows/chat/conversation-history.ts`

- [ ] **Step 1: Update conversation-history loader**

Open `src/lib/workflows/chat/conversation-history.ts`. Locate the query that returns `orchestratorChats` rows. Replace the `.select().from(orchestratorChats)...` block with a left join on attachments:

```ts
import { db } from '$lib/db';
import { orchestratorChats, jkaiAttachments } from '$lib/db/schema';
import { eq, and, desc, or } from 'drizzle-orm';
import type { JkaiAttachment } from '$lib/db/schema';

export interface HistoryMessage {
  role: string;
  content: string;
  attachments: JkaiAttachment[];
  createdAt: Date;
}

const MAX_HISTORY = 30;

export async function loadConversationHistory(
  conversationId?: string | null,
  workflowId?: string | null,
): Promise<HistoryMessage[]> {
  if (!conversationId && !workflowId) return [];
  const filter = conversationId
    ? eq(orchestratorChats.conversationId, conversationId)
    : eq(orchestratorChats.workflowId, workflowId!);

  const rows = await db
    .select({
      id: orchestratorChats.id,
      role: orchestratorChats.role,
      content: orchestratorChats.content,
      createdAt: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(filter)
    .orderBy(desc(orchestratorChats.createdAt))
    .limit(MAX_HISTORY);

  const ordered = rows.reverse();
  if (ordered.length === 0) return [];

  const ids = ordered.map((r) => r.id);
  const atts = await db.select().from(jkaiAttachments).where(
    or(...ids.map((id) => eq(jkaiAttachments.messageId, id)))!,
  );
  const byMsg = new Map<string, JkaiAttachment[]>();
  for (const a of atts) {
    if (!a.messageId) continue;
    const arr = byMsg.get(a.messageId) ?? [];
    arr.push(a);
    byMsg.set(a.messageId, arr);
  }
  return ordered.map((r) => ({
    role: r.role,
    content: r.content,
    attachments: byMsg.get(r.id) ?? [],
    createdAt: r.createdAt,
  }));
}
```

If existing call sites expected a different return shape, adjust them (grep `loadConversationHistory` and update).

- [ ] **Step 2: Widen `generalChat`**

Open `src/lib/workflows/chat/general-chat.ts`. Change the signature and the first user-message assembly.

At the top, add:
```ts
import { buildMultimodalContent, encodedSizeBytes } from '$lib/jkai/media/multimodal';
import type { JkaiAttachment } from '$lib/db/schema';
```

Change the exported function signature from `generalChat(message: string, history, options)` to:
```ts
export async function generalChat(
  input: { text: string; attachments?: JkaiAttachment[] },
  history: HistoryMessage[],
  options: ChatOptions,
): Promise<{ response: string }>
```

Where it builds the user message, replace:
```ts
messages.push({ role: 'user', content: message });
```

with:
```ts
const userParts = await buildMultimodalContent(input.text, input.attachments ?? []);
const maxTurnBytes = Number(process.env.JKAI_MAX_TURN_BYTES ?? 104857600);
if (encodedSizeBytes(userParts) > maxTurnBytes) {
  throw new Error(`Encoded turn payload exceeds JKAI_MAX_TURN_BYTES (${maxTurnBytes})`);
}
messages.push({ role: 'user', content: userParts.length === 1 && userParts[0].type === 'text' ? userParts[0].text : userParts });
```

When building history messages, include attachments on prior user turns:

```ts
for (const h of history) {
  if (h.role === 'user' && h.attachments.length > 0) {
    const parts = await buildMultimodalContent(h.content, h.attachments);
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({ role: h.role, content: h.content });
  }
}
```

Grep for the single-parameter `message` usage inside `generalChat` and replace with `input.text` where appropriate (progress logs, history slicing, etc.). Keep all other behaviour unchanged.

- [ ] **Step 3: Typecheck**

```bash
npm run check
```

Expected: no errors in `general-chat.ts` or `conversation-history.ts`. Fix any call sites that still pass a string.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts src/lib/workflows/chat/conversation-history.ts
git commit -m "feat(jkai): widen generalChat to accept attachments"
```

---

## Task 10: Chat endpoint accepts `attachmentIds`

**Files:**
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts`

- [ ] **Step 1: Update the POST handler body parsing**

Near the top of the POST handler (around line 20), change:
```ts
const { message, workflowId, mode, currentNodes, currentEdges, conversationId } = body;
```
to:
```ts
const { message, workflowId, mode, currentNodes, currentEdges, conversationId, attachmentIds } = body as {
  message: string;
  workflowId?: string;
  mode?: string;
  currentNodes?: any;
  currentEdges?: any;
  conversationId?: string;
  attachmentIds?: string[];
};
```

- [ ] **Step 2: Server-side capability gate**

Add an import block:
```ts
import { jkaiAttachments, conversations } from '$lib/db/schema';
import { getModelCapabilities, canAcceptKind } from '$lib/server/models/capabilities';
import { inArray } from 'drizzle-orm';
```

Just before the `// Cancel any stale running jobs` line, add:

```ts
let attachmentRows: Array<typeof jkaiAttachments.$inferSelect> = [];
if (attachmentIds && attachmentIds.length > 0) {
  if (attachmentIds.length > 10) {
    return json({ error: 'too many attachments (max 10 per turn)' }, { status: 400 });
  }
  attachmentRows = await db.select().from(jkaiAttachments).where(inArray(jkaiAttachments.id, attachmentIds));
  if (attachmentRows.length !== attachmentIds.length) {
    return json({ error: 'one or more attachmentIds not found' }, { status: 404 });
  }

  let ctx = await resolveDefaultModel('chat');
  if (conversationId) {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (conv) ctx = { provider: conv.modelProvider as 'zai' | 'openrouter', modelId: conv.modelId };
  }
  const caps = getModelCapabilities(ctx);
  for (const a of attachmentRows) {
    if (!canAcceptKind(caps, a.kind)) {
      return json({ error: `model ${ctx.modelId} cannot accept ${a.kind}` }, { status: 400 });
    }
  }
}
```

- [ ] **Step 3: Bind attachments to the new user message**

In the "Default: general-purpose chat" branch, after the user-message insert, add:

```ts
let insertedUserMsg: { id: string } | null = null;
if (conversationId) {
  const [m] = await db.insert(orchestratorChats).values({ conversationId, role: 'user', content: message }).returning({ id: orchestratorChats.id });
  insertedUserMsg = m;
} else if (workflowId) {
  const [m] = await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: message }).returning({ id: orchestratorChats.id });
  insertedUserMsg = m;
}

if (insertedUserMsg && attachmentRows.length > 0) {
  await db.update(jkaiAttachments)
    .set({ messageId: insertedUserMsg.id })
    .where(inArray(jkaiAttachments.id, attachmentRows.map((a) => a.id)));
}
```

Remove the old `await db.insert(orchestratorChats).values({ conversationId, role: 'user', content: message });` block.

- [ ] **Step 4: Pass attachments into `generalChat`**

Change the `generalChat(message, conversationHistory, ...)` call to:
```ts
const { response: responseText } = await generalChat(
  { text: message, attachments: attachmentRows },
  conversationHistory,
  { /* existing options unchanged */ ... },
);
```

- [ ] **Step 5: Include assistant attachments in job.result**

At the point where `job.result = { success: true, workflow: null, message: responseText };` is set, change to:

```ts
let assistantAttachments: typeof jkaiAttachments.$inferSelect[] = [];
if (conversationId || workflowId) {
  const targetMsg = (conversationId || workflowId) && assistantMetadata
    ? (await db.select().from(orchestratorChats)
        .where(conversationId
          ? eq(orchestratorChats.conversationId, conversationId)
          : eq(orchestratorChats.workflowId, workflowId!))
        .orderBy(desc(orchestratorChats.createdAt))
        .limit(1))[0]
    : null;
  if (targetMsg) {
    assistantAttachments = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.messageId, targetMsg.id));
  }
}
job.result = { success: true, workflow: null, message: responseText, attachments: assistantAttachments };
```

(If `desc` is not already imported from `drizzle-orm`, add it.)

- [ ] **Step 6: Typecheck**

```bash
npm run check
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "feat(jkai): chat endpoint accepts attachmentIds"
```

---

## Task 11: WhatsApp unification — schema + migration script

**Files:**
- Create: `scripts/migrations/2026-04-18-unify-whatsapp.ts`
- Modify: `src/lib/db/schema.ts` (drop `whatsappConversations` AFTER migration run)

- [ ] **Step 1: Write the migration script**

Create `scripts/migrations/2026-04-18-unify-whatsapp.ts`:

```ts
// Run with: npx tsx scripts/migrations/2026-04-18-unify-whatsapp.ts
// Backfills whatsapp_conversations into jkai_conversations + orchestrator_chats.
// Idempotent: re-running skips phone numbers already migrated.

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://app:test@localhost:5433/strange_rambling',
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: phones } = await client.query<{ phone_number: string; first_seen: string }>(`
      SELECT DISTINCT phone_number, MIN(created_at) AS first_seen
        FROM whatsapp_conversations
       GROUP BY phone_number
    `);

    console.log(`[migrate] Found ${phones.length} distinct phone numbers`);

    const { rows: defaults } = await client.query<{ value: string }>(`
      SELECT value FROM app_settings WHERE key='default_chat_model' LIMIT 1
    `).catch(() => ({ rows: [] as { value: string }[] }));

    const DEFAULT_PROVIDER = 'zai';
    const DEFAULT_MODEL = 'glm-5';

    for (const p of phones) {
      const { rows: existing } = await client.query(
        `SELECT id FROM jkai_conversations WHERE whatsapp_phone_number=$1 AND source='whatsapp' LIMIT 1`,
        [p.phone_number],
      );
      let convId: string;
      if (existing[0]) {
        convId = existing[0].id;
        console.log(`[migrate] phone ${p.phone_number} already has conv ${convId}`);
      } else {
        const { rows } = await client.query(
          `INSERT INTO jkai_conversations (source, whatsapp_phone_number, model_provider, model_id, created_at, updated_at)
           VALUES ('whatsapp', $1, $2, $3, $4, $4) RETURNING id`,
          [p.phone_number, DEFAULT_PROVIDER, DEFAULT_MODEL, p.first_seen],
        );
        convId = rows[0].id;
        console.log(`[migrate] created conv ${convId} for ${p.phone_number}`);
      }

      const { rowCount } = await client.query(
        `INSERT INTO orchestrator_chats (conversation_id, role, content, metadata, created_at)
         SELECT $1, role, content, metadata, created_at
           FROM whatsapp_conversations
          WHERE phone_number=$2
            AND NOT EXISTS (
              SELECT 1 FROM orchestrator_chats oc
               WHERE oc.conversation_id=$1
                 AND oc.created_at=whatsapp_conversations.created_at
                 AND oc.role=whatsapp_conversations.role
            )`,
        [convId, p.phone_number],
      );
      console.log(`[migrate] inserted ${rowCount} messages for ${p.phone_number}`);
    }

    await client.query('COMMIT');
    console.log('[migrate] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run against local dev DB**

```bash
npx tsx scripts/migrations/2026-04-18-unify-whatsapp.ts
```

Expected output: `[migrate] Done.` and counts of migrated messages. Inspect:

```bash
psql "postgresql://app:test@localhost:5433/strange_rambling" -c "SELECT COUNT(*) FROM orchestrator_chats oc JOIN jkai_conversations jc ON jc.id=oc.conversation_id WHERE jc.source='whatsapp';"
```

Verify count matches `SELECT COUNT(*) FROM whatsapp_conversations`.

- [ ] **Step 3: Drop the old table from the schema**

In `src/lib/db/schema.ts`, delete the `whatsappConversations` `pgTable` export and the two exported types (`WhatsAppConversation`, `NewWhatsAppConversation`). Do NOT `drizzle-kit push` yet — the old table still has data and downstream code still imports the type. The table will be dropped in Task 13 after code references are gone.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/2026-04-18-unify-whatsapp.ts src/lib/db/schema.ts
git commit -m "feat(jkai): migration to unify whatsapp into orchestrator_chats"
```

---

## Task 12: WhatsApp inbound — widen types

**Files:**
- Modify: `src/lib/workflows/whatsapp/types.ts`

- [ ] **Step 1: Widen `WhatsAppInboundMessage`**

Replace the `WhatsAppInboundMessage` interface in `src/lib/workflows/whatsapp/types.ts`:

```ts
export interface WhatsAppInboundMessage {
  from: string;
  replyJid?: string;
  text: string;
  timestamp: number;
  messageId: string;
  isGroup: boolean;
  groupId?: string;

  // Media fields (populated when the WhatsApp message is a media message)
  mediaKind?: 'image' | 'audio' | 'video' | 'document';
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaBuffer?: Buffer;
  mediaDuration?: number;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run check
```

Expected: clean (types are widened optionally, so existing usage still compiles).

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/whatsapp/types.ts
git commit -m "feat(jkai): widen WhatsAppInboundMessage with media fields"
```

---

## Task 13: WhatsApp inbound — service download + bridge refactor

**Files:**
- Modify: `src/lib/workflows/whatsapp/service.ts`
- Modify: `src/lib/workflows/whatsapp/orchestrator-bridge.ts`

- [ ] **Step 1: Service — download media on inbound**

In `src/lib/workflows/whatsapp/service.ts`, find the message event handler (the place where `WhatsAppInboundMessage` is constructed — likely inside a `messages.upsert` handler). Add handling for media messages. Sketch:

```ts
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { WhatsAppInboundMessage } from './types';

// inside the messages.upsert handler, for each msg:
const content = msg.message;
let mediaKind: WhatsAppInboundMessage['mediaKind'];
let mediaMimeType: string | undefined;
let mediaFilename: string | undefined;
let mediaBuffer: Buffer | undefined;
let mediaDuration: number | undefined;
let caption = '';

if (content?.imageMessage) {
  mediaKind = 'image';
  mediaMimeType = content.imageMessage.mimetype ?? 'image/jpeg';
  caption = content.imageMessage.caption ?? '';
} else if (content?.audioMessage) {
  mediaKind = 'audio';
  mediaMimeType = content.audioMessage.mimetype ?? 'audio/ogg';
  mediaDuration = content.audioMessage.seconds ?? undefined;
} else if (content?.videoMessage) {
  mediaKind = 'video';
  mediaMimeType = content.videoMessage.mimetype ?? 'video/mp4';
  mediaDuration = content.videoMessage.seconds ?? undefined;
  caption = content.videoMessage.caption ?? '';
} else if (content?.documentMessage) {
  mediaKind = 'document';
  mediaMimeType = content.documentMessage.mimetype ?? 'application/octet-stream';
  mediaFilename = content.documentMessage.fileName ?? undefined;
  caption = content.documentMessage.caption ?? '';
}

if (mediaKind) {
  try {
    const stream = await downloadMediaMessage(msg, 'buffer', {}, { logger: undefined as any, reuploadRequest: this.sock!.updateMediaMessage });
    mediaBuffer = stream as Buffer;
  } catch (err) {
    console.warn('[whatsapp] media download failed', err);
  }
}

const text = caption || content?.conversation || content?.extendedTextMessage?.text || '';
const inbound: WhatsAppInboundMessage = {
  from, replyJid, text, timestamp, messageId,
  isGroup, groupId,
  mediaKind, mediaMimeType, mediaFilename, mediaBuffer, mediaDuration,
};
this.bridge.handleMessage(inbound);
```

Locate the existing equivalent in `service.ts` and merge this logic in — do not duplicate the existing extractor.

- [ ] **Step 2: Bridge — unified store + attachment insert**

Replace `src/lib/workflows/whatsapp/orchestrator-bridge.ts` with:

```ts
import { db } from '$lib/db';
import { conversations, orchestratorChats, jkaiAttachments } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { generalChat } from '$lib/workflows/chat/general-chat';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { saveBuffer } from '$lib/jkai/media/storage';
import { extensionForMime } from '$lib/jkai/media/mime';
import type { WhatsAppInboundMessage, WhatsAppSendResult } from './types';
import type { JkaiAttachment } from '$lib/db/schema';

type SendFn = (to: string, text: string) => Promise<WhatsAppSendResult>;
type SendMediaFn = (to: string, att: JkaiAttachment, caption?: string) => Promise<WhatsAppSendResult>;
type TypingFn = (to: string) => Promise<void>;

export class OrchestratorBridge {
  private sendFn: SendFn;
  private sendMediaFn: SendMediaFn | null;
  private typingFn: TypingFn | null;
  private typingDoneFn: TypingFn | null;

  constructor(sendFn: SendFn, opts?: { sendMediaFn?: SendMediaFn; typingFn?: TypingFn; typingDoneFn?: TypingFn }) {
    this.sendFn = sendFn;
    this.sendMediaFn = opts?.sendMediaFn ?? null;
    this.typingFn = opts?.typingFn ?? null;
    this.typingDoneFn = opts?.typingDoneFn ?? null;
  }

  isResetCommand(text: string): boolean {
    const cmd = text.trim().toLowerCase();
    return cmd === '/clear' || cmd === '/new';
  }

  private async resolveConversationId(phoneNumber: string): Promise<string> {
    const [existing] = await db.select().from(conversations)
      .where(and(eq(conversations.source, 'whatsapp'), eq(conversations.whatsappPhoneNumber, phoneNumber)))
      .limit(1);
    if (existing) return existing.id;
    const def = await resolveDefaultModel('chat');
    const [created] = await db.insert(conversations).values({
      source: 'whatsapp',
      whatsappPhoneNumber: phoneNumber,
      modelProvider: def.provider,
      modelId: def.modelId,
    }).returning();
    return created.id;
  }

  async handleMessage(msg: WhatsAppInboundMessage): Promise<void> {
    const { from, text, replyJid, mediaKind, mediaMimeType, mediaFilename, mediaBuffer, mediaDuration } = msg;
    const replyTo = replyJid || from;

    if (this.isResetCommand(text)) {
      await this.clearConversation(from);
      await this.sendFn(replyTo, 'Conversation cleared. What can I help with?');
      return;
    }

    try {
      await this.typingFn?.(replyTo);
      const conversationId = await this.resolveConversationId(from);

      const placeholder = !text && mediaKind
        ? mediaKind === 'audio' ? '[voice note]'
        : mediaKind === 'image' ? '[image]'
        : mediaKind === 'video' ? '[video]'
        : mediaKind === 'document' ? `[document: ${mediaFilename ?? 'file'}]`
        : '[media]'
        : text;

      const [userMsg] = await db.insert(orchestratorChats).values({
        conversationId, role: 'user', content: placeholder,
      }).returning({ id: orchestratorChats.id });

      let attachment: JkaiAttachment | null = null;
      if (mediaKind && mediaBuffer && mediaMimeType) {
        const ext = extensionForMime(mediaMimeType);
        const { diskPath, sizeBytes } = await saveBuffer(mediaBuffer, ext);
        const [row] = await db.insert(jkaiAttachments).values({
          conversationId, messageId: userMsg.id,
          source: 'whatsapp',
          kind: mediaKind === 'document' ? 'document' : mediaKind,
          mimeType: mediaMimeType,
          originalName: mediaFilename ?? null,
          sizeBytes, diskPath,
          duration: mediaDuration ?? null,
          metadata: { whatsappMessageId: msg.messageId },
        }).returning();
        attachment = row;
      }

      const history = (await loadConversationHistory(conversationId, null)).slice(0, -1);
      const modelContext = await resolveDefaultModel('chat');
      const { response: responseText } = await generalChat(
        { text: placeholder, attachments: attachment ? [attachment] : [] },
        history,
        { modelContext, priceSnapshot: null, conversationId },
      );

      await this.typingDoneFn?.(replyTo);

      const [asstMsg] = await db.insert(orchestratorChats).values({
        conversationId, role: 'assistant', content: responseText,
      }).returning({ id: orchestratorChats.id });

      const generatedAtts = await db.select().from(jkaiAttachments)
        .where(eq(jkaiAttachments.messageId, asstMsg.id));

      // Send: text, then each generated attachment (first image/doc gets the caption)
      if (generatedAtts.length === 0) {
        await this.sendFn(replyTo, responseText);
      } else if (this.sendMediaFn) {
        let captionSent = false;
        for (const att of generatedAtts) {
          if (!captionSent && (att.kind === 'image' || att.kind === 'document')) {
            await this.sendMediaFn(replyTo, att, responseText);
            captionSent = true;
          } else {
            await this.sendMediaFn(replyTo, att);
          }
        }
        if (!captionSent) await this.sendFn(replyTo, responseText);
      } else {
        await this.sendFn(replyTo, responseText);
      }
    } catch (err: unknown) {
      await this.typingDoneFn?.(replyTo);
      console.error(`[whatsapp-bridge] error from ${from}:`, err);
      await this.sendFn(replyTo, 'Something went wrong. Try again in a moment.');
    }
  }

  private async clearConversation(phoneNumber: string): Promise<void> {
    const convId = await this.resolveConversationId(phoneNumber);
    await db.delete(orchestratorChats).where(eq(orchestratorChats.conversationId, convId));
  }
}
```

- [ ] **Step 3: Remove whatsappConversations imports across codebase**

```bash
grep -rn "whatsappConversations\|whatsapp_conversations" src/ --include="*.ts" --include="*.svelte"
```

Delete usages from `src/routes/api/jkai/whatsapp-thread/+server.ts` and anywhere else they appear. Replace WhatsApp-thread queries with queries against `conversations` + `orchestratorChats` where `conversations.source = 'whatsapp'`.

- [ ] **Step 4: Drop the old table**

```bash
psql "postgresql://app:test@localhost:5433/strange_rambling" -c "DROP TABLE IF EXISTS whatsapp_conversations;"
```

- [ ] **Step 5: Typecheck + run tests**

```bash
npm run check && npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/whatsapp/service.ts src/lib/workflows/whatsapp/orchestrator-bridge.ts src/routes/api/jkai/whatsapp-thread/+server.ts
git commit -m "feat(jkai): unify whatsapp messages into orchestratorChats, pass media attachments"
```

---

## Task 14: WhatsApp outbound — send media methods

**Files:**
- Modify: `src/lib/workflows/whatsapp/service.ts`

- [ ] **Step 1: Add send methods**

In `src/lib/workflows/whatsapp/service.ts`, add after the existing `sendMessage`:

```ts
import { readBuffer } from '$lib/jkai/media/storage';
import type { JkaiAttachment } from '$lib/db/schema';

async sendImage(to: string, att: JkaiAttachment, caption?: string): Promise<WhatsAppSendResult> {
  if (!this.sock || this.status !== 'connected') return { sent: false, error: 'WhatsApp not connected' };
  try {
    const jid = to.includes('@') ? to : this.toJid(to);
    const buf = await readBuffer(att.diskPath);
    const result = await this.sock.sendMessage(jid, {
      image: buf, mimetype: att.mimeType, caption: caption ?? undefined,
    });
    return { sent: true, messageId: result?.key?.id || undefined };
  } catch (err: unknown) {
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async sendAudio(to: string, att: JkaiAttachment): Promise<WhatsAppSendResult> {
  if (!this.sock || this.status !== 'connected') return { sent: false, error: 'WhatsApp not connected' };
  try {
    const jid = to.includes('@') ? to : this.toJid(to);
    const buf = await readBuffer(att.diskPath);
    const result = await this.sock.sendMessage(jid, {
      audio: buf, mimetype: att.mimeType, ptt: true,
    });
    return { sent: true, messageId: result?.key?.id || undefined };
  } catch (err: unknown) {
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async sendDocument(to: string, att: JkaiAttachment, caption?: string): Promise<WhatsAppSendResult> {
  if (!this.sock || this.status !== 'connected') return { sent: false, error: 'WhatsApp not connected' };
  try {
    const jid = to.includes('@') ? to : this.toJid(to);
    const buf = await readBuffer(att.diskPath);
    const result = await this.sock.sendMessage(jid, {
      document: buf, mimetype: att.mimeType,
      fileName: att.originalName ?? 'document',
      caption: caption ?? undefined,
    });
    return { sent: true, messageId: result?.key?.id || undefined };
  } catch (err: unknown) {
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async sendAttachment(to: string, att: JkaiAttachment, caption?: string): Promise<WhatsAppSendResult> {
  if (att.kind === 'image') return this.sendImage(to, att, caption);
  if (att.kind === 'audio') return this.sendAudio(to, att);
  if (att.kind === 'video') {
    if (!this.sock) return { sent: false, error: 'WhatsApp not connected' };
    const jid = to.includes('@') ? to : this.toJid(to);
    const buf = await readBuffer(att.diskPath);
    const result = await this.sock.sendMessage(jid, { video: buf, mimetype: att.mimeType, caption });
    return { sent: true, messageId: result?.key?.id };
  }
  return this.sendDocument(to, att, caption);
}
```

- [ ] **Step 2: Wire `sendMediaFn` in the bridge construction**

Find where the bridge is constructed in `service.ts` (likely near the bottom of the class). Change:
```ts
this.bridge = new OrchestratorBridge((to, text) => this.sendMessage(to, text), ...);
```
to:
```ts
this.bridge = new OrchestratorBridge(
  (to, text) => this.sendMessage(to, text),
  {
    sendMediaFn: (to, att, caption) => this.sendAttachment(to, att, caption),
    typingFn: (to) => this.sendTypingIndicator(to),
    typingDoneFn: (to) => this.stopTypingIndicator(to),
  },
);
```
Adjust the typing-indicator calls to whatever the existing method names are — grep for them in `service.ts`.

- [ ] **Step 3: Typecheck**

```bash
npm run check
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/whatsapp/service.ts
git commit -m "feat(jkai): whatsapp outbound send for image/audio/video/document"
```

---

## Task 15: Generation tool — `write_document`

**Files:**
- Create: `src/lib/workflows/site-tools/tools/media-write-document.ts`
- Modify: `src/lib/workflows/site-tools/registry.ts`
- Test: `tests/lib/workflows/site-tools/media-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/media-tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;
const inserted: any[] = [];

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({ values: (v: any) => ({ returning: async () => { inserted.push(v); return [{ ...v, id: 'att-new', createdAt: new Date() }]; } }) }),
  },
}));
vi.mock('$lib/db/schema', () => ({ jkaiAttachments: {} }));

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jkai-tool-test-'));
  vi.stubEnv('JKAI_MEDIA_ROOT', tmpRoot);
  inserted.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('write_document', () => {
  it('saves text to disk and returns attachment ref', async () => {
    const { handleWriteDocument } = await import('$lib/workflows/site-tools/tools/media-write-document');
    const out = await handleWriteDocument({ filename: 'report.md', content: '# Hello', format: 'markdown' }, { conversationId: 'c1', messageId: null });
    expect(out.success).toBe(true);
    expect(out.attachments[0].kind).toBe('text');
    expect(out.attachments[0].mimeType).toBe('text/markdown');
    expect(inserted.length).toBe(1);
  });

  it('rejects filenames with path separators', async () => {
    const { handleWriteDocument } = await import('$lib/workflows/site-tools/tools/media-write-document');
    const out = await handleWriteDocument({ filename: '../../etc/passwd', content: 'x' }, { conversationId: 'c1', messageId: null });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/filename/i);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/lib/workflows/site-tools/media-tools.test.ts
```

- [ ] **Step 3: Implement the handler**

Create `src/lib/workflows/site-tools/tools/media-write-document.ts`:

```ts
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { saveBuffer } from '$lib/jkai/media/storage';
import { extensionForMime } from '$lib/jkai/media/mime';
import type { JkaiAttachment } from '$lib/db/schema';

const FORMAT_MIME: Record<string, { mime: string; kind: 'text' | 'document' }> = {
  markdown: { mime: 'text/markdown', kind: 'text' },
  text: { mime: 'text/plain', kind: 'text' },
  csv: { mime: 'text/csv', kind: 'text' },
  json: { mime: 'application/json', kind: 'text' },
  code: { mime: 'text/plain', kind: 'text' },
};

const EXT_FALLBACK: Record<string, keyof typeof FORMAT_MIME> = {
  md: 'markdown', markdown: 'markdown',
  txt: 'text', log: 'text',
  csv: 'csv', tsv: 'csv',
  json: 'json',
  ts: 'code', js: 'code', py: 'code', go: 'code', rs: 'code', c: 'code', cpp: 'code', sh: 'code',
};

export interface WriteDocumentArgs {
  filename: string;
  content: string;
  format?: 'markdown' | 'text' | 'csv' | 'json' | 'code';
}

export interface ToolContext {
  conversationId: string | null;
  messageId: string | null;
}

export interface WriteDocumentResult {
  success: boolean;
  error?: string;
  attachments?: JkaiAttachment[];
}

function sanitizeFilename(name: string): string | null {
  if (!name || name.length > 255) return null;
  if (/[\/\\\0]/.test(name)) return null;
  if (name.startsWith('.')) return null;
  return name;
}

export async function handleWriteDocument(
  args: WriteDocumentArgs,
  ctx: ToolContext,
): Promise<WriteDocumentResult> {
  const clean = sanitizeFilename(args.filename);
  if (!clean) return { success: false, error: 'invalid filename' };

  const ext = (clean.split('.').pop() ?? '').toLowerCase();
  const format = args.format ?? EXT_FALLBACK[ext] ?? 'text';
  const { mime, kind } = FORMAT_MIME[format];

  if (typeof args.content !== 'string') return { success: false, error: 'content must be a string' };
  if (args.content.length > 2 * 1024 * 1024) return { success: false, error: 'content exceeds 2MB' };

  const buf = Buffer.from(args.content, 'utf8');
  const { diskPath, sizeBytes } = await saveBuffer(buf, extensionForMime(mime));

  const [row] = await db.insert(jkaiAttachments).values({
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    source: 'generated',
    kind,
    mimeType: mime,
    originalName: clean,
    sizeBytes,
    diskPath,
    duration: null,
    metadata: { format },
  }).returning();

  return { success: true, attachments: [row] };
}

export const writeDocumentTool = {
  name: 'write_document',
  description: 'Save text content (markdown, code, CSV, JSON, plain text) as a downloadable file attached to the conversation. Use for reports, exports, code snippets, and anything the user might want to reuse or share as a file.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Filename with extension, no path separators (e.g. "report.md").' },
      content: { type: 'string', description: 'File contents (UTF-8, max 2MB).' },
      format: { type: 'string', enum: ['markdown', 'text', 'csv', 'json', 'code'], description: 'Optional; inferred from extension when omitted.' },
    },
    required: ['filename', 'content'],
  },
  category: 'media',
};
```

- [ ] **Step 4: Register the tool**

In `src/lib/workflows/site-tools/registry.ts`, import the tool and add a `register(...)` call alongside the existing registrations. Find the `register()` helper usage for any other tool (e.g. `register(createBlogPostTool, handleCreateBlogPost)`) and add at the bottom:

```ts
import { writeDocumentTool, handleWriteDocument } from './tools/media-write-document';

register(writeDocumentTool, async (args, ctx) => {
  return handleWriteDocument(args as any, {
    conversationId: ctx.conversationId ?? null,
    messageId: ctx.messageId ?? null,
  });
});
```

If the executor's `ctx` does not currently include `messageId`, extend it — grep `ToolExecutionContext` and add `messageId?: string | null`. Thread the value through from where the tool is called inside `general-chat.ts` (set after the assistant message is created).

- [ ] **Step 5: Run test — expect pass**

```bash
npx vitest run tests/lib/workflows/site-tools/media-tools.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/site-tools/tools/media-write-document.ts src/lib/workflows/site-tools/registry.ts tests/lib/workflows/site-tools/media-tools.test.ts
git commit -m "feat(jkai): add write_document tool"
```

---

## Task 16: Generation tool — `generate_image` (OpenRouter FLUX)

**Files:**
- Create: `src/lib/workflows/site-tools/tools/media-generate-image.ts`
- Modify: `src/lib/workflows/site-tools/registry.ts`
- Test: append to `tests/lib/workflows/site-tools/media-tools.test.ts`

- [ ] **Step 1: Extend the test file**

Append to `tests/lib/workflows/site-tools/media-tools.test.ts`:

```ts
describe('generate_image', () => {
  it('calls OpenRouter, saves the image, returns attachment', async () => {
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.includes('openrouter.ai')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: [{ type: 'image_url', image_url: { url: 'https://fake.example/x.png' } }] } }],
        }), { status: 200 });
      }
      return new Response(fakePng, { status: 200, headers: { 'content-type': 'image/png' } });
    }) as any;

    vi.doMock('$lib/server/models/settings', () => ({
      getOpenRouterApiKey: vi.fn(async () => 'or-test'),
    }));
    const { handleGenerateImage } = await import('$lib/workflows/site-tools/tools/media-generate-image');
    const out = await handleGenerateImage(
      { prompt: 'a cat', aspect_ratio: '1:1', count: 1 },
      { conversationId: 'c1', messageId: null },
    );
    expect(out.success).toBe(true);
    expect(out.attachments?.[0].kind).toBe('image');
  });
});
```

- [ ] **Step 2: Implement the handler**

Create `src/lib/workflows/site-tools/tools/media-generate-image.ts`:

```ts
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { saveBuffer } from '$lib/jkai/media/storage';
import { getOpenRouterApiKey } from '$lib/server/models/settings';
import type { JkaiAttachment } from '$lib/db/schema';
import type { ToolContext } from './media-write-document';

export interface GenerateImageArgs {
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  count?: number;
}

export interface GenerateImageResult {
  success: boolean;
  error?: string;
  attachments?: JkaiAttachment[];
}

const DEFAULT_MODEL = process.env.JKAI_IMAGE_MODEL ?? 'black-forest-labs/flux-1.1-pro';

export async function handleGenerateImage(
  args: GenerateImageArgs,
  ctx: ToolContext,
): Promise<GenerateImageResult> {
  const apiKey = await getOpenRouterApiKey();
  if (!apiKey) return { success: false, error: 'OpenRouter API key not configured' };
  if (!args.prompt || args.prompt.length < 2) return { success: false, error: 'prompt required' };
  const count = Math.min(Math.max(args.count ?? 1, 1), 4);
  const aspect = args.aspect_ratio ?? '1:1';

  const attachments: JkaiAttachment[] = [];

  for (let i = 0; i < count; i++) {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://strangeramblings.com/jkai',
        'X-Title': 'JKAI',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: `${args.prompt}\n\naspect_ratio: ${aspect}` }],
        modalities: ['image', 'text'],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { success: attachments.length > 0, error: `OpenRouter ${resp.status}: ${errText}`, attachments };
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    let imageUrl: string | null = null;
    if (Array.isArray(content)) {
      const imgPart = content.find((p: any) => p.type === 'image_url');
      imageUrl = imgPart?.image_url?.url ?? null;
    } else if (typeof content === 'string' && content.startsWith('data:image/')) {
      imageUrl = content;
    }
    if (!imageUrl) return { success: false, error: 'OpenRouter returned no image' };

    let buf: Buffer;
    let mime = 'image/png';
    if (imageUrl.startsWith('data:')) {
      const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return { success: false, error: 'invalid image data URL' };
      mime = m[1];
      buf = Buffer.from(m[2], 'base64');
    } else {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return { success: false, error: `image download ${imgRes.status}` };
      mime = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/png';
      buf = Buffer.from(await imgRes.arrayBuffer());
    }
    const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'png';
    const { diskPath, sizeBytes } = await saveBuffer(buf, ext);
    const [row] = await db.insert(jkaiAttachments).values({
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      source: 'generated',
      kind: 'image',
      mimeType: mime,
      originalName: `${args.prompt.slice(0, 40).replace(/[^a-z0-9]/gi, '_')}.${ext}`,
      sizeBytes, diskPath, duration: null,
      metadata: { prompt: args.prompt, model: DEFAULT_MODEL, aspectRatio: aspect },
    }).returning();
    attachments.push(row);
  }

  return { success: true, attachments };
}

export const generateImageTool = {
  name: 'generate_image',
  description: 'Generate one to four images from a text prompt. Saves each image as a conversation attachment the user can view and download inline.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Descriptive text prompt for the image.' },
      aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio; default 1:1.' },
      count: { type: 'integer', minimum: 1, maximum: 4, description: 'Number of images to produce; default 1.' },
    },
    required: ['prompt'],
  },
  category: 'media',
};
```

- [ ] **Step 3: Register**

Append to the registry import block + registration in `src/lib/workflows/site-tools/registry.ts`:

```ts
import { generateImageTool, handleGenerateImage } from './tools/media-generate-image';

register(generateImageTool, async (args, ctx) => {
  return handleGenerateImage(args as any, {
    conversationId: ctx.conversationId ?? null,
    messageId: ctx.messageId ?? null,
  });
});
```

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run tests/lib/workflows/site-tools/media-tools.test.ts
git add src/lib/workflows/site-tools/tools/media-generate-image.ts src/lib/workflows/site-tools/registry.ts tests/lib/workflows/site-tools/media-tools.test.ts
git commit -m "feat(jkai): add generate_image tool (OpenRouter)"
```

---

## Task 17: Generation tool — `generate_audio_tts` (ElevenLabs)

**Files:**
- Create: `src/lib/workflows/site-tools/tools/media-generate-audio-tts.ts`
- Modify: `src/lib/deepdive/keys.ts` (add ELEVENLABS_API_KEY)
- Modify: `src/lib/workflows/site-tools/registry.ts`

- [ ] **Step 1: Extend keys module**

Open `src/lib/deepdive/keys.ts`. Add to the loaded keys object:

```ts
// inside the loadKeys() result type + body:
elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? getFromKeysJson('elevenlabs_api_key') ?? '',
```

Match the existing idiom for reading from `keys.json` (grep for `zai_api_key` — follow the same pattern).

- [ ] **Step 2: Write the handler**

Create `src/lib/workflows/site-tools/tools/media-generate-audio-tts.ts`:

```ts
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { saveBuffer } from '$lib/jkai/media/storage';
import { loadKeys } from '$lib/deepdive/keys';
import type { JkaiAttachment } from '$lib/db/schema';
import type { ToolContext } from './media-write-document';

const DEFAULT_MODEL = process.env.JKAI_TTS_MODEL ?? 'eleven_turbo_v2_5';
const DEFAULT_VOICE = process.env.JKAI_TTS_VOICE ?? '21m00Tcm4TlvDq8ikWAM'; // Rachel, ElevenLabs default
const MAX_CHARS = 5000;

export interface GenerateAudioTtsArgs {
  text: string;
  voice?: string;
  model?: 'eleven_turbo_v2_5' | 'eleven_multilingual_v2';
}

export interface GenerateAudioTtsResult {
  success: boolean;
  error?: string;
  attachments?: JkaiAttachment[];
}

export async function handleGenerateAudioTts(
  args: GenerateAudioTtsArgs,
  ctx: ToolContext,
): Promise<GenerateAudioTtsResult> {
  const { elevenlabsApiKey } = loadKeys() as any;
  if (!elevenlabsApiKey) return { success: false, error: 'ElevenLabs API key not configured' };
  if (!args.text || args.text.length < 1) return { success: false, error: 'text required' };
  if (args.text.length > MAX_CHARS) return { success: false, error: `text exceeds ${MAX_CHARS} chars` };

  const voice = args.voice ?? DEFAULT_VOICE;
  const model = args.model ?? DEFAULT_MODEL;

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': elevenlabsApiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: args.text, model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.7 },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    return { success: false, error: `ElevenLabs ${resp.status}: ${errText}` };
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const { diskPath, sizeBytes } = await saveBuffer(buf, 'mp3');
  const [row] = await db.insert(jkaiAttachments).values({
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    source: 'generated',
    kind: 'audio',
    mimeType: 'audio/mpeg',
    originalName: `tts-${Date.now()}.mp3`,
    sizeBytes, diskPath, duration: null,
    metadata: { text: args.text.slice(0, 200), voice, model, characters: args.text.length },
  }).returning();
  return { success: true, attachments: [row] };
}

export const generateAudioTtsTool = {
  name: 'generate_audio_tts',
  description: 'Synthesise spoken audio (MP3) from text using ElevenLabs. Saves as a conversation attachment. Use when the user asks you to speak, read aloud, or produce a voice note.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to speak (max 5000 chars).' },
      voice: { type: 'string', description: 'ElevenLabs voice ID. Optional; uses default.' },
      model: { type: 'string', enum: ['eleven_turbo_v2_5', 'eleven_multilingual_v2'], description: 'Optional model.' },
    },
    required: ['text'],
  },
  category: 'media',
};
```

- [ ] **Step 3: Register**

Append to `registry.ts`:

```ts
import { generateAudioTtsTool, handleGenerateAudioTts } from './tools/media-generate-audio-tts';

register(generateAudioTtsTool, async (args, ctx) => {
  return handleGenerateAudioTts(args as any, {
    conversationId: ctx.conversationId ?? null,
    messageId: ctx.messageId ?? null,
  });
});
```

- [ ] **Step 4: Document the env var**

Append to `.env.example` (or equivalent):
```
# ElevenLabs (text-to-speech)
ELEVENLABS_API_KEY=

# Optional overrides
JKAI_TTS_VOICE=21m00Tcm4TlvDq8ikWAM
JKAI_TTS_MODEL=eleven_turbo_v2_5
JKAI_IMAGE_MODEL=black-forest-labs/flux-1.1-pro
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/site-tools/tools/media-generate-audio-tts.ts src/lib/workflows/site-tools/registry.ts src/lib/deepdive/keys.ts .env.example
git commit -m "feat(jkai): add generate_audio_tts tool (ElevenLabs)"
```

---

## Task 18: Rate limits for generation tools

**Files:**
- Create: `src/lib/jkai/media/rate-limits.ts`
- Modify: the two generation tool handlers
- Test: `tests/lib/jkai/media/rate-limits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/media/rate-limits.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ count: '5' }] }) }),
  },
}));

describe('checkImageQuota', () => {
  it('allows when under limit', async () => {
    const { checkImageQuota } = await import('$lib/jkai/media/rate-limits');
    const r = await checkImageQuota('conv-1', 1);
    expect(r.allowed).toBe(true);
  });
  it('rejects when count would exceed', async () => {
    const { checkImageQuota } = await import('$lib/jkai/media/rate-limits');
    const r = await checkImageQuota('conv-1', 20); // 5 used + 20 requested > 20
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/limit/i);
  });
});
```

- [ ] **Step 2: Implement rate-limit checks**

Create `src/lib/jkai/media/rate-limits.ts`:

```ts
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

const IMAGE_LIMIT_PER_DAY = Number(process.env.JKAI_IMAGE_LIMIT_PER_DAY ?? 20);
const TTS_CHAR_LIMIT_PER_DAY = Number(process.env.JKAI_TTS_CHAR_LIMIT_PER_DAY ?? 50000);

export interface QuotaResult { allowed: boolean; reason?: string; used: number; limit: number; }

export async function checkImageQuota(conversationId: string, requested: number): Promise<QuotaResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<string>`count(*)` })
    .from(jkaiAttachments)
    .where(and(
      eq(jkaiAttachments.conversationId, conversationId),
      eq(jkaiAttachments.kind, 'image'),
      eq(jkaiAttachments.source, 'generated'),
      gte(jkaiAttachments.createdAt, since),
    ));
  const used = Number(rows[0]?.count ?? 0);
  if (used + requested > IMAGE_LIMIT_PER_DAY) {
    return { allowed: false, reason: `image generation limit (${IMAGE_LIMIT_PER_DAY}/24h) would be exceeded`, used, limit: IMAGE_LIMIT_PER_DAY };
  }
  return { allowed: true, used, limit: IMAGE_LIMIT_PER_DAY };
}

export async function checkTtsQuota(conversationId: string, charsRequested: number): Promise<QuotaResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ total: sql<string>`coalesce(sum((metadata->>'characters')::int), 0)` })
    .from(jkaiAttachments)
    .where(and(
      eq(jkaiAttachments.conversationId, conversationId),
      eq(jkaiAttachments.kind, 'audio'),
      eq(jkaiAttachments.source, 'generated'),
      gte(jkaiAttachments.createdAt, since),
    ));
  const used = Number(rows[0]?.total ?? 0);
  if (used + charsRequested > TTS_CHAR_LIMIT_PER_DAY) {
    return { allowed: false, reason: `TTS char budget (${TTS_CHAR_LIMIT_PER_DAY}/24h) would be exceeded`, used, limit: TTS_CHAR_LIMIT_PER_DAY };
  }
  return { allowed: true, used, limit: TTS_CHAR_LIMIT_PER_DAY };
}
```

- [ ] **Step 3: Wire into generation tools**

In `media-generate-image.ts`, at the top of `handleGenerateImage` after argument validation:

```ts
import { checkImageQuota } from '$lib/jkai/media/rate-limits';
// ...
if (ctx.conversationId) {
  const q = await checkImageQuota(ctx.conversationId, count);
  if (!q.allowed) return { success: false, error: q.reason };
}
```

In `media-generate-audio-tts.ts`:

```ts
import { checkTtsQuota } from '$lib/jkai/media/rate-limits';
// ...
if (ctx.conversationId) {
  const q = await checkTtsQuota(ctx.conversationId, args.text.length);
  if (!q.allowed) return { success: false, error: q.reason };
}
```

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run tests/lib/jkai/media/rate-limits.test.ts
git add src/lib/jkai/media/rate-limits.ts src/lib/workflows/site-tools/tools/media-generate-image.ts src/lib/workflows/site-tools/tools/media-generate-audio-tts.ts tests/lib/jkai/media/rate-limits.test.ts
git commit -m "feat(jkai): per-conversation 24h quotas for image + tts generation"
```

---

## Task 19: Prompt + classifier updates for media toolset

**Files:**
- Modify: `data/prompts/02-capabilities.md`
- Modify: `data/prompts/03-tools.md`
- Modify: `src/lib/workflows/site-tools/keyword-classifier.ts`

- [ ] **Step 1: Add Creating Media section to capabilities prompt**

Append to `data/prompts/02-capabilities.md`:

```markdown

## Creating media

You can produce files as part of your replies when the user asks. Available tools:

- `write_document` — save text content (markdown, code, CSV, JSON, plain text) as a downloadable file.
- `generate_image` — synthesise an image from a prompt. Use for illustrations, mockups, and visual responses.
- `generate_audio_tts` — convert text to spoken audio (MP3). Use when the user asks you to speak, read aloud, or produce a voice note.

Generated files become conversation attachments the user can view and download inline (or receive over WhatsApp). Reference them in your reply (e.g. "Here's the chart I made") — the UI renders them after your message.

Prefer inline markdown/code blocks for small things the user can just read. Use `write_document` when the output is long, meant to be reused, or the user explicitly asks for a file.
```

- [ ] **Step 2: Add media tools section to tools prompt**

Append to `data/prompts/03-tools.md`:

```markdown

### Media toolset

Activate with `activate_toolset("media")`. Tools:

- `write_document(filename, content, format?)` — save a text/code/data file.
- `generate_image(prompt, aspect_ratio?, count?)` — make an image.
- `generate_audio_tts(text, voice?, model?)` — synthesise speech.
```

- [ ] **Step 3: Add `media` triggers to keyword classifier**

Open `src/lib/workflows/site-tools/keyword-classifier.ts`. Find the `TOOLSET_KEYWORDS` (or equivalent) map and add:

```ts
media: [
  'image', 'photo', 'picture', 'draw', 'render', 'illustrate', 'sketch',
  'audio', 'voice', 'speak', 'say out loud', 'read this', 'read aloud',
  'document', 'report', 'csv', 'save as', 'export', 'write a file', 'write to file',
  'generate an image', 'make an image', 'generate audio', 'make a voice',
],
```

- [ ] **Step 4: Commit**

```bash
git add data/prompts/02-capabilities.md data/prompts/03-tools.md src/lib/workflows/site-tools/keyword-classifier.ts
git commit -m "feat(jkai): prompt + classifier entries for media toolset"
```

---

## Task 20: Conversation endpoint exposes model capabilities + attachments

**Files:**
- Modify: `src/routes/api/jkai/conversations/[id]/+server.ts`

- [ ] **Step 1: Join attachments and include caps**

Open `src/routes/api/jkai/conversations/[id]/+server.ts`. At the top add:

```ts
import { jkaiAttachments } from '$lib/db/schema';
import { getModelCapabilities } from '$lib/server/models/capabilities';
```

Find the block that returns messages. After fetching messages, add:

```ts
const messageIds = messages.map((m: any) => m.id);
const allAttachments = messageIds.length > 0
  ? await db.select().from(jkaiAttachments).where(inArray(jkaiAttachments.messageId, messageIds))
  : [];
const attachmentsByMsg = new Map<string, typeof allAttachments>();
for (const a of allAttachments) {
  const arr = attachmentsByMsg.get(a.messageId!) ?? [];
  arr.push(a); attachmentsByMsg.set(a.messageId!, arr);
}
const messagesWithAttachments = messages.map((m: any) => ({
  ...m,
  attachments: attachmentsByMsg.get(m.id) ?? [],
}));

const caps = getModelCapabilities({
  provider: conversation.modelProvider as 'zai' | 'openrouter',
  modelId: conversation.modelId,
});

return json({
  conversation,
  messages: messagesWithAttachments,
  modelCapabilities: caps,
});
```

Ensure `inArray` is imported from `drizzle-orm`.

- [ ] **Step 2: Typecheck + commit**

```bash
npm run check
git add src/routes/api/jkai/conversations/\[id\]/+server.ts
git commit -m "feat(jkai): conversation endpoint returns attachments + capabilities"
```

---

## Task 21: `MessageAttachments.svelte` renderer

**Files:**
- Create: `src/lib/components/jkai/MessageAttachments.svelte`

- [ ] **Step 1: Implement the component**

Create `src/lib/components/jkai/MessageAttachments.svelte`:

```svelte
<script lang="ts">
  interface Attachment {
    id: string;
    kind: 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';
    mimeType: string;
    originalName: string | null;
    sizeBytes: number;
    source: 'web' | 'whatsapp' | 'generated';
  }

  let { attachments = [] }: { attachments: Attachment[] } = $props();
  let lightbox = $state<Attachment | null>(null);

  function fmtSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function iconFor(kind: string): string {
    switch (kind) {
      case 'pdf': return '📄';
      case 'document': return '📎';
      case 'text': return '📝';
      case 'video': return '🎬';
      default: return '📁';
    }
  }
</script>

{#if attachments.length > 0}
  <div class="flex flex-col gap-2 mt-2">
    {#each attachments as att (att.id)}
      {#if att.kind === 'image'}
        <button
          type="button"
          class="block max-w-xs rounded overflow-hidden"
          onclick={() => { lightbox = att; }}
          aria-label={att.originalName ?? 'image'}
        >
          <img src={`/api/jkai/attachments/${att.id}`} alt={att.originalName ?? 'image'} class="w-full h-auto" loading="lazy" />
          {#if att.source === 'generated'}
            <span class="text-xs opacity-60 block mt-1">generated</span>
          {/if}
        </button>
      {:else if att.kind === 'audio'}
        <div class="flex flex-col gap-1">
          <audio controls src={`/api/jkai/attachments/${att.id}`} class="max-w-sm"></audio>
          <span class="text-xs opacity-60">{att.originalName ?? 'audio'} · {fmtSize(att.sizeBytes)}{att.source === 'generated' ? ' · generated' : ''}</span>
        </div>
      {:else if att.kind === 'video'}
        <div class="flex flex-col gap-1">
          <video controls src={`/api/jkai/attachments/${att.id}`} class="max-w-sm rounded"></video>
          <span class="text-xs opacity-60">{att.originalName ?? 'video'} · {fmtSize(att.sizeBytes)}</span>
        </div>
      {:else}
        <a
          href={`/api/jkai/attachments/${att.id}`}
          download={att.originalName ?? undefined}
          class="inline-flex items-center gap-2 px-3 py-2 rounded border max-w-xs"
          style="border-color: var(--border); background: var(--bg-subtle);"
        >
          <span>{iconFor(att.kind)}</span>
          <span class="flex-1 min-w-0 truncate">{att.originalName ?? att.kind}</span>
          <span class="text-xs opacity-60">{fmtSize(att.sizeBytes)}</span>
        </a>
      {/if}
    {/each}
  </div>

  {#if lightbox}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(0,0,0,0.8);"
      onclick={() => { lightbox = null; }}
    >
      <img src={`/api/jkai/attachments/${lightbox.id}`} alt={lightbox.originalName ?? ''} class="max-w-full max-h-full" />
    </div>
  {/if}
{/if}
```

- [ ] **Step 2: Wire into ChatArea message rendering**

In `src/lib/components/jkai/ChatArea.svelte`, import `MessageAttachments` at the top:

```svelte
import MessageAttachments from './MessageAttachments.svelte';
```

Find the message rendering loop (where each message's `content` is shown). Immediately after the message body (inside the same message container), add:

```svelte
{#if message.attachments?.length > 0}
  <MessageAttachments attachments={message.attachments} />
{/if}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/jkai/MessageAttachments.svelte src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): render attachments inline in chat messages"
```

---

## Task 22: Composer — paperclip + drag-drop + paste + tray

**Files:**
- Create: `src/lib/components/jkai/ComposerAttachmentTray.svelte`
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Implement the tray**

Create `src/lib/components/jkai/ComposerAttachmentTray.svelte`:

```svelte
<script lang="ts">
  interface PendingAttachment {
    id: string;
    kind: string;
    mimeType: string;
    originalName: string | null;
    sizeBytes: number;
    uploading?: boolean;
    uploadProgress?: number;
    error?: string;
    incompatible?: boolean;
  }

  let { items = [], onRemove }: { items: PendingAttachment[]; onRemove: (id: string) => void } = $props();

  function fmtSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

{#if items.length > 0}
  <div class="flex gap-2 overflow-x-auto py-2 px-1 border-b" style="border-color: var(--border);">
    {#each items as it (it.id)}
      <div
        class="relative flex items-center gap-2 px-2 py-1 rounded border min-w-[180px] max-w-[240px]"
        style={`border-color: ${it.incompatible ? 'var(--danger, #c0392b)' : 'var(--border)'}; background: var(--bg-subtle);`}
        title={it.incompatible ? `${it.originalName} — not supported by current model` : it.originalName ?? it.kind}
      >
        {#if it.kind === 'image'}
          <img src={`/api/jkai/attachments/${it.id}`} alt="" class="w-8 h-8 object-cover rounded" />
        {:else if it.kind === 'audio'}<span>🎙️</span>
        {:else if it.kind === 'video'}<span>🎬</span>
        {:else if it.kind === 'pdf'}<span>📄</span>
        {:else}<span>📎</span>{/if}
        <div class="flex-1 min-w-0">
          <div class="text-sm truncate">{it.originalName ?? it.kind}</div>
          <div class="text-xs opacity-60">{fmtSize(it.sizeBytes)}</div>
        </div>
        <button type="button" onclick={() => onRemove(it.id)} aria-label="remove" class="opacity-60 hover:opacity-100">×</button>
        {#if it.uploading}
          <div class="absolute left-0 bottom-0 h-0.5" style={`width: ${it.uploadProgress ?? 0}%; background: var(--accent);`}></div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 2: Add composer state and handlers to ChatArea**

In `src/lib/components/jkai/ChatArea.svelte`, add to the script:

```svelte
import ComposerAttachmentTray from './ComposerAttachmentTray.svelte';

interface PendingAttachment {
  id: string;
  kind: string;
  mimeType: string;
  originalName: string | null;
  sizeBytes: number;
  uploading?: boolean;
  uploadProgress?: number;
  error?: string;
  incompatible?: boolean;
}

let pendingAttachments = $state<PendingAttachment[]>([]);
let dragOver = $state(false);
let fileInputEl: HTMLInputElement | undefined = $state();
let modelCapabilities = $state<{ image: boolean; audio: boolean; video: boolean; pdf: boolean; documentText: boolean } | null>(null);

function acceptAttrForCaps(): string {
  if (!modelCapabilities) return '*/*';
  const parts: string[] = [];
  if (modelCapabilities.image) parts.push('image/*');
  if (modelCapabilities.audio) parts.push('audio/*');
  if (modelCapabilities.video) parts.push('video/*');
  if (modelCapabilities.pdf) parts.push('application/pdf');
  if (modelCapabilities.documentText) parts.push('text/*', 'application/json');
  return parts.join(',') || '*/*';
}

async function uploadOne(file: File): Promise<void> {
  const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
  pendingAttachments.push({
    id: tempId, kind: 'unknown', mimeType: file.type, originalName: file.name,
    sizeBytes: file.size, uploading: true, uploadProgress: 0,
  });
  const fd = new FormData();
  fd.append('file', file);
  if (conversationId) fd.append('conversationId', conversationId);
  try {
    const res = await fetch('/api/jkai/attachments', { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const idx = pendingAttachments.findIndex((a) => a.id === tempId);
      if (idx >= 0) pendingAttachments[idx] = { ...pendingAttachments[idx], uploading: false, error: err.error ?? `upload ${res.status}` };
      return;
    }
    const row = await res.json();
    const idx = pendingAttachments.findIndex((a) => a.id === tempId);
    if (idx >= 0) pendingAttachments[idx] = { ...row, uploading: false, uploadProgress: 100 };
  } catch (e: any) {
    const idx = pendingAttachments.findIndex((a) => a.id === tempId);
    if (idx >= 0) pendingAttachments[idx] = { ...pendingAttachments[idx], uploading: false, error: e?.message ?? 'upload failed' };
  }
}

async function removeAttachment(id: string): Promise<void> {
  if (!id.startsWith('tmp-')) {
    await fetch(`/api/jkai/attachments/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
}

function onFilePick(e: Event): void {
  const input = e.currentTarget as HTMLInputElement;
  if (!input.files) return;
  for (const f of Array.from(input.files)) void uploadOne(f);
  input.value = '';
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  dragOver = false;
  if (!e.dataTransfer?.files) return;
  for (const f of Array.from(e.dataTransfer.files)) void uploadOne(f);
}

function onPaste(e: ClipboardEvent): void {
  if (!e.clipboardData) return;
  for (const item of Array.from(e.clipboardData.items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) void uploadOne(f);
    }
  }
}
```

Where `conversationId` and `modelCapabilities` are fetched/derived from props or loaded on conversation switch.

- [ ] **Step 3: Add markup**

In the composer markup (find the `<textarea>`), wrap with drag handlers and add the paperclip button and tray:

```svelte
<div
  class="relative"
  ondragenter={(e) => { e.preventDefault(); dragOver = true; }}
  ondragover={(e) => { e.preventDefault(); }}
  ondragleave={() => { dragOver = false; }}
  ondrop={onDrop}
>
  {#if dragOver}
    <div class="absolute inset-0 z-10 border-2 border-dashed rounded flex items-center justify-center pointer-events-none"
         style="border-color: var(--accent); background: rgba(0,0,0,0.3);">
      Drop files to attach
    </div>
  {/if}

  <ComposerAttachmentTray items={pendingAttachments} onRemove={removeAttachment} />

  <div class="flex items-end gap-1">
    <button
      type="button"
      onclick={() => fileInputEl?.click()}
      aria-label="Attach file"
      class="p-2 opacity-70 hover:opacity-100"
      title="Attach file"
    >📎</button>
    <input
      bind:this={fileInputEl}
      type="file"
      class="hidden"
      multiple
      accept={acceptAttrForCaps()}
      onchange={onFilePick}
    />

    <textarea
      onpaste={onPaste}
      ... (existing textarea props)
    ></textarea>

    <!-- existing Send button unchanged -->
  </div>
</div>
```

- [ ] **Step 4: Include attachmentIds in send**

Find the send handler. When posting to `/api/workflows/orchestrator/chat`, include:

```ts
const attachmentIds = pendingAttachments
  .filter((a) => !a.uploading && !a.error && !a.incompatible)
  .map((a) => a.id);

// body:
body: JSON.stringify({ message, conversationId, attachmentIds }),
```

After a successful send, clear the tray:
```ts
pendingAttachments = [];
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/jkai/ComposerAttachmentTray.svelte src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): composer paperclip + drag-drop + paste + attachment tray"
```

---

## Task 23: Voice-note recorder (hybrid UX)

**Files:**
- Create: `src/lib/components/jkai/VoiceRecorder.svelte`
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Implement the recorder**

Create `src/lib/components/jkai/VoiceRecorder.svelte`:

```svelte
<script lang="ts">
  let { onRecorded, disabled = false }: { onRecorded: (blob: Blob) => void | Promise<void>; disabled?: boolean } = $props();

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let recording = $state(false);
  let previewMode = $state(false);
  let previewBlob = $state<Blob | null>(null);
  let elapsed = $state(0);
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;
  let pressStart = 0;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const HOLD_THRESHOLD_MS = 300;

  async function startRecording() {
    if (recording) return;
    chunks = [];
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        previewBlob = blob;
        stream?.getTracks().forEach((t) => t.stop());
        stream = null; recorder = null;
      };
      recorder.start();
      recording = true;
      startedAt = performance.now();
      elapsed = 0;
      tickTimer = setInterval(() => { elapsed = Math.floor((performance.now() - startedAt) / 1000); }, 250);
    } catch (err) {
      console.error('mic error', err); recording = false;
    }
  }

  function stopRecording(): void {
    if (!recording) return;
    recorder?.stop();
    recording = false;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  async function onDown(e: PointerEvent) {
    if (disabled) return;
    pressStart = performance.now();
    e.currentTarget instanceof HTMLElement && e.currentTarget.setPointerCapture(e.pointerId);
    pressTimer = setTimeout(() => { void startRecording(); pressTimer = null; }, HOLD_THRESHOLD_MS);
  }

  async function onUp() {
    const heldMs = performance.now() - pressStart;
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (heldMs < HOLD_THRESHOLD_MS) {
      // Tap → toggle preview-mode recording
      if (!recording && !previewMode) {
        previewMode = true;
        await startRecording();
      } else if (recording && previewMode) {
        stopRecording();
      }
    } else if (recording && !previewMode) {
      // Hold-release → auto-send
      stopRecording();
      const blob = await awaitPreviewBlob();
      await onRecorded(blob);
      previewBlob = null;
    }
  }

  function awaitPreviewBlob(): Promise<Blob> {
    return new Promise((resolve) => {
      const iv = setInterval(() => { if (previewBlob) { clearInterval(iv); resolve(previewBlob); } }, 50);
    });
  }

  async function sendPreview() {
    if (!previewBlob) return;
    await onRecorded(previewBlob);
    previewBlob = null; previewMode = false;
  }

  function discardPreview() { previewBlob = null; previewMode = false; }
</script>

<div class="flex items-center gap-1">
  {#if previewMode && previewBlob}
    <button type="button" onclick={discardPreview} class="p-2 opacity-70 hover:opacity-100" aria-label="discard">🗑️</button>
    <audio controls src={URL.createObjectURL(previewBlob)} class="max-w-[180px]"></audio>
    <button type="button" onclick={sendPreview} class="p-2 opacity-90 hover:opacity-100" aria-label="send">✓</button>
  {:else if previewMode && recording}
    <button type="button" onclick={stopRecording} class="p-2" aria-label="stop">⏹</button>
    <span class="text-xs opacity-70">{elapsed}s</span>
  {:else}
    <button
      type="button"
      onpointerdown={onDown}
      onpointerup={onUp}
      onpointercancel={() => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } stopRecording(); previewMode = false; }}
      class="p-2 opacity-70 hover:opacity-100"
      aria-label="Record voice note"
      title="Hold to record, tap to preview"
      class:ring-2={recording}
    >🎙️</button>
    {#if recording}<span class="text-xs opacity-70">{elapsed}s</span>{/if}
  {/if}
</div>
```

- [ ] **Step 2: Wire into ChatArea**

In `ChatArea.svelte`, import and place next to the Send button:

```svelte
import VoiceRecorder from './VoiceRecorder.svelte';

async function handleVoiceBlob(blob: Blob): Promise<void> {
  const f = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
  await uploadOne(f);
}
```

In markup:
```svelte
<VoiceRecorder onRecorded={handleVoiceBlob} disabled={!modelCapabilities?.audio} />
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/jkai/VoiceRecorder.svelte src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): voice-note recorder with hybrid UX"
```

---

## Task 24: Capability gate — client-side enforcement

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Mark incompatible attachments on model switch**

In `ChatArea.svelte`, add a helper and a `$effect` that re-marks pending attachments when `modelCapabilities` changes:

```ts
function kindAllowedByCaps(kind: string, caps: typeof modelCapabilities): boolean {
  if (!caps) return true;
  switch (kind) {
    case 'image': return caps.image;
    case 'audio': return caps.audio;
    case 'video': return caps.video;
    case 'pdf':   return caps.pdf;
    case 'document':
    case 'text':  return caps.documentText;
    default: return false;
  }
}

$effect(() => {
  pendingAttachments = pendingAttachments.map((a) => ({
    ...a,
    incompatible: !kindAllowedByCaps(a.kind, modelCapabilities),
  }));
});
```

- [ ] **Step 2: Block unsupported drop/paste with a toast**

Add a tiny toast state:

```ts
let toast = $state<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  toast = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast = null; }, 4000);
}
```

Wrap `uploadOne`:

```ts
async function uploadOne(file: File): Promise<void> {
  const mimePrefix = file.type.split('/')[0];
  const probableKind = mimePrefix === 'image' ? 'image'
    : mimePrefix === 'audio' ? 'audio'
    : mimePrefix === 'video' ? 'video'
    : file.type === 'application/pdf' ? 'pdf'
    : 'text';
  if (!kindAllowedByCaps(probableKind, modelCapabilities)) {
    showToast(`This model can't read ${probableKind}. Change model to send this file.`);
    return;
  }
  // ... existing uploadOne body
}
```

Add the toast element in the markup (near the bottom of the chat panel):
```svelte
{#if toast}
  <div class="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-sm"
       style="background: var(--danger, #c0392b); color: white;">
    {toast}
  </div>
{/if}
```

- [ ] **Step 3: Disable Send when any attachment is incompatible**

Where the Send button is rendered, update its disabled condition:

```svelte
<button
  type="button"
  onclick={send}
  disabled={pendingAttachments.some((a) => a.uploading || a.incompatible) || !canSend}
  ...
```

Where `canSend` already exists.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): client-side capability gate for attachments"
```

---

## Task 25: PriceSnapshot extension + manual smoke

**Files:**
- Modify: `src/lib/server/models/types.ts`
- No code for smoke — this is a run-through checklist.

- [ ] **Step 1: Extend `PriceSnapshot`**

In `src/lib/server/models/types.ts`, find `PriceSnapshot` and add optional fields:

```ts
export interface PriceSnapshot {
  // existing fields unchanged
  imagePerImageUsd?: number;
  ttsPerCharUsd?: number;
}
```

Grep for the current usage in `src/lib/server/models/usage.ts`; extend `recordConversationUsage` (or add a sibling `recordGenerationUsage`) to accept `{ kind: 'image' | 'tts'; count?: number; chars?: number }` and compute cost from the snapshot. If the current implementation is read-only on input/output tokens, leave the extension as a TODO in the impl plan and punt concrete billing to a follow-up — do NOT block shipping on this step. Commit only the type extension.

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/models/types.ts
git commit -m "chore(jkai): extend PriceSnapshot with image + tts unit prices"
```

- [ ] **Step 3: Manual smoke (dev server)**

Start `npm run dev`, open `http://homeserv:5173/jkai` (or whichever port Vite reports). Verify the following end-to-end:

- [ ] Upload a JPEG with the paperclip, send with message "what's in this?". GLM-5 describes it. Image renders inline.
- [ ] Drag-drop a PDF onto the chat. Uploads. Ask a question about its contents. Model answers from text.
- [ ] Paste an image from clipboard. Uploads. Sends correctly.
- [ ] Short-hold mic button, release, voice note uploads and sends.
- [ ] Tap mic button: enters preview; stop, play, send works. Separately: tap, stop, discard clears preview.
- [ ] Switch model to `glm-4.5v` while a PDF is queued. PDF chip turns red, Send disables, tooltip explains.
- [ ] Drag a .mp4 while on a non-video model. Red toast appears, file not uploaded.
- [ ] Ask the model to generate an image. FLUX call returns, image renders under the assistant turn.
- [ ] Ask the model to read a paragraph aloud. ElevenLabs MP3 renders with native `<audio>` controls.
- [ ] Ask the model to "save this as a markdown report". Document chip appears with download link; downloading retrieves the file.
- [ ] From WhatsApp on John's number: send a voice note. It appears in the web chat UI under the mirrored conversation, GLM responds.
- [ ] From WhatsApp: send a photo with a caption. Appears correctly; GLM describes it.
- [ ] Ask the orchestrator (via web) to generate an image and send it to John's WhatsApp number via the `whatsapp_send_media` capability — verify delivery.

- [ ] **Step 4: Commit the "manual QA complete" marker**

No code change — this is a procedural checkpoint for subagent-driven execution. Record completion in the execution tracker.

---

## Self-Review (spec coverage)

Cross-checked the plan against `docs/superpowers/specs/2026-04-18-jkai-multimedia-io-design.md`:

- ✓ Data model (`jkai_attachments`) — Task 1.
- ✓ WhatsApp unification refactor + migration — Tasks 11–13.
- ✓ Storage layout + serve endpoint — Tasks 3, 5, 7.
- ✓ Ingest flows (web upload, voice note, WhatsApp inbound) — Tasks 6, 13, 22, 23.
- ✓ `generalChat` widening + multimodal content builder — Tasks 8, 9.
- ✓ `attachmentIds` on chat endpoint + capability gate server-side — Task 10.
- ✓ Three generation tools — Tasks 15, 16, 17.
- ✓ Model capabilities + client gate — Tasks 4, 20, 24.
- ✓ WhatsApp outbound media — Task 14.
- ✓ Web UI (composer, tray, voice recorder, message attachments) — Tasks 21, 22, 23.
- ✓ Guardrails (per-file limits at upload, per-turn encoded-size cap, per-conversation generation quotas, orphan sweep) — Tasks 6, 7, 8, 18.
- ✓ Prompt + classifier updates — Task 19.
- ✓ PriceSnapshot extension — Task 25.

No spec requirements with zero task coverage. Placeholder scan clean (no TBD/TODO content outside the explicitly-deferred PriceSnapshot billing integration flagged in Task 25).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-jkai-multimedia-io.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?

