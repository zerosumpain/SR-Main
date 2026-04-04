# Blog Authoring Improvements — Design Spec

**Date:** 2026-04-04
**Status:** Draft

## Overview

Overhaul the blog authoring experience to replace the raw HTML textarea with a markdown editor, add image upload, cover images, public tags, draft preview links, auto-save, and improved post management in the admin.

## 1. Data Model

### New column: `contentFormat`

Add to `blogPosts` table:

| Column | Type | Default | Values |
|---|---|---|---|
| `contentFormat` | text | `'html'` | `'html'` or `'markdown'` |

- Existing posts are `'html'` by default — zero migration, no data change
- New posts created through the admin default to `'markdown'`
- Public rendering checks `contentFormat`: if `'markdown'`, render through `marked` before `{@html}`. If `'html'`, render directly (current behavior)

### New column: `previewToken`

| Column | Type | Default |
|---|---|---|
| `previewToken` | text (uuid) | `gen_random_uuid()` |

Generated on post creation. Used for shareable draft preview links.

### API changes

`POST /api/admin/blog` — new posts send `contentFormat: 'markdown'` by default.
`PUT /api/admin/blog/:id` — accepts `contentFormat`, `coverImageUrl`, `previewToken` updates.
`GET /api/admin/blog/:id` — returns `contentFormat`, `coverImageUrl`, `previewToken`.
`GET /api/admin/blog` — list endpoint returns `coverImageUrl` for each post.

## 2. Markdown Editor

### Component: `MarkdownEditor.svelte`

Location: `src/lib/components/MarkdownEditor.svelte`

A Svelte 5 component wrapping CodeMirror 6 with the markdown language package.

**Toolbar buttons:**

| Button | Shortcut | Action |
|---|---|---|
| Bold | Ctrl+B | Wraps selection in `**...**` |
| Italic | Ctrl+I | Wraps selection in `*...*` |
| Heading | Ctrl+Shift+H | Prepends `## ` to current line |
| Link | Ctrl+K | Wraps selection in `[...](url)` or inserts `[](url)` |
| Code block | Ctrl+Shift+C | Wraps selection in triple backticks |
| Image upload | Ctrl+Shift+I | Opens file picker, uploads, inserts `![](url)` |
| Quote | Ctrl+Shift+Q | Prepends `> ` to current line |
| Bullet list | (toolbar only) | Prepends `- ` to current line |
| Ordered list | (toolbar only) | Prepends `1. ` to current line |

**Edit/Preview toggle:** Two-state toggle in the toolbar. Edit shows CodeMirror. Preview renders markdown through `marked` into a prose-styled container (same `.prose` styles as the public blog page, extracted into a shared component).

**Status bar:** Below the editor — auto-save indicator, word count, estimated read time.

**Paste image support:** Intercepts `paste` events on the CodeMirror editor. If the clipboard contains an image file, triggers the upload flow and inserts the resulting `![](url)` at cursor position.

**Auto-save:** Debounced 3-second timer. After any content change, waits 3 seconds of inactivity then calls the save API. Visual indicator shows "Saving..." / "Saved" / "Error" states. Manual Ctrl+S still works and resets the debounce timer.

### Editor page integration

`src/routes/admin/blog/[id]/+page.svelte`:

- If `contentFormat === 'markdown'` → render `MarkdownEditor` component
- If `contentFormat === 'html'` → render existing textarea (unchanged)
- A "Convert to Markdown" button on HTML posts — swaps `contentFormat` to `'markdown'` and leaves content as-is (author manually rewrites). One-way, with confirmation dialog. No automatic HTML-to-markdown conversion.

### Rendering pipeline

Public pages (`/blog/[slug]`):

- Fetch post from DB (includes `contentFormat`)
- If `'markdown'`: render content through `marked` (with GFM, syntax highlighting via `highlight.js` or similar)
- If `'html'`: render directly (current behavior)
- Shared prose styles via a `ProseContent.svelte` component (replaces the duplicated CSS blocks)

## 3. Image Upload

### Endpoint: `POST /api/admin/blog/upload-image`

**Request:** `multipart/form-data` with `image` file field and `postId` field.

**Validation:**
- Max file size: 5MB
- Allowed types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`

**Storage:** `/opt/strange-rambling/static/images/blog/{postId}/{timestamp}-{sanitized-filename}`

**Response:** `{ url: "/static/images/blog/{postId}/{filename}" }`

**Cleanup:** No automatic deletion. Old images remain until manually cleaned up.

### VPS setup

Deploy script (`scripts/deploy.sh`) must ensure:
- `/opt/strange-rambling/static/images/blog/` directory exists with correct permissions
- Caddy or the static file server serves `/static/images/` from the filesystem

## 4. Cover Images

- Surface the existing `coverImageUrl` column in the editor (it exists in the schema but is unused)
- Cover image picker in the editor page header area: upload button + preview thumbnail + remove button
- Uses the same upload endpoint, stores the resulting URL in `coverImageUrl`
- Public display:
  - `/blog` index: cover image on post cards (if set, otherwise fallback to no image)
  - `/blog/[slug]`: cover image as a hero banner below the title (if set)
  - `<meta property="og:image">` tag on post pages when cover image is set

## 5. Public Tags

### Data layer

- `getPostBySlug()` updated to join `blogPostTags` and return tags array
- `getAllPosts()` updated to include tags for each post
- New function `getPostsByTag(tag)` — returns all published posts with that tag

### Public pages

- `/blog/[slug]` — tags rendered as pills/chips below the post title
- `/blog` — tags shown on post list items
- `/blog/tag/[tag]` — new page listing all published posts with that tag, same layout as `/blog`

### Admin

- Tags continue to work as they do now (comma-separated input)
- Post list shows tags as small chips

## 6. Draft Preview Links

### Mechanism

- `previewToken` column (UUID) generated on post creation via `gen_random_uuid()`
- Public route: `/blog/preview/[previewToken]`
  - Serves the post content regardless of `status`
  - Renders identically to `/blog/[slug]` (same component, shared prose styles)
  - Adds a banner at top: "Draft preview — not published"
  - `noindex` meta tag to prevent search indexing
- "Copy preview link" button in editor toolbar area
- "Regenerate link" button — generates new UUID, invalidates old link

### Security

- No auth required — the UUID token IS the auth
- Tokens are long random UUIDs (128-bit), not guessable
- Regeneration available if a link is compromised

## 7. Post List Improvements

Admin `/admin/blog`:

- **Search input** — filters posts by title (client-side filter, real-time as you type)
- **Status tabs** — All / Draft / Published, filters the list
- **Sort** — by "Last updated" (default), "Created", "Title" — dropdown or toggle

All filtering is client-side against the already-loaded post list (no pagination needed for current scale).

## 8. Shared Prose Styles

Extract the duplicated prose CSS into a shared component:

- `ProseContent.svelte` — wrapper component that applies prose styling via a class
- Used by: admin preview, public post page, draft preview page
- Single source of truth for typography, spacing, code blocks, blockquotes, lists

## Dependencies

| Package | Purpose |
|---|---|
| `@codemirror/view` | Editor core |
| `@codemirror/state` | Editor state management |
| `@codemirror/lang-markdown` | Markdown language support |
| `@codemirror/language-data` | Syntax highlighting for fenced code blocks |
| `marked` | Markdown to HTML rendering |
| `highlight.js` (optional) | Syntax highlighting in rendered code blocks |

## File Changes Summary

### New files
- `src/lib/components/MarkdownEditor.svelte` — CodeMirror editor component
- `src/lib/components/ProseContent.svelte` — shared prose styles
- `src/routes/blog/tag/[tag]/+page.svelte` — tag index page
- `src/routes/blog/tag/[tag]/+page.server.ts` — tag index data loading
- `src/routes/blog/preview/[token]/+page.svelte` — draft preview page
- `src/routes/blog/preview/[token]/+page.server.ts` — draft preview data loading
- `src/routes/api/admin/blog/upload-image/+server.ts` — image upload endpoint

### Modified files
- `src/lib/db/schema.ts` — add `contentFormat`, `previewToken` columns
- `src/routes/admin/blog/[id]/+page.svelte` — swap textarea for MarkdownEditor, add cover image picker, preview link button
- `src/routes/admin/blog/+page.svelte` — add search, status tabs, sort
- `src/routes/admin/blog/+page.server.ts` — no changes needed (already loads all posts)
- `src/routes/blog/+page.svelte` — show tags and cover images on post cards
- `src/routes/blog/+page.server.ts` — include tags in loaded posts
- `src/routes/blog/[slug]/+page.svelte` — use ProseContent, show tags, cover image, render markdown
- `src/routes/blog/[slug]/+page.server.ts` — include tags in loaded post
- `src/lib/blog/index.ts` — update queries to include tags, add `getPostsByTag()`
- `src/routes/api/admin/blog/+server.ts` — handle `contentFormat` on create
- `src/routes/api/admin/blog/[id]/+server.ts` — handle `contentFormat`, `coverImageUrl`, `previewToken` on update; include in GET response
- `scripts/deploy.sh` — ensure static images directory exists on VPS
