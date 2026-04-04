# Blog Authoring Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw HTML textarea with a CodeMirror markdown editor, add image upload, cover images, public tags, draft preview links, auto-save, and improved admin post management.

**Architecture:** New `MarkdownEditor.svelte` component wraps CodeMirror 6 for editing, `marked` renders markdown to HTML on the public side. A `contentFormat` column distinguishes legacy HTML posts from new markdown ones — zero migration. Image uploads go to the VPS static directory via a new API endpoint. Draft previews use a UUID token in a public route.

**Tech Stack:** CodeMirror 6, `marked`, Drizzle ORM, Svelte 5 (runes), Tailwind CSS 4, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-blog-authoring-design.md`

---

## File Structure

### New files
- `src/lib/components/MarkdownEditor.svelte` — CodeMirror markdown editor with toolbar, shortcuts, preview toggle, auto-save, paste image support
- `src/lib/components/ProseContent.svelte` — shared prose styling wrapper
- `src/lib/blog/renderer.ts` — markdown-to-HTML rendering with `marked` + GFM
- `src/routes/blog/tag/[tag]/+page.svelte` — tag index page (public)
- `src/routes/blog/tag/[tag]/+page.server.ts` — tag index data loading
- `src/routes/blog/preview/[token]/+page.svelte` — draft preview page (public, no auth)
- `src/routes/blog/preview/[token]/+page.server.ts` — draft preview data loading
- `src/routes/api/admin/blog/upload-image/+server.ts` — image upload endpoint
- `tests/lib/blog/renderer.test.ts` — tests for markdown rendering

### Modified files
- `src/lib/db/schema.ts` — add `contentFormat`, `previewToken` columns to `blogPosts`
- `src/lib/blog/index.ts` — add `getPostsByTag()`, include tags in `getAllPosts()` and `getPostBySlug()`
- `src/lib/blog/types.ts` — add `contentFormat`, `coverImageUrl`, `previewToken`, `tags` to types
- `src/routes/admin/blog/[id]/+page.svelte` — swap textarea for MarkdownEditor, add cover image picker, preview link button
- `src/routes/admin/blog/+page.svelte` — add search, status tabs, sort controls
- `src/routes/admin/blog/+page.server.ts` — include `coverImageUrl` in loaded posts
- `src/routes/api/admin/blog/+server.ts` — handle `contentFormat`, `previewToken` on create; include in list
- `src/routes/api/admin/blog/[id]/+server.ts` — handle new fields on get/update
- `src/routes/blog/+page.svelte` — show tags and cover images on post cards
- `src/routes/blog/+page.server.ts` — include tags in loaded posts
- `src/routes/blog/[slug]/+page.svelte` — use ProseContent, show tags, cover image, render markdown
- `src/routes/blog/[slug]/+page.server.ts` — include tags and `contentFormat` in loaded post
- `scripts/deploy.sh` — ensure static images directory exists on VPS

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install CodeMirror, marked, and highlight.js**

```bash
cd /home/john/strange_rambling_svelte && npm install @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language-data @codemirror/commands marked highlight.js
```

- [ ] **Step 2: Verify installation**

Run: `node -e "require('@codemirror/view'); require('marked'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add CodeMirror, marked, highlight.js dependencies"
```

---

## Task 2: Schema Changes — Add `contentFormat` and `previewToken`

**Files:**
- Modify: `src/lib/db/schema.ts`
- Test: `tests/lib/db/schema.test.ts`

- [ ] **Step 1: Add test for new columns**

Append to `tests/lib/db/schema.test.ts`:

```typescript
it('blogPosts has contentFormat column', () => {
  expect(blogPosts.contentFormat).toBeDefined();
});

it('blogPosts has previewToken column', () => {
  expect(blogPosts.previewToken).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/schema.test.ts`
Expected: FAIL — columns not defined

- [ ] **Step 3: Add columns to schema**

In `src/lib/db/schema.ts`, add two columns to the `blogPosts` table (after the `coverImageUrl` column):

```typescript
contentFormat: text('content_format').default('html').notNull(),
previewToken: text('preview_token').$defaultFn(() => crypto.randomUUID()),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Push schema migration to DB**

```bash
cd /home/john/strange_rambling_svelte && npx drizzle-kit push
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts tests/lib/db/schema.test.ts
git commit -m "feat: add contentFormat and previewToken columns to blogPosts"
```

---

## Task 3: Update Blog Types

**Files:**
- Modify: `src/lib/blog/types.ts`
- Test: `tests/lib/blog/types.test.ts`

- [ ] **Step 1: Update types**

Replace `src/lib/blog/types.ts` with:

```typescript
export interface PostMeta {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  tags: string[];
  publishedAt: string | null;
}

export interface Post extends PostMeta {
  content: string;
  contentFormat: 'html' | 'markdown';
  previewToken: string;
}
```

- [ ] **Step 2: Update type test**

Update `tests/lib/blog/types.test.ts` to match the new shape:

```typescript
import { describe, it, expect } from 'vitest';
import type { PostMeta, Post } from '$lib/blog/types';

describe('PostMeta', () => {
  it('has expected shape', () => {
    const meta: PostMeta = {
      slug: 'test-post',
      title: 'Test Post',
      excerpt: 'An excerpt',
      coverImageUrl: null,
      tags: ['test'],
      publishedAt: '2026-04-04T00:00:00.000Z',
    };
    expect(meta.slug).toBe('test-post');
    expect(meta.tags).toEqual(['test']);
    expect(meta.coverImageUrl).toBeNull();
  });
});

describe('Post', () => {
  it('extends PostMeta with content fields', () => {
    const post: Post = {
      slug: 'test-post',
      title: 'Test Post',
      excerpt: 'An excerpt',
      coverImageUrl: null,
      tags: ['test'],
      publishedAt: '2026-04-04T00:00:00.000Z',
      content: 'Hello world',
      contentFormat: 'markdown',
      previewToken: 'abc-123',
    };
    expect(post.contentFormat).toBe('markdown');
    expect(post.previewToken).toBe('abc-123');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/lib/blog/types.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/blog/types.ts tests/lib/blog/types.test.ts
git commit -m "feat: update blog types with contentFormat, previewToken, coverImageUrl, tags"
```

---

## Task 4: Markdown Renderer

**Files:**
- Create: `src/lib/blog/renderer.ts`
- Test: `tests/lib/blog/renderer.test.ts`

- [ ] **Step 1: Write tests for markdown rendering**

Create `tests/lib/blog/renderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderContent } from '$lib/blog/renderer';

describe('renderContent', () => {
  it('renders markdown to HTML', () => {
    const result = renderContent('**bold** and *italic*', 'markdown');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('passes HTML through unchanged', () => {
    const html = '<p>Hello <strong>world</strong></p>';
    const result = renderContent(html, 'html');
    expect(result).toBe(html);
  });

  it('renders headings', () => {
    const result = renderContent('## Heading Two', 'markdown');
    expect(result).toContain('<h2');
    expect(result).toContain('Heading Two');
  });

  it('renders code blocks with language class', () => {
    const result = renderContent('```typescript\nconst x = 1;\n```', 'markdown');
    expect(result).toContain('<code class="language-typescript">');
  });

  it('renders links', () => {
    const result = renderContent('[link text](https://example.com)', 'markdown');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('link text');
  });

  it('renders images', () => {
    const result = renderContent('![alt](/static/img.png)', 'markdown');
    expect(result).toContain('<img');
    expect(result).toContain('src="/static/img.png"');
    expect(result).toContain('alt="alt"');
  });

  it('renders blockquotes', () => {
    const result = renderContent('> quoted text', 'markdown');
    expect(result).toContain('<blockquote');
    expect(result).toContain('quoted text');
  });

  it('renders lists', () => {
    const result = renderContent('- one\n- two\n- three', 'markdown');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
    expect(result).toContain('one');
  });

  it('renders inline code', () => {
    const result = renderContent('Use `console.log()` to debug', 'markdown');
    expect(result).toContain('<code>console.log()</code>');
  });

  it('defaults to markdown when format is not html', () => {
    const result = renderContent('**bold**', 'markdown' as const);
    expect(result).toContain('<strong>bold</strong>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/blog/renderer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the renderer**

Create `src/lib/blog/renderer.ts`:

```typescript
import { Marked } from 'marked';
import hljs from 'highlight.js';

const marked = new Marked({
  gfm: true,
  breaks: false,
  highlight(code: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {
        // fall through
      }
    }
    return hljs.highlightAuto(code).value;
  },
});

export function renderContent(content: string, format: 'html' | 'markdown'): string {
  if (format === 'html') return content;
  return marked.parse(content) as string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/blog/renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/renderer.ts tests/lib/blog/renderer.test.ts
git commit -m "feat: add markdown renderer with highlight.js code blocks"
```

---

## Task 5: Update Blog Data Layer

**Files:**
- Modify: `src/lib/blog/index.ts`

- [ ] **Step 1: Update `getAllPosts()` to include tags and coverImageUrl**

Replace the body of `getAllPosts()` in `src/lib/blog/index.ts`. The function should now:

1. Query `blogPosts` for published posts (same as before) but also select `coverImageUrl`
2. Separately query ALL tags from `blogPostTags` for published post IDs
3. Merge tags into the result objects
4. Return `PostMeta[]` (with `tags` and `coverImageUrl`)

```typescript
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import type { PostMeta, Post } from './types';

export async function getAllPosts(): Promise<PostMeta[]> {
  const posts = await db
    .select({
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
    .orderBy(desc(blogPosts.publishedAt));

  if (posts.length === 0) return [];

  const slugs = posts.map((p) => p.slug);
  const tagRows = await db
    .select({ postId: blogPostTags.postId, tag: blogPostTags.tag })
    .from(blogPostTags)
    .innerJoin(blogPosts, eq(blogPostTags.postId, blogPosts.id))
    .where(eq(blogPosts.status, 'published'));

  const tagMap = new Map<number, string[]>();
  for (const row of tagRows) {
    const existing = tagMap.get(row.postId) ?? [];
    existing.push(row.tag);
    tagMap.set(row.postId, existing);
  }

  // Get post IDs by slug to map tags
  const postIds = await db
    .select({ id: blogPosts.id, slug: blogPosts.slug })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'));

  const slugToId = new Map(postIds.map((p) => [p.slug, p.id]));

  return posts.map((p) => ({
    ...p,
    tags: tagMap.get(slugToId.get(p.slug) ?? -1) ?? [],
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
  }));
}
```

Note: This does an extra query for tag mapping. For the current scale (< 100 posts) this is fine. A future optimization could use a single join query.

- [ ] **Step 2: Update `getPostBySlug()` to include tags, coverImageUrl, contentFormat, previewToken**

```typescript
export async function getPostBySlug(slug: string): Promise<Post | null> {
  const rows = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      content: blogPosts.content,
      contentFormat: blogPosts.contentFormat,
      coverImageUrl: blogPosts.coverImageUrl,
      previewToken: blogPosts.previewToken,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.slug, slug))
    .limit(1);

  if (rows.length === 0) return null;
  const post = rows[0];

  const tagRows = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, post.id));

  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    contentFormat: post.contentFormat as 'html' | 'markdown',
    coverImageUrl: post.coverImageUrl,
    previewToken: post.previewToken,
    tags: tagRows.map((r) => r.tag),
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
  };
}
```

- [ ] **Step 3: Add `getPostsByTag()` function**

```typescript
export async function getPostsByTag(tag: string): Promise<PostMeta[]> {
  const posts = await db
    .select({
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .innerJoin(blogPostTags, eq(blogPosts.id, blogPostTags.postId))
    .where(eq(blogPostTags.tag, tag))
    .orderBy(desc(blogPosts.publishedAt));

  return posts.map((p) => ({
    ...p,
    tags: [tag],
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
  }));
}
```

- [ ] **Step 4: Add `getPostByPreviewToken()` function**

```typescript
export async function getPostByPreviewToken(token: string): Promise<Post | null> {
  const rows = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      content: blogPosts.content,
      contentFormat: blogPosts.contentFormat,
      coverImageUrl: blogPosts.coverImageUrl,
      previewToken: blogPosts.previewToken,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.previewToken, token))
    .limit(1);

  if (rows.length === 0) return null;
  const post = rows[0];

  const tagRows = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, post.id));

  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    contentFormat: post.contentFormat as 'html' | 'markdown',
    coverImageUrl: post.coverImageUrl,
    previewToken: post.previewToken,
    tags: tagRows.map((r) => r.tag),
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/index.ts
git commit -m "feat: update blog data layer with tags, coverImageUrl, getPostsByTag, getPostByPreviewToken"
```

---

## Task 6: Shared ProseContent Component

**Files:**
- Create: `src/lib/components/ProseContent.svelte`

- [ ] **Step 1: Create the ProseContent component**

Create `src/lib/components/ProseContent.svelte`. Extract the prose styles from the existing `src/routes/blog/[slug]/+page.svelte` (which has the most complete version at ~90 lines of CSS). The component is a wrapper that applies these styles to slotted content:

```svelte
<script lang="ts">
  let { class: className = '' }: { class?: string } = $props();
</script>

<div class="prose {className}">
  {@render children()}
</div>

{#snippet children()}
  <slot />
{/snippet}

<style>
  .prose :global(h1) { font-size: 2rem; font-weight: 700; margin: 2rem 0 1rem; }
  .prose :global(h2) { font-size: 1.5rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
  .prose :global(h3) { font-size: 1.25rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
  .prose :global(p) { margin: 0.75rem 0; line-height: 1.75; }
  .prose :global(a) { color: var(--accent); text-decoration: underline; }
  .prose :global(a:hover) { opacity: 0.8; }
  .prose :global(code) {
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.15em 0.4em;
    border-radius: 4px;
  }
  .prose :global(pre) {
    background: #0d0d0d;
    border: 1px solid var(--divider);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    margin: 1rem 0;
  }
  .prose :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.85rem;
    line-height: 1.6;
  }
  .prose :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    margin: 1rem 0;
    color: var(--text-secondary);
    font-style: italic;
  }
  .prose :global(ul), .prose :global(ol) { margin: 0.75rem 0; padding-left: 1.5rem; }
  .prose :global(li) { margin: 0.25rem 0; line-height: 1.65; }
  .prose :global(img) { max-width: 100%; border-radius: 8px; margin: 1rem 0; }
  .prose :global(hr) { border: none; border-top: 1px solid var(--divider); margin: 2rem 0; }
  .prose :global(table) { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  .prose :global(th), .prose :global(td) { border: 1px solid var(--divider); padding: 0.5rem 0.75rem; text-align: left; }
  .prose :global(th) { font-weight: 600; background: rgba(255, 255, 255, 0.03); }
</style>
```

Note: Copy the exact prose styles from `src/routes/blog/[slug]/+page.svelte` — the component above is representative. The implementer should read the current file and copy the actual styles to avoid divergence.

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/ProseContent.svelte
git commit -m "feat: add shared ProseContent component for blog prose styling"
```

---

## Task 7: Image Upload API Endpoint

**Files:**
- Create: `src/routes/api/admin/blog/upload-image/+server.ts`

- [ ] **Step 1: Create the upload endpoint**

Create `src/routes/api/admin/blog/upload-image/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const UPLOAD_DIR = '/opt/strange-rambling/static/images/blog';

export const POST: RequestHandler = async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get('image');
  const postId = formData.get('postId');

  if (!file || !(file instanceof File)) {
    return json({ error: 'No image file provided' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return json({ error: 'File too large (max 5MB)' }, { status: 400 });
  }

  // Ensure directory exists: /opt/strange-rambling/static/images/blog/{postId}/
  const dir = join(UPLOAD_DIR, String(postId ?? 'uncategorized'));
  await mkdir(dir, { recursive: true });

  // Sanitize filename and make it unique
  const ext = file.name.split('.').pop() ?? 'jpg';
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const filepath = join(dir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const url = `/static/images/blog/${postId ?? 'uncategorized'}/${filename}`;
  return json({ url });
};
```

Note: In development, this writes to the local filesystem. On the VPS, `/opt/strange-rambling/static/images/blog/` is served by the static file server. The deploy script (Task 13) ensures this directory exists.

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/admin/blog/upload-image/+server.ts
git commit -m "feat: add blog image upload API endpoint"
```

---

## Task 8: MarkdownEditor Component

**Files:**
- Create: `src/lib/components/MarkdownEditor.svelte`

This is the largest single task. The component wraps CodeMirror 6, provides a toolbar with shortcuts, preview toggle, auto-save, and paste image support.

- [ ] **Step 1: Create the MarkdownEditor component**

Create `src/lib/components/MarkdownEditor.svelte`. Key structure:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { markdown } from '@codemirror/lang-markdown';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { syntaxHighlighting, defaultHighlightStyle, foldGutter, indentOnInput } from '@codemirror/language';
  import { lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
  import { renderContent } from '$lib/blog/renderer';

  let {
    content = '',
    onSave,
    onAutoSave,
    uploadImage,
  }: {
    content?: string;
    onSave?: (content: string) => Promise<void>;
    onAutoSave?: (content: string) => Promise<void>;
    uploadImage?: (file: File) => Promise<string>;
  } = $props();

  let editorContainer: HTMLElement;
  let view: EditorView;
  let mode: 'edit' | 'preview' = $state('edit');
  let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = $state('idle');
  let wordCount = $state(0);
  let previewHtml = $state('');

  // Auto-save debounce
  let autoSaveTimer: ReturnType<typeof setTimeout>;

  function updateWordCount(text: string) {
    wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  }

  function readTime(words: number): string {
    const mins = Math.max(1, Math.ceil(words / 200));
    return `${mins} min read`;
  }

  // Toolbar actions
  function wrapSelection(before: string, after: string) {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
    });
    view.focus();
  }

  function prependLine(prefix: string) {
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: prefix },
    });
    view.focus();
  }

  function toggleBold() { wrapSelection('**', '**'); }
  function toggleItalic() { wrapSelection('*', '*'); }
  function insertHeading() { prependLine('## '); }
  function insertQuote() { prependLine('> '); }
  function insertBulletList() { prependLine('- '); }
  function insertOrderedList() { prependLine('1. '); }

  function insertLink() {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const linkText = selected || 'link text';
    view.dispatch({
      changes: { from, to, insert: `[${linkText}](url)` },
    });
    view.focus();
  }

  function insertCodeBlock() {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: `\n\`\`\`\n${selected}\n\`\`\`\n` },
    });
    view.focus();
  }

  async function triggerImageUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !uploadImage) return;
      const url = await uploadImage(file);
      const { from } = view.state.selection.main;
      view.dispatch({
        changes: { from, to: from, insert: `![${file.name}](${url})` },
      });
      view.focus();
    };
    input.click();
  }

  function handleImagePaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file && uploadImage) {
          uploadImage(file).then((url) => {
            const { from } = view.state.selection.main;
            view.dispatch({
              changes: { from, to: from, insert: `![image](${url})` },
            });
          });
        }
        return;
      }
    }
  }

  // Custom keybindings
  const blogKeymap = keymap.of([
    { key: 'Mod-b', run: () => { toggleBold(); return true; } },
    { key: 'Mod-i', run: () => { toggleItalic(); return true; } },
    { key: 'Mod-k', run: () => { insertLink(); return true; } },
    { key: 'Mod-s', run: () => { manualSave(); return true; } },
    { key: 'Shift-Mod-h', run: () => { insertHeading(); return true; } },
    { key: 'Shift-Mod-c', run: () => { insertCodeBlock(); return true; } },
    { key: 'Shift-Mod-i', run: () => { triggerImageUpload(); return true; } },
    { key: 'Shift-Mod-q', run: () => { insertQuote(); return true; } },
  ]);

  async function manualSave() {
    if (!onSave) return;
    const text = view.state.doc.toString();
    clearTimeout(autoSaveTimer);
    saveStatus = 'saving';
    try {
      await onSave(text);
      saveStatus = 'saved';
    } catch {
      saveStatus = 'error';
    }
  }

  function triggerAutoSave(text: string) {
    clearTimeout(autoSaveTimer);
    if (!onAutoSave) return;
    autoSaveTimer = setTimeout(async () => {
      saveStatus = 'saving';
      try {
        await onAutoSave(text);
        saveStatus = 'saved';
        setTimeout(() => { if (saveStatus === 'saved') saveStatus = 'idle'; }, 3000);
      } catch {
        saveStatus = 'error';
      }
    }, 3000);
  }

  function togglePreview() {
    if (mode === 'edit') {
      previewHtml = renderContent(view.state.doc.toString(), 'markdown');
      mode = 'preview';
    } else {
      mode = 'edit';
    }
  }

  onMount(() => {
    updateWordCount(content);

    view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          foldGutter(),
          indentOnInput(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          defaultKeymap,
          historyKeymap,
          blogKeymap,
          cmPlaceholder('Write your post in markdown...'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const text = update.state.doc.toString();
              updateWordCount(text);
              triggerAutoSave(text);
            }
          }),
          EditorView.domEventHandlers({
            paste: handleImagePaste,
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '14px' },
            '.cm-content': { fontFamily: "'SF Mono', Menlo, monospace", padding: '16px 0' },
            '.cm-gutters': { background: 'transparent', border: 'none', color: '#666' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
      parent: editorContainer,
    });

    return () => view.destroy();
  });
</script>

<div class="editor-wrapper">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-actions">
      <button onclick={toggleBold} title="Bold (Ctrl+B)"><strong>B</strong></button>
      <button onclick={toggleItalic} title="Italic (Ctrl+I)"><em>I</em></button>
      <button onclick={insertHeading} title="Heading (Ctrl+Shift+H)">H2</button>
      <button onclick={insertLink} title="Link (Ctrl+K)">🔗</button>
      <button onclick={insertCodeBlock} title="Code block (Ctrl+Shift+C)">&lt;/&gt;</button>
      <button onclick={triggerImageUpload} title="Image (Ctrl+Shift+I)">🖼</button>
      <button onclick={insertQuote} title="Quote (Ctrl+Shift+Q)">"</button>
      <button onclick={insertBulletList} title="Bullet list">•</button>
      <button onclick={insertOrderedList} title="Ordered list">1.</button>
    </div>
    <div class="toggle">
      <button class:active={mode === 'edit'} onclick={togglePreview}>Edit</button>
      <button class:active={mode === 'preview'} onclick={togglePreview}>Preview</button>
    </div>
  </div>

  <!-- Editor / Preview -->
  {#if mode === 'edit'}
    <div class="editor-area" bind:this={editorContainer}></div>
  {:else}
    <div class="preview-area">
      {@html previewHtml}
    </div>
  {/if}

  <!-- Status bar -->
  <div class="status-bar">
    <span>Markdown</span>
    <span class="save-status">
      {#if saveStatus === 'saving'}Saving...
      {:else if saveStatus === 'saved'}✓ Saved
      {:else if saveStatus === 'error'}⚠ Save failed
      {:else}—{/if}
    </span>
    <span>{wordCount} words · {readTime(wordCount)}</span>
  </div>
</div>

<style>
  .editor-wrapper {
    border: 1px solid var(--divider);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 400px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--divider);
    background: rgba(0, 0, 0, 0.2);
  }
  .toolbar-actions {
    display: flex;
    gap: 4px;
  }
  .toolbar-actions button {
    padding: 4px 8px;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--divider);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .toolbar-actions button:hover { background: rgba(255, 255, 255, 0.1); }
  .toggle {
    display: flex;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--divider);
  }
  .toggle button {
    padding: 4px 12px;
    font-size: 12px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .toggle button.active {
    background: var(--accent);
    color: white;
    font-weight: 600;
  }
  .editor-area {
    flex: 1;
    min-height: 350px;
    overflow: auto;
  }
  .preview-area {
    flex: 1;
    min-height: 350px;
    padding: 24px;
    overflow: auto;
    line-height: 1.75;
  }
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-top: 1px solid var(--divider);
    font-size: 11px;
    color: var(--text-secondary);
    background: rgba(0, 0, 0, 0.2);
  }
  .save-status { color: var(--accent); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/MarkdownEditor.svelte
git commit -m "feat: add MarkdownEditor component with CodeMirror, toolbar, auto-save, image paste"
```

---

## Task 9: Update Admin Blog API Routes

**Files:**
- Modify: `src/routes/api/admin/blog/+server.ts`
- Modify: `src/routes/api/admin/blog/[id]/+server.ts`

- [ ] **Step 1: Update `POST /api/admin/blog` to handle `contentFormat` and `previewToken`**

In `src/routes/api/admin/blog/+server.ts`, update the POST handler:

- Add `contentFormat` to the insert (default to `'markdown'`)
- The `previewToken` is auto-generated by the DB schema (`crypto.randomUUID()`), so no change needed for creation
- Include `contentFormat` and `coverImageUrl` in the GET list response

- [ ] **Step 2: Update `GET /api/admin/blog/:id` to return new fields**

In `src/routes/api/admin/blog/[id]/+server.ts`, update the GET handler to also select `contentFormat`, `coverImageUrl`, `previewToken`.

- [ ] **Step 3: Update `PUT /api/admin/blog/:id` to accept `contentFormat`, `coverImageUrl`, `previewToken`**

In the PUT handler, add these fields to the partial update pattern (same as existing fields — only set if present in the request body).

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/admin/blog/+server.ts src/routes/api/admin/blog/\[id\]/+server.ts
git commit -m "feat: update blog API routes for contentFormat, coverImageUrl, previewToken"
```

---

## Task 10: Update Admin Editor Page

**Files:**
- Modify: `src/routes/admin/blog/[id]/+page.svelte`
- Modify: `src/routes/admin/blog/[id]/+page.server.ts`

- [ ] **Step 1: Update server load to include new fields**

In `src/routes/admin/blog/[id]/+page.server.ts`, update the DB select to also fetch `contentFormat`, `coverImageUrl`, `previewToken`. Return them in the `post` object.

- [ ] **Step 2: Replace textarea with MarkdownEditor**

In `src/routes/admin/blog/[id]/+page.svelte`:

- Import `MarkdownEditor` from `$lib/components/MarkdownEditor.svelte`
- Import `ProseContent` from `$lib/components/ProseContent.svelte`
- If `data.post.contentFormat === 'markdown'`, render `<MarkdownEditor>` instead of the `<textarea>`
- If `data.post.contentFormat === 'html'`, keep the existing `<textarea>`
- Wire up `onSave` and `onAutoSave` to call the existing save API
- Wire up `uploadImage` to POST to `/api/admin/blog/upload-image?token=${adminToken}`
- Remove the inline `.prose` styles (replaced by ProseContent)
- Remove the separate preview section (MarkdownEditor handles it)

- [ ] **Step 3: Add cover image picker**

Add a cover image section above the editor:
- If `coverImageUrl` is set, show a thumbnail with a remove button
- An upload button that triggers the image upload endpoint and sets `coverImageUrl`
- Include `coverImageUrl` in the save payload

- [ ] **Step 4: Add preview link button**

Add a "Copy preview link" button:
- Copies `/blog/preview/${data.post.previewToken}` to clipboard
- A "Regenerate" button that calls PUT with a new UUID

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/blog/\[id\]/+page.svelte src/routes/admin/blog/\[id\]/+page.server.ts
git commit -m "feat: update admin editor with MarkdownEditor, cover image, preview link"
```

---

## Task 11: Update Admin Post List

**Files:**
- Modify: `src/routes/admin/blog/+page.svelte`
- Modify: `src/routes/admin/blog/+page.server.ts`

- [ ] **Step 1: Update server load to include `coverImageUrl`**

In `src/routes/admin/blog/+page.server.ts`, add `coverImageUrl` to the select.

- [ ] **Step 2: Add search, status tabs, and sort**

In `src/routes/admin/blog/+page.svelte`:

- Add `$state()` variables for `searchQuery`, `statusFilter` (`'all' | 'draft' | 'published'`), and `sortBy` (`'updatedAt' | 'createdAt' | 'title'`)
- Add a `$derived()` that filters and sorts `data.posts` based on these states
- Render a search input at the top
- Render tab buttons: All / Draft / Published
- Render a sort dropdown
- Show tags as small chips on each post row

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/blog/+page.svelte src/routes/admin/blog/+page.server.ts
git commit -m "feat: add search, status tabs, and sort to admin blog post list"
```

---

## Task 12: Update Public Blog Pages

**Files:**
- Modify: `src/routes/blog/+page.svelte`
- Modify: `src/routes/blog/+page.server.ts`
- Modify: `src/routes/blog/[slug]/+page.svelte`
- Modify: `src/routes/blog/[slug]/+page.server.ts`

- [ ] **Step 1: Update blog index to show tags and cover images**

In `src/routes/blog/+page.svelte`:
- Display tags as small pills below each post title
- If `coverImageUrl` is set, show a small thumbnail on the post card

In `src/routes/blog/+page.server.ts`:
- No changes needed (already calls `getAllPosts()` which now returns tags and coverImageUrl)

- [ ] **Step 2: Update blog post page for markdown rendering, tags, cover image**

In `src/routes/blog/[slug]/+page.server.ts`:
- No changes needed (already calls `getPostBySlug()` which now returns all fields)

In `src/routes/blog/[slug]/+page.svelte`:
- Import `ProseContent` from `$lib/components/ProseContent.svelte`
- Import `renderContent` from `$lib/blog/renderer`
- Replace `{@html data.post.content}` with `<ProseContent>{@html renderContent(data.post.content, data.post.contentFormat)}</ProseContent>`
- Remove the inline `.prose` styles (replaced by ProseContent)
- Show tags as pills below the title
- If `coverImageUrl` is set, render it as a hero image below the title
- If `coverImageUrl` is set, add `<meta property="og:image" content={data.post.coverImageUrl}>` to `<svelte:head>`

- [ ] **Step 3: Commit**

```bash
git add src/routes/blog/+page.svelte src/routes/blog/\[slug\]/+page.svelte
git commit -m "feat: render markdown, show tags and cover images on public blog pages"
```

---

## Task 13: Tag Index Page

**Files:**
- Create: `src/routes/blog/tag/[tag]/+page.server.ts`
- Create: `src/routes/blog/tag/[tag]/+page.svelte`

- [ ] **Step 1: Create server load**

Create `src/routes/blog/tag/[tag]/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { getPostsByTag } from '$lib/blog';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const posts = await getPostsByTag(params.tag);
  return { posts, tag: params.tag };
};
```

- [ ] **Step 2: Create page component**

Create `src/routes/blog/tag/[tag]/+page.svelte`. Use the same layout as the blog index page (`/blog`), but with a header like "Posts tagged '{tag}'" and a link back to `/blog`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/blog/tag/
git commit -m "feat: add tag index page at /blog/tag/[tag]"
```

---

## Task 14: Draft Preview Page

**Files:**
- Create: `src/routes/blog/preview/[token]/+page.server.ts`
- Create: `src/routes/blog/preview/[token]/+page.svelte`

- [ ] **Step 1: Create server load**

Create `src/routes/blog/preview/[token]/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { getPostByPreviewToken } from '$lib/blog';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const post = await getPostByPreviewToken(params.token);
  if (!post) throw error(404, 'Post not found');
  return { post };
};
```

- [ ] **Step 2: Create page component**

Create `src/routes/blog/preview/[token]/+page.svelte`. Same layout as the public post page (`/blog/[slug]`) but with:
- A banner at the top: "Draft preview — this post is not published" (with `noindex` meta)
- Same ProseContent rendering for content
- Same tags and cover image display

- [ ] **Step 3: Commit**

```bash
git add src/routes/blog/preview/
git commit -m "feat: add draft preview page at /blog/preview/[token]"
```

---

## Task 15: Update Deploy Script

**Files:**
- Modify: `scripts/deploy.sh`

- [ ] **Step 1: Add static images directory creation**

In `scripts/deploy.sh`, after the rsync step and before the restart, add:

```bash
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "mkdir -p /opt/strange-rambling/static/images/blog && chown $SSH_USER:$SSH_USER /opt/strange-rambling/static/images/blog"
```

Use the same SSH variables already defined in the script.

- [ ] **Step 2: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: ensure static images directory exists on VPS deploy"
```

---

## Task 16: Integration Test — Build and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
cd /home/john/strange_rambling_svelte && npm run check
```

Expected: No errors

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 4: Fix any issues found**

Address any type errors, test failures, or build errors.

- [ ] **Step 5: Final commit (if fixes needed)**

```bash
git add -A && git commit -m "fix: address build/typecheck issues from blog authoring changes"
```

---

## Task 17: Deploy

**Files:** None (deployment only)

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Run deploy script**

```bash
cd /home/john/strange_rambling_svelte && bash scripts/deploy.sh
```

- [ ] **Step 3: Verify on production**

Check that:
- `/admin/blog` loads with new search/tabs/sort UI
- Creating a new post opens the markdown editor
- Editor toolbar buttons work
- Preview toggle works
- Auto-save works (make edit, wait 3s, refresh page)
- Image upload works
- Cover image appears on public post
- Tags show on `/blog` and `/blog/[slug]`
- Tag page `/blog/tag/[tag]` works
- Draft preview link works for an unpublished post
- Existing HTML posts still render correctly
