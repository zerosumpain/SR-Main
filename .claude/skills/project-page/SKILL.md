---
name: project-page
description: Use when creating a new /projects/<slug> page (field study, tool, game), changing project visibility (public/private, share links), adding a public API endpoint for a project, or when a project page/asset unexpectedly 404s or an API route redirects anonymous users to login.
---

# Project pages — structure, visibility, public APIs

## New SvelteKit project page

1. Route: `src/routes/projects/<slug>/` with `+page.svelte` + `+page.server.ts`.
2. **Visibility guard** in `+page.server.ts` load: call `requireProjectPublic()` from `src/lib/projects/guard.ts` (404s anon viewers of private projects; owner + share-token holders pass).
3. Field-study structure: story components are per-project copies, NOT global — copy `StoryMasthead.svelte` / `StorySection.svelte` from `src/routes/projects/policy-engine/components/` (or `dfe-data-strategy/components/`) into `<slug>/components/`. Story model pattern (incl. `dataAsk: string[]` — "what data we'd need to monitor this") lives in `policy-engine/lib/stories.ts`.
4. Add the project card to the index: `src/routes/projects/+page.svelte` (fed by its `+page.server.ts`, which hides private projects from anon).
5. Styling: use the `sr-design` skill.

## Visibility model

- Table `projectVisibility` (`src/lib/db/schema.ts`); logic `src/lib/projects/visibility.ts` — **public unless an explicit `isPublic=false` row exists**. WIP that shouldn't be visible on prod needs that row created (toggle on `/projects` as owner, or `POST /api/projects/visibility {key, isPublic}`).
- Going private purges the Cloudflare edge (`purgeProjectCdn`) — only active with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` on the VPS.
- Share access: `?t=<token>` or per-project `psh_<key>` cookie.

## Public API endpoints (recurring gotcha)

A project's public API route (leaderboards, ingest, vitals…) must have its prefix added to **`PUBLIC_PATHS` in `src/lib/auth.ts`** (`isPublicPath` matches exact or prefix). Do NOT reach for `PUBLIC_API_PATHS` in `src/hooks.server.ts` — it's a second, exact-match-only allowlist (currently load-bearing for `/api/family-presence/stats` only); prefix routes added there silently won't match. Symptom of using the wrong one: anonymous requests get the login redirect / 401 instead of data. Examples already in `PUBLIC_PATHS`: `/api/landing/vitals`, `/api/space-lander`, `/api/broads-pilot`.

## Static bundles (games etc.)

Bundles under `data/jkai-projects/<slug>/` are served at `/projects/<slug>/...` by `src/routes/projects/[slug]/[...path]/+server.ts` — files read from disk at request time (path-traversal guard, SPA `index.html` fallback, same visibility 404 gate). No rebuild to update a bundle → use the `bundle-deploy` skill. Dir resolver: `getPublishedDir()` in `src/lib/jkai/sandbox.ts` (`/opt/strange-rambling-svelte/data/jkai-projects` on the VPS).

## Common mistakes

- Adding a public API route and editing the hooks `PUBLIC_API_PATHS` (exact-match only) instead of `src/lib/auth.ts` `PUBLIC_PATHS`.
- Forgetting `requireProjectPublic()` in the page load — private project leaks.
- Putting bundle assets in `static/` — they belong in `data/jkai-projects/` (visibility-gated, no-rebuild updates).
- Testing prod-private pages anonymously on prod — impossible; QA locally (see `local-qa`: local DB has policy-engine public).
