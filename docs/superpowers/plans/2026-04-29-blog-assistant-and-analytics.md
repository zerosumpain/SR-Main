# Blog Assistant + Viewership Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-editor AI assistant for blog drafts (with mutate-and-undo tools, defaulting to the post being edited as context) and self-hosted Umami viewership analytics with stats surfaced in the admin UI.

**Architecture:** Part A — `BlogAssistantPanel.svelte` mounted in `/admin/blog/[id]`, talking to a SvelteKit SSE endpoint that runs an OpenAI-style tool-use loop against the existing `getLLMClient`. Tools mutate the post via existing repo helpers and record undo snapshots in an in-memory store. Part B — Umami container on the VPS (sharing the existing Postgres), tracker injected into `/blog/+layout.svelte`, server-side stats client with a 5-min in-memory cache, stats column on the admin list and a stats card on the editor.

**Tech Stack:** SvelteKit 2 / Svelte 5, Drizzle ORM, PostgreSQL 16, OpenAI-compatible LLM client (`src/lib/jkai/llm-client.ts`), vitest, Umami (`ghcr.io/umami-software/umami:postgresql-latest`), Caddy on the VPS.

**Spec:** `docs/superpowers/specs/2026-04-29-blog-assistant-and-analytics-design.md`

**Convention notes for the implementer:**
- Schema changes are pushed with `npx drizzle-kit push` after editing `src/lib/db/schema.ts`. Do not write SQL migrations by hand.
- Tests use `vitest`. Run a single file with `npx vitest run path/to/file.test.ts`. Run the full suite with `npm test`.
- Frontend type-check: `npm run check` (svelte-check). Run after touching `.svelte` files.
- Admin routes are gated by `?token=...` validated in `src/hooks.server.ts`; the existing blog API endpoints under `src/routes/api/admin/blog/` already work this way — re-use that pattern, no extra auth code needed.
- The blog editor already wires server-applied changes back into the page state via the `data.post` mutations — see the `save()` function in `src/routes/admin/blog/[id]/+page.svelte`. Use the same mutate-`data.post` pattern when re-syncing after a tool call.
- All output and code must be in English (per project standing instruction).
- Commit after each step that produces a green test or a working UI change.

---

## File Structure

### Part A — Blog editor assistant
- **Create:**
  - `src/lib/blog/assistant/tools.ts` — tool definitions (OpenAI function-calling shape) + handlers.
  - `src/lib/blog/assistant/runner.ts` — tool-use loop that streams events.
  - `src/lib/blog/assistant/prompt.ts` — system-prompt builder.
  - `src/lib/blog/assistant/undo-store.ts` — in-memory undo snapshot store.
  - `src/lib/blog/assistant/messages.ts` — DB helpers for chat history.
  - `src/routes/api/admin/blog/[id]/assistant/+server.ts` — POST → SSE stream.
  - `src/routes/api/admin/blog/[id]/assistant/undo/+server.ts` — POST undo.
  - `src/lib/components/BlogAssistantPanel.svelte`.
  - `tests/lib/blog/assistant/tools.test.ts`
  - `tests/lib/blog/assistant/runner.test.ts`
  - `tests/lib/blog/assistant/undo-store.test.ts`
- **Modify:**
  - `src/lib/db/schema.ts` — add `coverImageAlt` column + new `blogAssistantMessages` table.
  - `src/lib/blog/index.ts` — add `updatePostFields()` and `getPostById()` if missing; expose helpers used by tools.
  - `src/routes/admin/blog/[id]/+page.server.ts` — also load chat history.
  - `src/routes/admin/blog/[id]/+page.svelte` — mount `BlogAssistantPanel`, re-sync state on `post_state` events.

### Part B — Umami analytics
- **Create:**
  - `src/lib/umami/cache.ts` — generic TTL cache.
  - `src/lib/umami/auth.ts` — bearer-token / API-key helper.
  - `src/lib/umami/client.ts` — `getStatsBatch`, `getTopReferrers`, `getDailyViews`.
  - `src/lib/components/UmamiTracker.svelte`.
  - `src/lib/components/BlogStatsCard.svelte`.
  - `src/routes/blog/+layout.svelte` (only if it doesn't already exist; today there's a `+page.svelte` but no layout — confirm with `ls src/routes/blog/+layout.svelte` first).
  - `tests/lib/umami/cache.test.ts`
  - `tests/lib/umami/client.test.ts`
- **Modify:**
  - `src/routes/admin/blog/+page.server.ts` — fan-out stats fetch.
  - `src/routes/admin/blog/+page.svelte` — add views column.
  - `src/routes/admin/blog/[id]/+page.server.ts` — fetch detailed stats for this post.
  - `src/routes/admin/blog/[id]/+page.svelte` — mount `BlogStatsCard`.
  - `~/vps-strange-rambling/docker-compose.yml` — add `umami` service.
  - `~/vps-strange-rambling/Caddyfile` — `analytics.strangeramblings.com` reverse proxy.

---

# Part A — Blog Editor AI Assistant

## Task A1: Schema additions

**Files:**
- Modify: `src/lib/db/schema.ts:32-53`
- Test: `tests/lib/db/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/db/schema.test.ts`:

```typescript
import { blogAssistantMessages } from '$lib/db/schema';

describe('blogPosts new column', () => {
  it('blogPosts has coverImageAlt column', () => {
    expect(blogPosts.coverImageAlt).toBeDefined();
  });
});

describe('blogAssistantMessages schema', () => {
  it('exists with role, content, postId, createdAt', () => {
    expect(blogAssistantMessages.id).toBeDefined();
    expect(blogAssistantMessages.postId).toBeDefined();
    expect(blogAssistantMessages.role).toBeDefined();
    expect(blogAssistantMessages.content).toBeDefined();
    expect(blogAssistantMessages.createdAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/lib/db/schema.test.ts`
Expected: FAIL — `blogPosts.coverImageAlt` undefined and `blogAssistantMessages` not exported.

- [ ] **Step 3: Add the column and table**

Modify `src/lib/db/schema.ts`:

After the existing `coverImageUrl` line (around line 38), add:

```typescript
  coverImageAlt: text('cover_image_alt'),
```

After `blogPostTags` table block (around line 53), insert:

```typescript
export const blogAssistantMessages = pgTable('blog_assistant_messages', {
  id: serial('id').primaryKey(),
  postId: integer('post_id')
    .notNull()
    .references(() => blogPosts.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

- [ ] **Step 4: Push the schema**

Run: `npx drizzle-kit push`
Expected: prompts to apply the new column + table; type `y`.

- [ ] **Step 5: Re-run the test**

Run: `npx vitest run tests/lib/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts tests/lib/db/schema.test.ts
git commit -m "feat(blog): add coverImageAlt column + blog_assistant_messages table"
```

---

## Task A2: Undo store

**Files:**
- Create: `src/lib/blog/assistant/undo-store.ts`
- Test: `tests/lib/blog/assistant/undo-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/blog/assistant/undo-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createUndoStore } from '$lib/blog/assistant/undo-store';

describe('undo store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records and retrieves a snapshot', () => {
    const s = createUndoStore({ ttlMs: 60_000 });
    const token = s.put({ postId: 1, field: 'title', previousValue: 'old' });
    expect(s.take(token)).toEqual({ postId: 1, field: 'title', previousValue: 'old' });
  });

  it('returns null for unknown tokens', () => {
    const s = createUndoStore({ ttlMs: 60_000 });
    expect(s.take('nope')).toBeNull();
  });

  it('consumes the snapshot (single-use)', () => {
    const s = createUndoStore({ ttlMs: 60_000 });
    const token = s.put({ postId: 1, field: 'title', previousValue: 'old' });
    expect(s.take(token)).not.toBeNull();
    expect(s.take(token)).toBeNull();
  });

  it('expires after TTL', () => {
    const s = createUndoStore({ ttlMs: 1_000 });
    const token = s.put({ postId: 1, field: 'title', previousValue: 'old' });
    vi.advanceTimersByTime(2_000);
    expect(s.take(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/lib/blog/assistant/undo-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/lib/blog/assistant/undo-store.ts`:

```typescript
import { randomUUID } from 'node:crypto';

export type UndoSnapshot = {
  postId: number;
  field: string;
  previousValue: unknown;
};

export type UndoStore = {
  put: (snapshot: UndoSnapshot) => string;
  take: (token: string) => UndoSnapshot | null;
};

export function createUndoStore(opts: { ttlMs: number }): UndoStore {
  const map = new Map<string, { snapshot: UndoSnapshot; expiresAt: number }>();
  return {
    put(snapshot) {
      const token = randomUUID();
      map.set(token, { snapshot, expiresAt: Date.now() + opts.ttlMs });
      return token;
    },
    take(token) {
      const entry = map.get(token);
      if (!entry) return null;
      map.delete(token);
      if (entry.expiresAt < Date.now()) return null;
      return entry.snapshot;
    },
  };
}

// Process-wide singleton used by the assistant routes.
export const undoStore: UndoStore = createUndoStore({ ttlMs: 30 * 60 * 1000 });
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/lib/blog/assistant/undo-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/assistant/undo-store.ts tests/lib/blog/assistant/undo-store.test.ts
git commit -m "feat(blog-assistant): in-memory undo store with TTL"
```

---

## Task A3: Repo helpers used by tools

**Files:**
- Modify: `src/lib/blog/index.ts`

- [ ] **Step 1: Inspect the current file**

Run: `cat src/lib/blog/index.ts | head -200`

Identify whether `getPostById(id)`, `updatePost(id, fields)`, and `replaceTags(postId, tags)` already exist with usable signatures. If they do, skip Step 2 and re-use them in later tasks; if any are missing, add them now.

- [ ] **Step 2: Add missing helpers**

If absent, append to `src/lib/blog/index.ts`:

```typescript
export async function getPostById(id: number) {
  const [row] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
  if (!row) return null;
  const tags = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, id));
  return { ...row, tags: tags.map((t) => t.tag) };
}

export async function updatePostFields(
  id: number,
  fields: Partial<{
    title: string;
    excerpt: string;
    slug: string;
    content: string;
    contentFormat: 'html' | 'markdown';
    coverImageUrl: string | null;
    coverImageAlt: string | null;
    status: 'draft' | 'published';
    publishedAt: Date | null;
    previewToken: string;
  }>,
) {
  await db
    .update(blogPosts)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(blogPosts.id, id));
}

export async function replaceTags(postId: number, tags: string[]) {
  await db.delete(blogPostTags).where(eq(blogPostTags.postId, postId));
  if (tags.length === 0) return;
  await db.insert(blogPostTags).values(tags.map((tag) => ({ postId, tag })));
}

export async function isSlugTaken(slug: string, exceptId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(eq(blogPosts.slug, slug));
  return !!row && row.id !== exceptId;
}
```

(Imports at the top of the file should already include `db`, `blogPosts`, `blogPostTags`, and `eq` from drizzle.)

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: zero errors in `src/lib/blog/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/blog/index.ts
git commit -m "feat(blog): expose getPostById/updatePostFields/replaceTags/isSlugTaken"
```

---

## Task A4: Tool definitions and handlers

**Files:**
- Create: `src/lib/blog/assistant/tools.ts`
- Test: `tests/lib/blog/assistant/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/blog/assistant/tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runTool } from '$lib/blog/assistant/tools';
import * as blog from '$lib/blog';
import { createUndoStore } from '$lib/blog/assistant/undo-store';

vi.mock('$lib/blog');

describe('runTool', () => {
  const undoStore = createUndoStore({ ttlMs: 60_000 });
  const ctx = () => ({
    postId: 1,
    snapshot: { id: 1, title: 'old', excerpt: 'e', slug: 's', tags: ['x'], content: '<p/>', contentFormat: 'html' as const, status: 'draft' as const, coverImageUrl: null, coverImageAlt: null, publishedAt: null, previewToken: 't' },
    undoStore,
  });

  beforeEach(() => vi.clearAllMocks());

  it('update_title applies and returns undo token', async () => {
    vi.mocked(blog.updatePostFields).mockResolvedValue();
    const r = await runTool('update_title', { title: 'new' }, ctx());
    expect(blog.updatePostFields).toHaveBeenCalledWith(1, { title: 'new' });
    expect(r.ok).toBe(true);
    expect(typeof r.undoToken).toBe('string');
  });

  it('update_slug rejects if slug already taken', async () => {
    vi.mocked(blog.isSlugTaken).mockResolvedValue(true);
    const r = await runTool('update_slug', { slug: 'taken' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already in use/i);
  });

  it('patch_content errors when find string is missing', async () => {
    const r = await runTool('patch_content', { find: 'missing', replace: 'x' }, ctx());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it('patch_content errors when find string is non-unique', async () => {
    const c = ctx();
    c.snapshot.content = 'aa aa';
    const r = await runTool('patch_content', { find: 'aa', replace: 'bb' }, c);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not unique/i);
  });

  it('set_status=published sets publishedAt when first publishing', async () => {
    vi.mocked(blog.updatePostFields).mockResolvedValue();
    const r = await runTool('set_status', { status: 'published' }, ctx());
    expect(r.ok).toBe(true);
    const args = vi.mocked(blog.updatePostFields).mock.calls[0][1];
    expect(args.status).toBe('published');
    expect(args.publishedAt).toBeInstanceOf(Date);
  });

  it('read_post returns the snapshot and writes nothing', async () => {
    const r = await runTool('read_post', {}, ctx());
    expect(r.ok).toBe(true);
    expect(blog.updatePostFields).not.toHaveBeenCalled();
    expect(r.result).toMatchObject({ title: 'old' });
  });

  it('returns error for unknown tool', async () => {
    const r = await runTool('nope', {}, ctx());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown tool/i);
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run tests/lib/blog/assistant/tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement tools**

Create `src/lib/blog/assistant/tools.ts`:

```typescript
import {
  updatePostFields,
  replaceTags,
  isSlugTaken,
} from '$lib/blog';
import type { UndoStore } from './undo-store';

export type PostSnapshot = {
  id: number;
  title: string;
  excerpt: string;
  slug: string;
  content: string;
  contentFormat: 'html' | 'markdown';
  status: 'draft' | 'published';
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: Date | null;
  previewToken: string | null;
  tags: string[];
};

export type ToolContext = {
  postId: number;
  snapshot: PostSnapshot;
  undoStore: UndoStore;
};

export type ToolResult =
  | { ok: true; undoToken?: string; result?: unknown }
  | { ok: false; error: string };

export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'update_title',
      description: 'Set the post title.',
      parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_excerpt',
      description: 'Set the short excerpt shown in lists and previews.',
      parameters: { type: 'object', properties: { excerpt: { type: 'string' } }, required: ['excerpt'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_slug',
      description: 'Set the URL slug (kebab-case). Errors if already taken.',
      parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_tags',
      description: 'Replace the full tag list.',
      parameters: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } }, required: ['tags'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'replace_content',
      description: 'Replace the entire post body.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          format: { type: 'string', enum: ['html', 'markdown'] },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'patch_content',
      description: 'Find/replace a single substring inside the post body. Errors if find is missing or non-unique.',
      parameters: {
        type: 'object',
        properties: { find: { type: 'string' }, replace: { type: 'string' } },
        required: ['find', 'replace'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_status',
      description: 'Publish or unpublish the post.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['draft', 'published'] } },
        required: ['status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_cover_alt',
      description: 'Set the alt text for the cover image.',
      parameters: { type: 'object', properties: { alt: { type: 'string' } }, required: ['alt'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_post',
      description: 'Return the current post payload (no write).',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { postId, snapshot, undoStore } = ctx;

  switch (name) {
    case 'read_post':
      return { ok: true, result: snapshot };

    case 'update_title': {
      const title = String(args.title ?? '');
      await updatePostFields(postId, { title });
      const undoToken = undoStore.put({ postId, field: 'title', previousValue: snapshot.title });
      ctx.snapshot.title = title;
      return { ok: true, undoToken, result: { title } };
    }

    case 'update_excerpt': {
      const excerpt = String(args.excerpt ?? '');
      await updatePostFields(postId, { excerpt });
      const undoToken = undoStore.put({ postId, field: 'excerpt', previousValue: snapshot.excerpt });
      ctx.snapshot.excerpt = excerpt;
      return { ok: true, undoToken, result: { excerpt } };
    }

    case 'update_slug': {
      const slug = String(args.slug ?? '');
      if (await isSlugTaken(slug, postId)) {
        return { ok: false, error: `Slug "${slug}" is already in use.` };
      }
      await updatePostFields(postId, { slug });
      const undoToken = undoStore.put({ postId, field: 'slug', previousValue: snapshot.slug });
      ctx.snapshot.slug = slug;
      return { ok: true, undoToken, result: { slug } };
    }

    case 'update_tags': {
      const tags = (args.tags as unknown[] | undefined ?? []).map((t) => String(t));
      await replaceTags(postId, tags);
      const undoToken = undoStore.put({ postId, field: 'tags', previousValue: snapshot.tags });
      ctx.snapshot.tags = tags;
      return { ok: true, undoToken, result: { tags } };
    }

    case 'replace_content': {
      const content = String(args.content ?? '');
      const format = (args.format as 'html' | 'markdown' | undefined) ?? snapshot.contentFormat;
      await updatePostFields(postId, { content, contentFormat: format });
      const undoToken = undoStore.put({
        postId,
        field: 'content',
        previousValue: { content: snapshot.content, contentFormat: snapshot.contentFormat },
      });
      ctx.snapshot.content = content;
      ctx.snapshot.contentFormat = format;
      return { ok: true, undoToken, result: { content, format } };
    }

    case 'patch_content': {
      const find = String(args.find ?? '');
      const replace = String(args.replace ?? '');
      if (!find) return { ok: false, error: 'find string is empty.' };
      const occurrences = snapshot.content.split(find).length - 1;
      if (occurrences === 0) return { ok: false, error: `find string not found in content.` };
      if (occurrences > 1) return { ok: false, error: `find string not unique (${occurrences} matches).` };
      const next = snapshot.content.replace(find, replace);
      await updatePostFields(postId, { content: next });
      const undoToken = undoStore.put({ postId, field: 'content', previousValue: snapshot.content });
      ctx.snapshot.content = next;
      return { ok: true, undoToken, result: { content: next } };
    }

    case 'set_status': {
      const status = args.status === 'published' ? 'published' : 'draft';
      const fields: Parameters<typeof updatePostFields>[1] = { status };
      if (status === 'published' && !snapshot.publishedAt) {
        fields.publishedAt = new Date();
      }
      await updatePostFields(postId, fields);
      const undoToken = undoStore.put({
        postId,
        field: 'status',
        previousValue: { status: snapshot.status, publishedAt: snapshot.publishedAt },
      });
      ctx.snapshot.status = status;
      if (fields.publishedAt) ctx.snapshot.publishedAt = fields.publishedAt;
      return { ok: true, undoToken, result: { status } };
    }

    case 'set_cover_alt': {
      const alt = String(args.alt ?? '');
      await updatePostFields(postId, { coverImageAlt: alt });
      const undoToken = undoStore.put({ postId, field: 'coverImageAlt', previousValue: snapshot.coverImageAlt });
      ctx.snapshot.coverImageAlt = alt;
      return { ok: true, undoToken, result: { alt } };
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/blog/assistant/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/assistant/tools.ts tests/lib/blog/assistant/tools.test.ts
git commit -m "feat(blog-assistant): tool definitions + handlers with undo snapshots"
```

---

## Task A5: System prompt builder

**Files:**
- Create: `src/lib/blog/assistant/prompt.ts`

- [ ] **Step 1: Implement**

Create `src/lib/blog/assistant/prompt.ts`:

```typescript
import type { PostSnapshot } from './tools';

const MAX_CONTENT_CHARS = 40_000;

export function buildSystemPrompt(post: PostSnapshot): string {
  const truncated = post.content.length > MAX_CONTENT_CHARS
    ? post.content.slice(0, MAX_CONTENT_CHARS) + '\n…[truncated]'
    : post.content;

  return `You are an editorial assistant for the strangeramblings.com blog.

Voice: warm, slightly brutalist, British English (-ise, not -ize). Short sentences are fine. Avoid corporate-speak.

You are working on ONE specific draft. The current state of that draft is below. When the user asks a question or gives an instruction, default to acting on this post unless they clearly mean something else.

You have tools that mutate the post directly. Prefer using a tool over describing what should change. After a write, briefly tell the user what you did. If the user only wants ideas or alternatives, do not call a write tool — just reply in text.

Current draft:
- id: ${post.id}
- title: ${JSON.stringify(post.title)}
- slug: ${JSON.stringify(post.slug)}
- status: ${post.status}
- tags: ${JSON.stringify(post.tags)}
- excerpt: ${JSON.stringify(post.excerpt)}
- format: ${post.contentFormat}
- cover image url: ${post.coverImageUrl ?? '(none)'}
- cover image alt: ${post.coverImageAlt ?? '(none)'}

Body:
\`\`\`${post.contentFormat}
${truncated}
\`\`\`
`;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: zero errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/blog/assistant/prompt.ts
git commit -m "feat(blog-assistant): system-prompt builder with current-draft context"
```

---

## Task A6: Message-history helpers

**Files:**
- Create: `src/lib/blog/assistant/messages.ts`

- [ ] **Step 1: Implement**

Create `src/lib/blog/assistant/messages.ts`:

```typescript
import { db } from '$lib/db';
import { blogAssistantMessages } from '$lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';

export type ChatRole = 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  createdAt: Date;
};

export async function appendMessage(postId: number, role: ChatRole, content: string): Promise<void> {
  await db.insert(blogAssistantMessages).values({ postId, role, content });
}

export async function loadHistory(postId: number, limit = 20): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(blogAssistantMessages)
    .where(eq(blogAssistantMessages.postId, postId))
    .orderBy(asc(blogAssistantMessages.createdAt));
  // Take the LAST `limit` items (oldest at the front of the trimmed list).
  return rows.slice(-limit).map((r) => ({
    id: r.id,
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

export async function clearHistory(postId: number): Promise<void> {
  await db.delete(blogAssistantMessages).where(eq(blogAssistantMessages.postId, postId));
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: zero errors. (`and` is imported but unused — remove it if svelte-check complains.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/blog/assistant/messages.ts
git commit -m "feat(blog-assistant): per-post chat history helpers"
```

---

## Task A7: Runner — tool-use loop

**Files:**
- Create: `src/lib/blog/assistant/runner.ts`
- Test: `tests/lib/blog/assistant/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/blog/assistant/runner.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runAssistant } from '$lib/blog/assistant/runner';
import * as blog from '$lib/blog';

vi.mock('$lib/blog');

function fakeClient(scripted: Array<{ tool?: { name: string; args: Record<string, unknown> }; text?: string }>) {
  let i = 0;
  return {
    chat: {
      completions: {
        async create(_opts: unknown) {
          const step = scripted[i++];
          if (!step) throw new Error('out of scripted steps');
          if (step.tool) {
            return {
              choices: [{
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{
                    id: `call_${i}`,
                    type: 'function',
                    function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
            };
          }
          return {
            choices: [{
              message: { role: 'assistant', content: step.text ?? '' },
              finish_reason: 'stop',
            }],
          };
        },
      },
    },
  };
}

const snapshot = {
  id: 1, title: 'old', excerpt: 'e', slug: 's', content: '<p>x</p>',
  contentFormat: 'html' as const, status: 'draft' as const,
  coverImageUrl: null, coverImageAlt: null, publishedAt: null,
  previewToken: 't', tags: [],
};

describe('runAssistant', () => {
  it('emits text events and a final done', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    const client = fakeClient([{ text: 'hello there' }]);
    const events: Array<{ type: string }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'hi', history: [], client: client as never, model: 'm',
    })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('executes a tool call and emits tool events + post_state', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    vi.mocked(blog.updatePostFields).mockResolvedValue();
    const client = fakeClient([
      { tool: { name: 'update_title', args: { title: 'new' } } },
      { text: 'done' },
    ]);
    const events: Array<{ type: string }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'rename', history: [], client: client as never, model: 'm',
    })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'post_state', 'text', 'done']);
  });

  it('caps tool calls at 6', async () => {
    vi.mocked(blog.getPostById).mockResolvedValue({ ...snapshot } as never);
    vi.mocked(blog.updatePostFields).mockResolvedValue();
    const scripted = Array.from({ length: 8 }, () => ({ tool: { name: 'update_title', args: { title: 'x' } } }));
    const client = fakeClient(scripted);
    const events: Array<{ type: string }> = [];
    for await (const e of runAssistant({
      postId: 1, userMessage: 'spam', history: [], client: client as never, model: 'm',
    })) events.push(e);
    const toolCalls = events.filter((e) => e.type === 'tool_call').length;
    expect(toolCalls).toBeLessThanOrEqual(6);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/lib/blog/assistant/runner.test.ts`
Expected: FAIL — `runAssistant` not found.

- [ ] **Step 3: Implement the runner**

Create `src/lib/blog/assistant/runner.ts`:

```typescript
import type OpenAI from 'openai';
import { getPostById } from '$lib/blog';
import { buildSystemPrompt } from './prompt';
import { runTool, toolDefinitions, type PostSnapshot } from './tools';
import { undoStore } from './undo-store';
import type { ChatMessage } from './messages';

const MAX_TOOL_CALLS = 6;

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; result?: unknown; error?: string; undoToken?: string }
  | { type: 'post_state'; post: PostSnapshot }
  | { type: 'done'; reason: 'stop' | 'cap' }
  | { type: 'error'; message: string };

export type RunOptions = {
  postId: number;
  userMessage: string;
  history: ChatMessage[];
  client: OpenAI;
  model: string;
};

function toRowSnapshot(row: Awaited<ReturnType<typeof getPostById>>): PostSnapshot {
  if (!row) throw new Error('Post not found');
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    slug: row.slug,
    content: row.content,
    contentFormat: (row.contentFormat as 'html' | 'markdown') ?? 'html',
    status: (row.status as 'draft' | 'published') ?? 'draft',
    coverImageUrl: row.coverImageUrl ?? null,
    coverImageAlt: (row as { coverImageAlt?: string | null }).coverImageAlt ?? null,
    publishedAt: row.publishedAt ?? null,
    previewToken: row.previewToken ?? null,
    tags: row.tags ?? [],
  };
}

export async function* runAssistant(opts: RunOptions): AsyncGenerator<AssistantEvent> {
  const { postId, userMessage, history, client, model } = opts;
  const row = await getPostById(postId);
  if (!row) {
    yield { type: 'error', message: `Post ${postId} not found.` };
    return;
  }
  const snapshot = toRowSnapshot(row);

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: buildSystemPrompt(snapshot) },
    ...history.map((h) => ({ role: h.role === 'tool' ? 'assistant' : h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ];

  let toolCalls = 0;

  while (true) {
    let resp;
    try {
      resp = await client.chat.completions.create({
        model,
        messages: messages as never,
        tools: toolDefinitions as never,
        tool_choice: 'auto' as never,
      });
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : 'LLM call failed' };
      return;
    }

    const choice = resp.choices[0];
    const msg = choice.message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        if (toolCalls >= MAX_TOOL_CALLS) {
          yield { type: 'done', reason: 'cap' };
          return;
        }
        toolCalls++;
        const name = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore parse error */ }

        yield { type: 'tool_call', name, arguments: args };

        const result = await runTool(name, args, { postId, snapshot, undoStore });
        if (result.ok) {
          yield {
            type: 'tool_result',
            name,
            ok: true,
            result: result.result,
            undoToken: result.undoToken,
          };
        } else {
          yield { type: 'tool_result', name, ok: false, error: result.error };
        }

        if (name !== 'read_post') {
          yield { type: 'post_state', post: { ...snapshot } };
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result.ok ? { ok: true, result: result.result } : { ok: false, error: result.error }),
        });
      }
      continue; // let the model react to tool results
    }

    const text = msg.content ?? '';
    if (text) yield { type: 'text', delta: text };
    yield { type: 'done', reason: 'stop' };
    return;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/blog/assistant/runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/assistant/runner.ts tests/lib/blog/assistant/runner.test.ts
git commit -m "feat(blog-assistant): tool-use loop runner with event stream"
```

---

## Task A8: SSE endpoint

**Files:**
- Create: `src/routes/api/admin/blog/[id]/assistant/+server.ts`

- [ ] **Step 1: Implement**

Create `src/routes/api/admin/blog/[id]/assistant/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';
import { runAssistant } from '$lib/blog/assistant/runner';
import { appendMessage, loadHistory } from '$lib/blog/assistant/messages';

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');

  const body = await request.json().catch(() => ({}));
  const userMessage = String(body.message ?? '').trim();
  if (!userMessage) throw error(400, 'empty message');

  const ctx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(ctx);
  const history = await loadHistory(postId);

  await appendMessage(postId, 'user', userMessage);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let assistantText = '';
      try {
        for await (const ev of runAssistant({ postId, userMessage, history, client, model })) {
          send(ev);
          if (ev.type === 'text') assistantText += ev.delta;
          if (ev.type === 'tool_result') {
            await appendMessage(
              postId,
              'tool',
              JSON.stringify({ name: ev.name, ok: ev.ok, result: ev.ok ? ev.result : ev.error }),
            );
          }
        }
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'unknown error' });
      } finally {
        if (assistantText) {
          await appendMessage(postId, 'assistant', assistantText).catch(() => undefined);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: zero errors. (If `resolveDefaultModel` is in a different path, locate the right import via `grep -rn 'export.*resolveDefaultModel' src/`.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/admin/blog/\[id\]/assistant/+server.ts
git commit -m "feat(blog-assistant): SSE endpoint streaming runner events"
```

---

## Task A9: Undo endpoint

**Files:**
- Create: `src/routes/api/admin/blog/[id]/assistant/undo/+server.ts`

- [ ] **Step 1: Implement**

Create `src/routes/api/admin/blog/[id]/assistant/undo/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { undoStore } from '$lib/blog/assistant/undo-store';
import { updatePostFields, replaceTags, getPostById } from '$lib/blog';

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  const body = await request.json().catch(() => ({}));
  const token = String(body.undoToken ?? '');
  const snap = undoStore.take(token);
  if (!snap || snap.postId !== postId) throw error(404, 'unknown or expired undo token');

  switch (snap.field) {
    case 'title':
      await updatePostFields(postId, { title: snap.previousValue as string });
      break;
    case 'excerpt':
      await updatePostFields(postId, { excerpt: snap.previousValue as string });
      break;
    case 'slug':
      await updatePostFields(postId, { slug: snap.previousValue as string });
      break;
    case 'tags':
      await replaceTags(postId, snap.previousValue as string[]);
      break;
    case 'content': {
      const v = snap.previousValue;
      if (typeof v === 'string') {
        await updatePostFields(postId, { content: v });
      } else if (v && typeof v === 'object') {
        const o = v as { content: string; contentFormat: 'html' | 'markdown' };
        await updatePostFields(postId, { content: o.content, contentFormat: o.contentFormat });
      }
      break;
    }
    case 'status': {
      const o = snap.previousValue as { status: 'draft' | 'published'; publishedAt: Date | null };
      await updatePostFields(postId, { status: o.status, publishedAt: o.publishedAt });
      break;
    }
    case 'coverImageAlt':
      await updatePostFields(postId, { coverImageAlt: (snap.previousValue as string | null) });
      break;
    default:
      throw error(400, `unsupported undo field: ${snap.field}`);
  }

  const post = await getPostById(postId);
  return json({ ok: true, post });
};
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/admin/blog/\[id\]/assistant/undo/+server.ts
git commit -m "feat(blog-assistant): undo endpoint that reverses a single tool call"
```

---

## Task A10: Editor server load — include chat history

**Files:**
- Modify: `src/routes/admin/blog/[id]/+page.server.ts`

- [ ] **Step 1: Read the current load function**

Run: `cat src/routes/admin/blog/[id]/+page.server.ts`

- [ ] **Step 2: Add history to the returned object**

Add an import:

```typescript
import { loadHistory } from '$lib/blog/assistant/messages';
```

Inside `load`, after the post is fetched, fetch and return the history alongside:

```typescript
  const history = await loadHistory(post.id);
  return { post, history };
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/blog/\[id\]/+page.server.ts
git commit -m "feat(blog-assistant): pass chat history to editor page"
```

---

## Task A11: BlogAssistantPanel component

**Files:**
- Create: `src/lib/components/BlogAssistantPanel.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/components/BlogAssistantPanel.svelte`:

```svelte
<script lang="ts">
  type ChatRole = 'user' | 'assistant' | 'tool';
  type ChatEntry =
    | { kind: 'user'; content: string }
    | { kind: 'assistant'; content: string }
    | { kind: 'tool'; name: string; ok: boolean; summary: string; undoToken?: string; undone?: boolean };

  type HistoryRow = { role: ChatRole; content: string };

  type Props = {
    postId: number;
    adminToken: string;
    history: HistoryRow[];
    onPostUpdated: (post: Record<string, unknown>) => void;
  };

  let { postId, adminToken, history, onPostUpdated }: Props = $props();

  function rehydrate(rows: HistoryRow[]): ChatEntry[] {
    return rows.map((r) => {
      if (r.role === 'user') return { kind: 'user', content: r.content };
      if (r.role === 'assistant') return { kind: 'assistant', content: r.content };
      try {
        const parsed = JSON.parse(r.content) as { name: string; ok: boolean; result?: unknown };
        return {
          kind: 'tool',
          name: parsed.name,
          ok: parsed.ok,
          summary: parsed.ok ? `✓ ${parsed.name}` : `✗ ${parsed.name}: ${String(parsed.result)}`,
        };
      } catch {
        return { kind: 'tool', name: 'unknown', ok: false, summary: r.content };
      }
    });
  }

  let entries = $state<ChatEntry[]>(rehydrate(history));
  let input = $state('');
  let open = $state(false);
  let busy = $state(false);
  let abortCtl: AbortController | null = null;

  function summariseToolCall(name: string, args: Record<string, unknown>): string {
    if (name === 'update_title') return `update title → "${String(args.title ?? '').slice(0, 60)}"`;
    if (name === 'update_excerpt') return 'update excerpt';
    if (name === 'update_slug') return `update slug → ${String(args.slug ?? '')}`;
    if (name === 'update_tags') return `set tags → ${(args.tags as string[] | undefined ?? []).join(', ')}`;
    if (name === 'replace_content') return 'replace post body';
    if (name === 'patch_content') return 'patch post body';
    if (name === 'set_status') return `set status → ${String(args.status ?? '')}`;
    if (name === 'set_cover_alt') return `set cover alt`;
    if (name === 'read_post') return 'read post';
    return name;
  }

  async function send() {
    if (!input.trim() || busy) return;
    const message = input.trim();
    input = '';
    busy = true;
    entries = [...entries, { kind: 'user', content: message }];
    let assistantBuf = '';
    let assistantIdx = -1;

    abortCtl = new AbortController();
    try {
      const res = await fetch(`/api/admin/blog/${postId}/assistant?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: abortCtl.signal,
      });
      if (!res.ok || !res.body) {
        entries = [...entries, { kind: 'assistant', content: `Error: ${res.status}` }];
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'text') {
            assistantBuf += ev.delta;
            if (assistantIdx === -1) {
              entries = [...entries, { kind: 'assistant', content: assistantBuf }];
              assistantIdx = entries.length - 1;
            } else {
              entries[assistantIdx] = { kind: 'assistant', content: assistantBuf };
              entries = entries;
            }
          } else if (ev.type === 'tool_call') {
            entries = [...entries, {
              kind: 'tool', name: ev.name, ok: true,
              summary: summariseToolCall(ev.name, ev.arguments),
            }];
          } else if (ev.type === 'tool_result') {
            const last = entries[entries.length - 1];
            if (last && last.kind === 'tool' && last.name === ev.name) {
              entries[entries.length - 1] = {
                ...last,
                ok: ev.ok,
                summary: ev.ok ? `✓ ${last.summary}` : `✗ ${last.summary} — ${ev.error}`,
                undoToken: ev.undoToken,
              };
              entries = entries;
            }
          } else if (ev.type === 'post_state') {
            onPostUpdated(ev.post);
          } else if (ev.type === 'error') {
            entries = [...entries, { kind: 'assistant', content: `Error: ${ev.message}` }];
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        entries = [...entries, { kind: 'assistant', content: `Error: ${(e as Error).message}` }];
      }
    } finally {
      busy = false;
      abortCtl = null;
    }
  }

  function cancel() {
    abortCtl?.abort();
    busy = false;
  }

  async function undo(idx: number) {
    const e = entries[idx];
    if (e.kind !== 'tool' || !e.undoToken) return;
    const res = await fetch(`/api/admin/blog/${postId}/assistant/undo?token=${adminToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ undoToken: e.undoToken }),
    });
    if (!res.ok) return;
    const body = await res.json();
    entries[idx] = { ...e, undone: true, undoToken: undefined };
    entries = entries;
    if (body.post) onPostUpdated(body.post);
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  }
</script>

<section class="nm-sec assistant">
  <div class="nm-sec-hd">
    <button class="toggle" onclick={() => (open = !open)}>
      <span class="sr-label-tight">Assistant</span>
      <span class="caret">{open ? '▾' : '▸'}</span>
    </button>
    <span class="nm-sec-meta">{entries.length} message{entries.length === 1 ? '' : 's'}</span>
  </div>

  {#if open}
    <div class="transcript">
      {#each entries as e, i (i)}
        {#if e.kind === 'user'}
          <div class="row user"><span class="bubble">{e.content}</span></div>
        {:else if e.kind === 'assistant'}
          <div class="row assistant-row"><span class="bubble assistant-bubble">{e.content}</span></div>
        {:else}
          <div class="row tool-row">
            <span class="tool-line" class:fail={!e.ok}>{e.summary}</span>
            {#if e.undoToken && !e.undone}
              <button class="nm-link-btn" onclick={() => undo(i)}>Undo</button>
            {:else if e.undone}
              <span class="undone">undone</span>
            {/if}
          </div>
        {/if}
      {/each}
      {#if entries.length === 0}
        <div class="nm-empty">Ask the assistant to rewrite, retitle, retag, publish, etc.</div>
      {/if}
    </div>

    <div class="composer">
      <textarea
        class="nm-textarea"
        rows="2"
        placeholder="Ask the assistant…"
        bind:value={input}
        onkeydown={onKeydown}
        disabled={busy}
      ></textarea>
      {#if busy}
        <button class="nm-btn-ghost" onclick={cancel}>Stop</button>
      {:else}
        <button class="nm-save-btn" onclick={send} disabled={!input.trim()}>Send</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .toggle {
    background: none; border: 0; cursor: pointer;
    display: flex; align-items: center; gap: 0.4rem;
    color: inherit; padding: 0;
  }
  .caret { font-family: var(--font-mono); }
  .transcript {
    display: flex; flex-direction: column; gap: 0.6rem;
    max-height: 400px; overflow-y: auto;
    padding: 0.6rem 0;
  }
  .row { display: flex; gap: 0.5rem; }
  .row.user { justify-content: flex-end; }
  .bubble {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    font-size: 0.9rem;
    max-width: 85%;
    white-space: pre-wrap;
  }
  .assistant-bubble { background: var(--accent-tint-08); }
  .tool-row {
    align-items: center;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .tool-line.fail { color: var(--danger, #c33); }
  .undone { font-size: 0.75rem; color: var(--text-ghost); }
  .composer { display: flex; gap: 0.5rem; align-items: flex-start; }
  .composer .nm-textarea { flex: 1; }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/BlogAssistantPanel.svelte
git commit -m "feat(blog-assistant): chat panel component with SSE streaming"
```

---

## Task A12: Mount the panel in the editor and wire post-state sync

**Files:**
- Modify: `src/routes/admin/blog/[id]/+page.svelte`

- [ ] **Step 1: Add the import (top of script)**

```typescript
import BlogAssistantPanel from '$lib/components/BlogAssistantPanel.svelte';
```

- [ ] **Step 2: Add the panel mount before the closing `</PageWrap>`**

Place it just below the existing `ClaimReviewPanel` block (around line 356):

```svelte
  <BlogAssistantPanel
    postId={data.post.id}
    {adminToken}
    history={data.history ?? []}
    onPostUpdated={(p) => {
      title = (p.title as string) ?? title;
      slug = (p.slug as string) ?? slug;
      excerpt = (p.excerpt as string) ?? excerpt;
      tags = Array.isArray(p.tags) ? (p.tags as string[]).join(', ') : tags;
      coverImageUrl = (p.coverImageUrl as string | null) ?? coverImageUrl;
      status = (p.status as string) ?? status;
      content = (p.content as string) ?? content;
      data.post.title = title;
      data.post.slug = slug;
      data.post.excerpt = excerpt;
      data.post.content = content;
      data.post.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
      data.post.status = status;
      data.post.coverImageUrl = coverImageUrl;
    }}
  />
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
Visit: `http://homeserv:5173/admin/blog/<existing-post-id>?token=<token>` and:
1. Expand "Assistant".
2. Type "Suggest a snappier title and apply it."
3. Verify a `tool_call` row appears, the title input updates without reload, and an `Undo` link is present.
4. Click `Undo` — verify the title reverts.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/blog/\[id\]/+page.svelte
git commit -m "feat(blog-assistant): mount panel and re-sync editor state on tool calls"
```

---

# Part B — Umami Analytics

## Task B1: TTL cache utility

**Files:**
- Create: `src/lib/umami/cache.ts`
- Test: `tests/lib/umami/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/umami/cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTTLCache } from '$lib/umami/cache';

describe('TTL cache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns cached value within TTL', async () => {
    const cache = createTTLCache<string, number>({ ttlMs: 1_000 });
    let calls = 0;
    const loader = async () => { calls++; return 42; };
    expect(await cache.getOrLoad('k', loader)).toBe(42);
    expect(await cache.getOrLoad('k', loader)).toBe(42);
    expect(calls).toBe(1);
  });

  it('refreshes after TTL', async () => {
    const cache = createTTLCache<string, number>({ ttlMs: 100 });
    let n = 0;
    await cache.getOrLoad('k', async () => ++n);
    vi.advanceTimersByTime(200);
    const result = await cache.getOrLoad('k', async () => ++n);
    expect(result).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/lib/umami/cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/umami/cache.ts`:

```typescript
export function createTTLCache<K, V>(opts: { ttlMs: number }) {
  const store = new Map<K, { value: V; expiresAt: number }>();
  return {
    async getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > now) return hit.value;
      const value = await loader();
      store.set(key, { value, expiresAt: now + opts.ttlMs });
      return value;
    },
    clear(): void { store.clear(); },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/lib/umami/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/umami/cache.ts tests/lib/umami/cache.test.ts
git commit -m "feat(umami): TTL cache utility"
```

---

## Task B2: Umami client

**Files:**
- Create: `src/lib/umami/client.ts`
- Test: `tests/lib/umami/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/umami/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUmamiClient } from '$lib/umami/client';

const mkResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response);

describe('umami client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('getStatsForPath calls the right URL with bearer token', async () => {
    fetchMock.mockResolvedValue(mkResponse({ pageviews: { value: 5 }, visitors: { value: 3 } }));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid', apiKey: 'k', fetchFn: fetchMock,
    });
    const stats = await c.getStatsForPath('/blog/foo', 7);
    expect(stats).toEqual({ pageviews: 5, visitors: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/websites/wid/stats');
    expect(url).toContain('url=%2Fblog%2Ffoo');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer k' });
  });

  it('returns zeros when umami is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid', apiKey: 'k', fetchFn: fetchMock,
    });
    expect(await c.getStatsForPath('/blog/foo', 7)).toEqual({ pageviews: 0, visitors: 0 });
  });

  it('getStatsBatch fans out and dedupes via cache', async () => {
    fetchMock.mockResolvedValue(mkResponse({ pageviews: { value: 1 }, visitors: { value: 1 } }));
    const c = createUmamiClient({
      baseUrl: 'https://x', websiteId: 'wid', apiKey: 'k', fetchFn: fetchMock,
    });
    const a = await c.getStatsBatch(['/blog/a', '/blog/b'], 7);
    expect(Object.keys(a)).toEqual(['/blog/a', '/blog/b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    await c.getStatsBatch(['/blog/a', '/blog/b'], 7);
    expect(fetchMock).not.toHaveBeenCalled(); // both cached
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/lib/umami/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/umami/client.ts`:

```typescript
import { createTTLCache } from './cache';

export type Stats = { pageviews: number; visitors: number };
export type DailyView = { date: string; count: number };
export type Referrer = { name: string; count: number };

type Init = {
  baseUrl: string;
  websiteId: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  ttlMs?: number;
};

export type UmamiClient = {
  getStatsForPath(path: string, days: number): Promise<Stats>;
  getStatsBatch(paths: string[], days: number): Promise<Record<string, Stats>>;
  getTopReferrers(path: string, days: number, limit?: number): Promise<Referrer[]>;
  getDailyViews(path: string, days: number): Promise<DailyView[]>;
};

export function createUmamiClient(init: Init): UmamiClient {
  const fetchFn = init.fetchFn ?? fetch;
  const cache = createTTLCache<string, unknown>({ ttlMs: init.ttlMs ?? 5 * 60 * 1000 });

  const range = (days: number): { startAt: number; endAt: number } => {
    const endAt = Date.now();
    const startAt = endAt - days * 24 * 60 * 60 * 1000;
    return { startAt, endAt };
  };

  async function call<T>(pathAndQuery: string): Promise<T | null> {
    try {
      const res = await fetchFn(`${init.baseUrl}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${init.apiKey}` },
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  const getStatsForPath: UmamiClient['getStatsForPath'] = (path, days) =>
    cache.getOrLoad(`stats|${path}|${days}`, async () => {
      const { startAt, endAt } = range(days);
      const q = `?startAt=${startAt}&endAt=${endAt}&url=${encodeURIComponent(path)}`;
      const r = await call<{ pageviews: { value: number }; visitors: { value: number } }>(
        `/api/websites/${init.websiteId}/stats${q}`,
      );
      if (!r) return { pageviews: 0, visitors: 0 };
      return { pageviews: r.pageviews?.value ?? 0, visitors: r.visitors?.value ?? 0 };
    }) as Promise<Stats>;

  const getStatsBatch: UmamiClient['getStatsBatch'] = async (paths, days) => {
    const entries = await Promise.all(paths.map(async (p) => [p, await getStatsForPath(p, days)] as const));
    return Object.fromEntries(entries);
  };

  const getTopReferrers: UmamiClient['getTopReferrers'] = (path, days, limit = 5) =>
    cache.getOrLoad(`refs|${path}|${days}|${limit}`, async () => {
      const { startAt, endAt } = range(days);
      const q = `?startAt=${startAt}&endAt=${endAt}&type=referrer&url=${encodeURIComponent(path)}&limit=${limit}`;
      const r = await call<Array<{ x: string; y: number }>>(
        `/api/websites/${init.websiteId}/metrics${q}`,
      );
      if (!r) return [];
      return r.map((row) => ({ name: row.x || '(direct)', count: row.y }));
    }) as Promise<Referrer[]>;

  const getDailyViews: UmamiClient['getDailyViews'] = (path, days) =>
    cache.getOrLoad(`daily|${path}|${days}`, async () => {
      const { startAt, endAt } = range(days);
      const q = `?startAt=${startAt}&endAt=${endAt}&unit=day&timezone=Europe/London&url=${encodeURIComponent(path)}`;
      const r = await call<{ pageviews: Array<{ x: string; y: number }> }>(
        `/api/websites/${init.websiteId}/pageviews${q}`,
      );
      if (!r?.pageviews) return [];
      return r.pageviews.map((row) => ({ date: row.x, count: row.y }));
    }) as Promise<DailyView[]>;

  return { getStatsForPath, getStatsBatch, getTopReferrers, getDailyViews };
}

let singleton: UmamiClient | null = null;

export function getUmami(): UmamiClient | null {
  if (singleton) return singleton;
  const baseUrl = process.env.UMAMI_API_BASE;
  const websiteId = process.env.UMAMI_WEBSITE_ID;
  const apiKey = process.env.UMAMI_API_KEY;
  if (!baseUrl || !websiteId || !apiKey) return null;
  singleton = createUmamiClient({ baseUrl, websiteId, apiKey });
  return singleton;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/umami/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/umami/client.ts tests/lib/umami/client.test.ts
git commit -m "feat(umami): stats client with batch + cache, falls back to zeros"
```

---

## Task B3: Tracker component on the public blog layout

**Files:**
- Create or modify: `src/routes/blog/+layout.svelte`
- Create: `src/lib/components/UmamiTracker.svelte`

- [ ] **Step 1: Implement the tracker**

Create `src/lib/components/UmamiTracker.svelte`:

```svelte
<script lang="ts">
  import { env } from '$env/dynamic/public';
  const siteId = env.PUBLIC_UMAMI_SITE_ID;
  const scriptUrl = env.PUBLIC_UMAMI_SCRIPT_URL;
</script>

{#if siteId && scriptUrl}
  <svelte:head>
    <script async defer data-website-id={siteId} src={scriptUrl}></script>
  </svelte:head>
{/if}
```

- [ ] **Step 2: Mount the tracker on the blog layout**

Run: `ls src/routes/blog/+layout.svelte` to check if a layout exists.

If it does NOT exist, create `src/routes/blog/+layout.svelte`:

```svelte
<script lang="ts">
  import UmamiTracker from '$lib/components/UmamiTracker.svelte';
  let { children } = $props();
</script>

<UmamiTracker />
{@render children()}
```

If it DOES exist, add the import + the `<UmamiTracker />` element near the top of the markup, leaving the rest unchanged.

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/UmamiTracker.svelte src/routes/blog/+layout.svelte
git commit -m "feat(umami): inject tracker script on /blog/*"
```

---

## Task B4: Admin list — views (7d) column

**Files:**
- Modify: `src/routes/admin/blog/+page.server.ts`
- Modify: `src/routes/admin/blog/+page.svelte`

- [ ] **Step 1: Update the server load**

Read `src/routes/admin/blog/+page.server.ts` to see how posts are loaded. Then add the stats fan-out:

```typescript
import { getUmami } from '$lib/umami/client';

// ...inside `load`, after fetching `posts`:
const umami = getUmami();
let stats: Record<string, { pageviews: number; visitors: number }> = {};
if (umami) {
  const paths = posts.map((p) => `/blog/${p.slug}`);
  stats = await umami.getStatsBatch(paths, 7);
}
return {
  posts: posts.map((p) => ({
    ...p,
    views7d: stats[`/blog/${p.slug}`]?.pageviews ?? null,
  })),
};
```

- [ ] **Step 2: Add the column in the list**

In `src/routes/admin/blog/+page.svelte`, alter the `.post-row` grid to include a views cell. Replace the relevant block (around lines 140-156):

```svelte
{#each filteredPosts as post (post.id)}
  <a class="post-row" href={`/admin/blog/${post.id}?token=${adminToken}`}>
    {#if post.coverImageUrl}
      <img class="cover" src={post.coverImageUrl} alt="" />
    {:else}
      <div class="cover cover-placeholder"></div>
    {/if}
    <div class="post-main">
      <span class="post-title">{post.title}</span>
      {#if post.excerpt}
        <span class="post-excerpt">{post.excerpt.slice(0, 140)}{post.excerpt.length > 140 ? '…' : ''}</span>
      {/if}
    </div>
    <span class="nm-pill" data-state={post.status}>{post.status}</span>
    <span class="post-views" title="Views (7d)">
      {post.views7d == null ? '–' : post.views7d}
    </span>
    <span class="post-date">{fmtDate(post.updatedAt)}</span>
  </a>
{/each}
```

Update the grid template:

```css
  .post-row {
    grid-template-columns: 36px 1fr auto auto auto;
    /* …existing properties unchanged… */
  }
  .post-views {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    min-width: 2.5em;
    text-align: right;
  }
  @media (max-width: 640px) {
    .post-row { grid-template-columns: 36px 1fr auto; }
    .post-views, .post-date { display: none; }
  }
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/blog/+page.server.ts src/routes/admin/blog/+page.svelte
git commit -m "feat(umami): admin blog list — views (7d) column"
```

---

## Task B5: BlogStatsCard component

**Files:**
- Create: `src/lib/components/BlogStatsCard.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/components/BlogStatsCard.svelte`:

```svelte
<script lang="ts">
  type Stats = { pageviews: number; visitors: number } | null;
  type Daily = { date: string; count: number };
  type Referrer = { name: string; count: number };

  type Props = {
    stats30d: Stats;
    statsLifetime: Stats;
    daily: Daily[];
    referrers: Referrer[];
    available: boolean;
  };

  let { stats30d, statsLifetime, daily, referrers, available }: Props = $props();

  let max = $derived(Math.max(1, ...daily.map((d) => d.count)));
  let pathFor = (count: number, i: number) => {
    const x = (i / Math.max(1, daily.length - 1)) * 100;
    const y = 30 - (count / max) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  let polyline = $derived(daily.map((d, i) => pathFor(d.count, i)).join(' '));
</script>

<section class="nm-sec stats-card">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Viewership</span>
    <span class="nm-sec-meta">last 30 days</span>
  </div>
  {#if !available}
    <div class="nm-empty">Stats unavailable.</div>
  {:else}
    <div class="kpis">
      <div class="kpi"><span class="n">{statsLifetime?.pageviews ?? '–'}</span><span class="l">views (lifetime)</span></div>
      <div class="kpi"><span class="n">{stats30d?.pageviews ?? '–'}</span><span class="l">views (30d)</span></div>
      <div class="kpi"><span class="n">{stats30d?.visitors ?? '–'}</span><span class="l">visitors (30d)</span></div>
    </div>
    {#if daily.length > 1}
      <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={polyline} fill="none" stroke="currentColor" stroke-width="0.6" />
      </svg>
    {/if}
    {#if referrers.length}
      <ul class="refs">
        {#each referrers as r}
          <li><span class="r-name">{r.name}</span><span class="r-count">{r.count}</span></li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .kpis { display: flex; gap: 1.5rem; margin-bottom: 0.6rem; }
  .kpi { display: flex; flex-direction: column; }
  .kpi .n { font-family: var(--font-mono); font-size: 1.4rem; }
  .kpi .l { font-size: 0.72rem; color: var(--text-ghost); letter-spacing: 0.05em; text-transform: uppercase; }
  .spark { width: 100%; height: 40px; color: var(--accent); display: block; margin-bottom: 0.6rem; }
  .refs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .refs li { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); }
  .r-count { color: var(--text-ghost); }
</style>
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/BlogStatsCard.svelte
git commit -m "feat(umami): blog stats card — KPIs, sparkline, top referrers"
```

---

## Task B6: Editor page — fetch stats and mount the card

**Files:**
- Modify: `src/routes/admin/blog/[id]/+page.server.ts`
- Modify: `src/routes/admin/blog/[id]/+page.svelte`

- [ ] **Step 1: Server load — fetch stats in parallel**

In `src/routes/admin/blog/[id]/+page.server.ts`, add:

```typescript
import { getUmami } from '$lib/umami/client';

// inside `load`, after `post` and `history` are resolved:
const umami = getUmami();
const path = `/blog/${post.slug}`;
let stats30d = null, statsLifetime = null, daily: { date: string; count: number }[] = [], referrers: { name: string; count: number }[] = [];
if (umami) {
  [stats30d, statsLifetime, daily, referrers] = await Promise.all([
    umami.getStatsForPath(path, 30),
    umami.getStatsForPath(path, 365 * 5),
    umami.getDailyViews(path, 30),
    umami.getTopReferrers(path, 30, 5),
  ]);
}

return {
  post,
  history,
  stats: { stats30d, statsLifetime, daily, referrers, available: umami !== null },
};
```

- [ ] **Step 2: Mount the card on the editor page**

Add the import to `src/routes/admin/blog/[id]/+page.svelte`:

```typescript
import BlogStatsCard from '$lib/components/BlogStatsCard.svelte';
```

Insert just below `<PageHeader …/>` and above the `Metadata` section:

```svelte
<BlogStatsCard
  stats30d={data.stats.stats30d}
  statsLifetime={data.stats.statsLifetime}
  daily={data.stats.daily}
  referrers={data.stats.referrers}
  available={data.stats.available}
/>
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/blog/\[id\]/+page.server.ts src/routes/admin/blog/\[id\]/+page.svelte
git commit -m "feat(umami): per-post stats card on the editor page"
```

---

## Task B7: VPS infra — Umami container + Caddy

**Files:**
- Modify: `~/vps-strange-rambling/docker-compose.yml`
- Modify: `~/vps-strange-rambling/Caddyfile`
- Modify: `~/vps-strange-rambling/.env` (or whichever env file the SvelteKit container reads on the VPS — confirm with `grep -l UMAMI ~/vps-strange-rambling/`)

- [ ] **Step 1: Confirm Postgres details**

Inspect `~/vps-strange-rambling/docker-compose.yml` to find the existing Postgres service name and the credentials env vars. The existing database is shared with the SvelteKit app.

- [ ] **Step 2: Create the umami database**

Run on the VPS (`ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38`):

```bash
docker compose exec <pg-service> psql -U <pg-user> -c "CREATE DATABASE umami;"
```

- [ ] **Step 3: Add the umami service**

Append to `~/vps-strange-rambling/docker-compose.yml`:

```yaml
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://<pg-user>:<pg-pass>@<pg-service>:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: ${UMAMI_APP_SECRET}
    depends_on:
      - <pg-service>
    networks:
      - default
```

(Substitute the real values used elsewhere in the file.)

- [ ] **Step 4: Add Caddy reverse proxy**

In `~/vps-strange-rambling/Caddyfile`:

```caddy
analytics.strangeramblings.com {
  reverse_proxy umami:3000
}
```

- [ ] **Step 5: Set required env vars**

Generate a strong APP secret:

```bash
openssl rand -hex 32
```

Add to the env file:

```
UMAMI_APP_SECRET=<generated-secret>
```

- [ ] **Step 6: Bring up the container**

```bash
docker compose pull umami
docker compose up -d umami
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

- [ ] **Step 7: First-time setup**

Visit `https://analytics.strangeramblings.com`, log in with the default `admin / umami` credentials, change the password immediately, then:

1. Create a website entry: name `strangeramblings.com`, domain `strangeramblings.com`. Note the website ID and the script tag's `src` URL.
2. Settings → Profile → API Keys → create a key. Copy the value.

- [ ] **Step 8: Add SvelteKit env vars**

Add to the SvelteKit container's env file:

```
UMAMI_API_BASE=https://analytics.strangeramblings.com
UMAMI_WEBSITE_ID=<id-from-step-7>
UMAMI_API_KEY=<api-key-from-step-7>
PUBLIC_UMAMI_SITE_ID=<id-from-step-7>
PUBLIC_UMAMI_SCRIPT_URL=https://analytics.strangeramblings.com/script.js
```

- [ ] **Step 9: Restart the SvelteKit container**

```bash
docker compose up -d --force-recreate <sveltekit-service>
```

- [ ] **Step 10: Commit infra changes to the deployment repo**

```bash
cd ~/vps-strange-rambling
git add docker-compose.yml Caddyfile
git commit -m "infra: add Umami container behind analytics.strangeramblings.com"
git push
```

(Per project memory: always commit/push deployment changes to the relevant repo.)

---

## Task B8: Deploy and verify

- [ ] **Step 1: Deploy the SvelteKit app**

From the dev machine:

```bash
cd ~/strange_rambling_svelte
git push
./scripts/deploy.sh
```

- [ ] **Step 2: Verify tracker is live**

Visit `https://strangeramblings.com/blog/<any-published-slug>` in incognito; in DevTools → Network, confirm a request to `analytics.strangeramblings.com/script.js` and a beacon to `/api/send`. Reload a couple of times.

- [ ] **Step 3: Verify the admin reflects the views**

Visit `/admin/blog?token=…`. The "views (7d)" column should show non-zero numbers within ~5 minutes (the cache TTL). Open the post in the editor; the stats card should show 30d KPIs, a sparkline, and at least one referrer.

- [ ] **Step 4: Verify graceful fallback**

Temporarily set `UMAMI_API_KEY=invalid` and reload the admin list — the column should show `–` rather than crashing the page. Restore the real key after verification.

---

## Final check

- [ ] Run the full test suite: `npm test` — all green.
- [ ] Run `npm run check` — zero errors.
- [ ] Manual sweep: open admin blog list, click into a draft, expand assistant, run a tool, click undo, view stats card.
- [ ] Tick off the spec's "Open questions" section (none remain) and close the loop.
