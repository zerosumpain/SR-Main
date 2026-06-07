# Project Visibility Toggle — Design

**Date:** 2026-06-07
**Status:** Approved, implementing autonomously to production.

## Goal

Let an authenticated user toggle, per project, whether it is **displayed** on `/projects`
and **accessible** at its URL for the public. Private projects vanish from the listing and
return `404` to the public, while the authed owner can still open them to preview.

Scope: **all** projects — the hardcoded Field Study cards and the DB-driven AI-built builds.

## Background — three serving paths behind `/projects/*`

| Project | Served by | Gate strategy |
|---|---|---|
| `data-convergence`, `dfe-data-estate`, `policy-engine` | SvelteKit routes (`+page.svelte`) | `load` guard throws `error(404)` |
| `whitehall`, `brass-and-rails` | Static files in `static/projects/` (sirv — bypasses hooks) | **Relocate** into `data/jkai-projects/` so the dynamic route serves + gates them |
| AI-built (`publishedSlug`) | `[slug]/[...path]/+server.ts` from `data/jkai-projects/` | Visibility check in the handler |

`/projects` and `/projects/*` are already public paths (`src/lib/auth.ts`), so requests reach
our guards/handlers without the auth hook intercepting. `/api/*` is auto-gated by the hook
(401 when unauthed; bypassed on the homeserv LAN via `AUTH_BYPASS`) — so the toggle endpoint
must **not** add its own `locals.auth()` 401 check (matches the existing `unpublish` endpoint).

## Data model

New overlay table — **absence of a row means public**, so nothing changes until something is flipped:

```ts
export const projectVisibility = pgTable('project_visibility', {
  projectKey: text('project_key').primaryKey(), // URL segment after /projects/
  isPublic:   boolean('is_public').notNull().default(true),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`projectKey` is always the path segment after `/projects/`: a static key
(`data-convergence`, `dfe-data-estate`, `policy-engine`, `whitehall`, `brass-and-rails`) or an
AI-built `publishedSlug`. Applied via `npx drizzle-kit push`.

## Pure logic (`src/lib/projects/visibility.ts`) — TDD'd

- `resolveVisibilityMap(rows)` → `Record<string, boolean>`.
- `isProjectPublic(map, key)` → `map[key] ?? true` (default public).
- `filterForViewer(items, map, authed)` → authed sees all; public sees only `isProjectPublic`.

`src/lib/projects/registry.ts`: `STATIC_PROJECT_KEYS` (the five carded keys) + a helper to
build the allowed-key set (static ∪ current published slugs) for API validation.

## Serving & gating

1. **Relocate carded bundles:** `git mv static/projects/{whitehall,brass-and-rails}` →
   `data/jkai-projects/`. They then serve through the existing dynamic route and deploy via the
   current `data/` rsync; the old static copies drop off prod via the `build/ --delete` sync.
   Card hrefs (`/projects/whitehall/`, `/projects/brass-and-rails/`) are unchanged.
   - `compound-interest` and `jkai-workflow-improvements` are not carded anywhere → left as-is.
2. **Trailing slash (critical):** the bundles use relative `./assets/...` across multiple HTML
   files. The route gets `export const trailingSlash = 'ignore'` (like the `dav` route) so
   SvelteKit never strips the slash, plus the handler 308-redirects a bare project root
   (`/projects/<slug>` with empty sub-path, no trailing slash) to `/projects/<slug>/` so
   relative paths always resolve regardless of how the URL was typed.
3. **Dynamic handler** (`[slug]/[...path]/+server.ts`): take `locals`; if the slug is private
   and the viewer is not authed → `404` (covers the page **and** its assets). Authed → serve.
   Private-authed responses get `Cache-Control: private, no-store` + `X-Robots-Tag: noindex`.
4. **Route-projects guard:** `requireProjectPublic(key, locals)` in `src/lib/projects/guard.ts`
   throws `error(404)` when private & unauthed. Wired into `data-convergence/+page.server.ts`
   (new), `dfe-data-estate/+page.server.ts` (existing), `policy-engine/+layout.server.ts`
   (new — covers all six subroutes).

## Listing page + inline toggle

- `/projects/+page.server.ts`: load the visibility map; for the published builds attach each
  one's `isPublic`. Public visitors get private cards filtered out (hardcoded + DB); authed
  visitors get everything plus flags + the map.
- `/projects/+page.svelte`: when `data.authenticated`, each card shows a small **Public /
  Private** switch in its controls row and a `Private` badge when hidden. Toggling does an
  optimistic `POST /api/projects/visibility`. Hardcoded cards are wrapped in
  `{#if data.authenticated || vis['<key>']}`. The existing destructive **Remove** stays on
  AI-built cards (delete published files ≠ soft-hide).

## API

`POST /api/projects/visibility` — body `{ key, isPublic }`. Validates `key` ∈ (static keys ∪
current published slugs); upserts the row (`onConflictDoUpdate` on `projectKey`). Auth is
enforced by the hook. Returns `{ ok: true }` or `400` for an unknown key.

## Out of scope / notes

- `sitemap.xml` does **not** list project URLs, so no sitemap change is needed.
- On the homeserv LAN (no Google session, `AUTH_BYPASS`), `locals.auth()` is null, so the
  toggle UI and authed-preview don't appear there — same as the existing Remove button. The
  feature is operated on prod (`strangeramblings.com`) where the owner is signed in.

## Testing

- Unit (vitest): visibility resolver — default-public, row override, viewer filtering.
- Manual / post-deploy curl on prod: private project absent from listing HTML; direct URL +
  an asset path both 404 for the public across all three serving paths; toggle round-trips.

## Known caveat — CDN edge cache (eventual consistency)

The origin gate is exact: a private project's page **and** assets return 404 (verified with a
cache-busting query). But Cloudflare edge-caches static-extension assets (`.js`/`.css`) with a
~4h TTL. An asset fetched while a project was **public** stays in the edge cache after the
project is toggled private, so a hashed asset URL someone already holds can still be served by
the CDN until it ages out. The HTML entry point is **not** CDN-cached, so the project 404s and
cannot load/be discovered for the public — only individual already-cached asset files leak,
briefly.

Pages are unaffected; this only matters for assets of a project that was public then hidden.
To make it instant, either: (a) provision a Cloudflare API token (zone + `cache_purge`) and
purge `'/projects/<key>/*'` in the toggle handler when `isPublic→false`; or (b) add a
Cloudflare cache rule to bypass cache on `/projects/*`. Neither is wired (no CF token exists;
the site fronts via a cloudflared tunnel).
