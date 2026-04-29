# Blog Assistant + Viewership Analytics — Design

Date: 2026-04-29

## Summary

Two additions to the existing blog feature in `strange_rambling_svelte`:

1. **Blog editor AI assistant** — a chat panel inside `/admin/blog/[id]` that lets the user ask an in-page assistant to perform tasks on the post being edited. The assistant is a tool-using LLM with full read/write access to the post (title, excerpt, content, tags, slug, status, cover image, preview token) and defaults its context to the page it's on. (The user described this as "asking the orchestrator"; mechanically it's a lighter Vertex tool-use loop scoped to one post, *not* the heavy `src/lib/jkai/orchestrator.ts` autonomous-builder runtime — that one is built for sandboxed multi-iteration work and would be vast overkill here.)
2. **Viewership analytics** — self-hosted **Umami** tracking the public blog routes, with stats surfaced in the admin (`/admin/blog` list and `/admin/blog/[id]` editor page).

The two are independent and could ship in either order.

## Part A — Blog Editor AI Assistant

### Goals

- Single-click access to common authoring tasks ("rewrite this paragraph", "give me 5 alternative titles", "add tags", "publish this").
- The assistant always has the *current* draft (in-memory state of the editor, not just what's saved) as context.
- Direct application of changes (the user said: "C, but defaulting to the context of the page it's on") — the assistant can mutate the post directly, including publish/unpublish.

### UI

- New component `src/lib/components/BlogAssistantPanel.svelte`, mounted at the bottom of `src/routes/admin/blog/[id]/+page.svelte`.
- Collapsible (closed by default). Header shows "Assistant" + collapse toggle.
- When open: a scrolling transcript (user messages, assistant text, tool-call lines like `✓ updated title to "…"`) and an input box with Enter-to-send.
- Each tool call rendered as a one-line system entry with an `Undo` link that reverts that single change (server-side; uses pre-call snapshot of the field).
- Cancel button on streaming responses (aborts the SSE).
- Uses the existing `.nm-sec` / `.nm-text-input` / `.nm-save-btn` design language from the rest of `/admin/*`.

### API

- `POST /api/admin/blog/[id]/assistant` — accepts `{ message: string }`, streams a response via Server-Sent Events.
- Auth: existing admin token pattern (`?token=…` query param + `verifyAdmin()` helper used by the rest of `src/routes/api/admin/blog/`).
- Event types streamed:
  - `text` — incremental assistant text delta.
  - `tool_call` — `{ name, arguments }` (announced before execution).
  - `tool_result` — `{ name, ok, result, undoToken }` (after execution; `undoToken` lets the panel POST an undo).
  - `post_state` — full updated post payload after each mutating tool, so the editor can re-sync.
  - `done` — terminal event.
  - `error` — terminal event with `{ message }`.
- `POST /api/admin/blog/[id]/assistant/undo` — accepts `{ undoToken }` and reverts the recorded snapshot for that token.

### Backend

- New `src/lib/blog/assistant/` directory:
  - `tools.ts` — defines each tool (name, JSON-schema parameters, server handler). Tools wrap existing repo functions in `src/lib/blog/index.ts` (extending where needed). Each handler returns the new field value and an undo snapshot.
  - `runner.ts` — the LLM tool-use loop. Calls `$lib/vertex` with the post-as-context system prompt and the tool definitions; runs up to 6 tool-call rounds before stopping (hard cap to prevent runaway loops).
  - `prompt.ts` — system prompt template; includes the post's current title/excerpt/tags/status/slug/content (truncated if >40k chars) and a short style guide (warm-brutalist tone, British English, etc., reusing existing language from `src/lib/blog/`).
  - `undo-store.ts` — in-memory map of `undoToken -> { postId, field, previousValue, expiresAt }`, 30-minute TTL.
- New file `src/lib/vertex/tool-loop.ts` — generic helper for running a Vertex tool-use loop (so other features can reuse it). Returns an async iterator of stream events.

### Tools available to the assistant

Each tool runs server-side, applies the change atomically, and records an undo snapshot:

| Tool | Parameters | Effect |
|------|------------|--------|
| `update_title` | `{ title: string }` | Sets `blog_posts.title` |
| `update_excerpt` | `{ excerpt: string }` | Sets `blog_posts.excerpt` |
| `update_slug` | `{ slug: string }` | Sets `blog_posts.slug`, validates uniqueness |
| `update_tags` | `{ tags: string[] }` | Replaces tags in `blog_post_tags` |
| `replace_content` | `{ content: string, format?: 'html'\|'markdown' }` | Replaces full body |
| `patch_content` | `{ find: string, replace: string }` | Substring replace; errors if `find` not unique |
| `set_status` | `{ status: 'draft'\|'published' }` | Sets status (handles `publishedAt`) |
| `regenerate_preview_token` | `{}` | Issues a new `previewToken` |
| `set_cover_alt` | `{ alt: string }` | (Requires new `coverImageAlt` column — see schema change.) |
| `read_post` | `{}` | Returns the current full post payload (no DB write) |

### Schema changes

- `blog_posts.cover_image_alt text` — new nullable column to support `set_cover_alt`.
- New table `blog_assistant_messages`:
  ```
  id              serial primary key
  post_id         integer not null references blog_posts(id) on delete cascade
  role            text not null  -- 'user' | 'assistant' | 'tool'
  content         text not null  -- assistant text, user message, or JSON tool record
  created_at      timestamp default now()
  ```
  Used to persist conversation history per post. Loaded into the assistant's context on each request (last N=20 messages). Visible in the panel transcript when the editor is reopened.

(Schema change applied via `npx drizzle-kit push` per project convention.)

### Error handling

- Streaming errors close the SSE with a final `error` event; the panel shows it as a banner.
- Tool failures (e.g. `update_slug` collision) are not fatal — the LLM sees the failure in its tool result and can either retry or apologise.
- Hard cap of 6 tool calls per user message; once hit, the loop ends with a `done` event noting the cap.
- Conversation history is truncated to last 20 messages on load to keep the prompt size bounded.

### Testing

- Unit tests for each tool in `tests/lib/blog/assistant/tools.test.ts` against an in-memory DB (existing test pattern).
- Integration test for `runner.ts` using a stubbed `$lib/vertex` client that scripts a sequence of tool calls.
- Manual test: open a draft, ask "give this a snappier title and add 3 tags", confirm both fields update and the editor reflects them without reload.

## Part B — Viewership Analytics (Umami)

### Goals

- Anonymous traffic counts and basic breakdowns (referrers, devices) for `/blog/*` routes.
- Numbers visible inside the admin without context-switching to a separate dashboard.
- Minimal infra footprint — Umami chosen over Plausible because Plausible needs Postgres + ClickHouse, while Umami runs as a single Node container against the existing Postgres.

### Deployment

- Add `umami` service to `~/vps-strange-rambling/docker-compose.yml`:
  - Image: `ghcr.io/umami-software/umami:postgresql-latest`.
  - `DATABASE_URL` points at the existing Postgres instance, new database `umami` (created on first deploy).
  - Listens on internal port `3000`; exposed at `https://analytics.strangeramblings.com` via Caddy reverse proxy.
  - Caddy config update in `~/vps-strange-rambling/Caddyfile` for the new subdomain.
- After first start: log into Umami, create a website entry for `strangeramblings.com`, copy the website ID and an API key into the VPS env (`UMAMI_WEBSITE_ID`, `UMAMI_API_KEY`, `UMAMI_API_BASE=https://analytics.strangeramblings.com`). Same env vars added to the SvelteKit container.

### Tracker injection

- New file `src/lib/components/UmamiTracker.svelte`:
  ```svelte
  <script>
    import { env } from '$env/dynamic/public';
  </script>
  {#if env.PUBLIC_UMAMI_SITE_ID && env.PUBLIC_UMAMI_SCRIPT_URL}
    <script async defer
      data-website-id={env.PUBLIC_UMAMI_SITE_ID}
      src={env.PUBLIC_UMAMI_SCRIPT_URL}></script>
  {/if}
  ```
- Mounted only in `src/routes/blog/+layout.svelte` (so it doesn't track admin or anything else).
- Public env vars: `PUBLIC_UMAMI_SITE_ID`, `PUBLIC_UMAMI_SCRIPT_URL` (e.g. `https://analytics.strangeramblings.com/script.js`).

### Server-side stats client

- `src/lib/umami/client.ts`:
  - `getStatsForPath(path, days)` → `{ pageviews, visitors }`.
  - `getStatsBatch(paths, days)` → `Record<path, { pageviews, visitors }>`. Umami's stats endpoint filters by a single URL per call, so this fans out to N parallel `fetch`es with `Promise.all`, deduped through the cache layer (so a post with cached fresh stats won't be re-requested).
  - `getTopReferrers(path, days, limit)` → `{ name, count }[]`.
  - `getDailyViews(path, days)` → `{ date, count }[]` for sparkline.
  - All responses cached in an in-memory `Map<key, { value, expiresAt }>` with a 5-minute TTL.
  - Uses `UMAMI_API_KEY` (server-only env var).
- `src/lib/umami/auth.ts` — handles Umami's bearer-token auth.

### Admin list integration

- `src/routes/admin/blog/+page.server.ts`:
  - Builds the list of post URLs (`/blog/<slug>` and `/blog/preview/<token>` where applicable — preview views excluded by default).
  - Calls `getStatsBatch(...)` with `days=7`.
  - Adds `views7d: number` and `visitors7d: number` to each post in the returned data.
- `+page.svelte`: new column in the post list ("Views (7d)") shown after `status`, hidden on mobile.

### Editor page integration

- New `src/lib/components/BlogStatsCard.svelte`:
  - Three numbers: total pageviews (lifetime), pageviews (30d), unique visitors (30d).
  - Sparkline of last 30 days (small inline SVG, no library — keep dependencies down).
  - Top 5 referrers.
- Mounted at the top of `/admin/blog/[id]` between `PageHeader` and the `Metadata` section. Fetches via a new server load addition (parallel to the existing post fetch).
- Loading state: skeleton shimmer for ~500ms; if Umami is unreachable, shows a small "stats unavailable" note (non-fatal).

### Testing

- Unit tests for the cache layer in `src/lib/umami/client.ts` (mock `fetch`).
- Integration test for the admin list with a stubbed Umami client returning known counts.
- Manual test: visit a post in incognito a few times, confirm the count appears in admin within ~5 minutes (cache TTL).

## Out of scope (explicitly)

- Signed-in identity tied to views (the user dropped this requirement; sticking with anonymous-only).
- Real-time view counters in the admin.
- A/B testing or funnels.
- Tracking outside `/blog/*`.
- Streaming the assistant's tool-use over WebSockets (SSE is sufficient for one-way server→client streaming).

## Open questions

None remaining at design time.
