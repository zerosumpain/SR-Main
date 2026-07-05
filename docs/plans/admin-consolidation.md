# Admin consolidation + redesign

Branch: `feature/admin-consolidation`. Approved scope: **full consolidation** + **hybrid top-nav + section sub-nav** header.

## Goals (John's asks)
1. Consolidated routes — 22 route families → 6 top-level sections.
2. Consistent header — replace the left sidebar with the site's `.site-nav-bar` + `SiteNav` top-nav (same chrome as `/jkai`).
3. Better-structured functionality — merge adjacent tools under section sub-navs; every page on `PageWrap`+`PageHeader`.
4. Clear route back to main site — brand mark links `/`, plus a pinned `View site ↗`.

## Target route map
```
/admin                         Overview (dashboard)
/admin/content/{blog,hero,effects}                            ← blog, hero, biome
/admin/connections/{health,files,gmail,scraper,credentials}   ← +integrations→credentials
/admin/ai/{keys,models,tools,approvals,config}                ← +jkai-approvals→approvals, +agent/config→config
/admin/ops/{agent,tasks,actions,costs,engine,sessions,cron,live} ← agent+hermes+pulse
/admin/access                  Access
DELETE: /admin/deepdive (308→ai/keys), /admin/login (dead alias of /login)
```

Top-nav sections: Overview · Content · Connections · AI · Ops · Access.

## Key facts (from audit + reference grep)
- Pages fetch `/api/admin/*` (absolute, stable) — API layer does NOT move.
- Only 5 colocated endpoints move with their page: `hero/{save,generate,delete}`, `integrations/[id]{,/status}`. Update those pages' own fetch strings.
- Only ~14 true page-nav `<a href>` links to moving routes.
- `/admin/scheduled` is a dead link (no route) → repoint to `/admin/ops/cron`.
- Auth: `hooks.server.ts` gates whole authed area to owners; moved routes stay under `/admin` so still gated.

## Phases
- **A — Chrome:** `admin-nav.ts` (nav config, single source of truth) · `AdminTopNav.svelte` · `AdminSubNav.svelte` · rewrite `AdminShell.svelte` to compose them (drop sidebar).
- **B — Routes:** `git mv` page dirs → 5 section parents; add 5 section `+layout.svelte`; delete deepdive/login stubs; redirect table in `hooks.server.ts`; fix 14 links + dashboard tiles + hero/integrations colocated fetches + `/admin/scheduled`.
- **C — Structure/sweeps:** migrate files, credentials, live(pulse), engine/sessions/cron(hermes) → PageWrap+PageHeader; models panels → `.nm-*`; purge OpenClaw copy; delete dead CSS; alert()→banner; emoji→SVG.
- **D — Verify+deploy:** `npm run check` + `npm run build` (heap prefix, sandbox off) → local prod-build headless QA (screenshots + redirect curls) → deploy.sh → verify live.

## Verification
- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` clean.
- `curl -I` each old URL → 308 to new path.
- Headless screenshot each section renders top-nav + sub-nav + View-site link.
- ship skill step 6 live-grep after deploy.
