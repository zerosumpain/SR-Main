# Unified site navigation

**Brief (John, 2026-09-03):** "There's a consistent navigation bar on the main page,
and a sub page navigation bar pattern that you can see on /jkai and /health. I want
every page to follow the same top nav-bar pattern. It must have a common way of going
back to the parent page (ie /jkai/research must go back to /jkai if i click on it)
and have a small 'home' icon on the top left."

Grade: **Full autonomy** ("do this autonomously"). No approval gates; every fork is a
Decision Log entry below.

## What is actually there today

A survey of all 16 layouts and 212 `+page.svelte` files (11 parallel readers) found
**five** nav dialects, not two:

| Dialect | Mount | Pages |
|---|---|---|
| `.site-nav-bar` cell strip | `PageHeader.svelte` → `SiteNav.svelte` | 58 |
| `HealthShell` sticky head | component, not layout | 7 (incl. `/news`) |
| `HubHeader` + `JkaiTabBar` + `pageMenu` | `/jkai/+layout.svelte` | ~45 |
| `AdminTopNav` + `AdminSubNav` | `AdminShell` | ~35 |
| Bespoke masthead or **nothing at all** | 8 project layouts + loose pages | ~65 |

They already agree on the *ground* — `background: var(--text-primary)`, `color: var(--bg)`,
`--accent-on-dark` for accents. They disagree on *structure*. So this is a structural
unification, not a re-skin.

### Real defects the survey turned up (fixed here, not deferred)

1. **Anonymous visitors are shown owner-only destinations.** `SITE_ITEMS`
   (`PageHeader.svelte:29`) lists `/news`, `/jkai`, `/drive`; none is in `PUBLIC_PATHS`.
   Every one of those cells 302s a logged-out reader to `/login`. Live today on `/`,
   `/blog/*`, `/projects`, `/decks`, `/heart`, `/releases`.
2. **`--site-nav-height` is declared twice** — `app.css:196` says 56px, `+layout.svelte:55`
   says 48px, and stylesheet order decides. Twelve places do arithmetic on it.
3. **`/news` and `/news/[source]/[id]` subtract a nav bar they never render** — a phantom
   48px, plus sticky rails parked against a header of a different height.
4. **`.site-nav-bar` has no `@media print`**, so the ink band prints on every page.
5. **`/jkai/shared/[token]`** — the one anonymous jkai surface — inherits the full
   `HubHeader` and shows a public visitor the day's token spend, GBP cost, OpenRouter
   credit balance and Codex quota.

## The shape

**One manifest + one component + adapters**, modelled on `admin-nav.ts`, which is the
repo's existing precedent for exactly this.

- `src/lib/nav/site-nav.ts` — pure, tested. Given a pathname it answers: which section
  you are in, that section's sub-nav (with `ownerOnly` flags), the parent href for the
  back link, and whether the route is carved out of shared chrome.
- `src/lib/components/SiteHeader.svelte` — renders `.site-nav-bar` as cells, left to right:
  **home icon → back-to-parent → section title → sub-nav cells → right slot**.
- Adapters so ~200 pages inherit it without 200 edits: `PageHeader`, `HealthShell`,
  `HubHeader`, `AdminTopNav`, and the six field-study layouts.

### Cell order

    [⌂] [← jkai] [ Intel ] [ MAIL  NOTES  REVIEW  … ] ······················· [ right slot ]
     ^     ^         ^            ^                                              ^
     |     |         |            └ section sub-nav, aria-current on the active  └ live signal /
     |     |         └ section name, links to section root                          meters / actions
     |     └ parent, one level up — the "common way back"
     └ home, every page, top-left

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Where nav truth lives | per-page props / derive from route tree / one manifest | **one manifest** (`site-nav.ts`) | `admin-nav.ts` already does this and is the only nav in the repo that is coherent. Deriving from the route tree would resurrect `/projects/landgrab` — an owner-only surface under a public prefix, deliberately absent from every index. | yes |
| 2 | Mount point | `src/routes/+layout.svelte` / per-family adapters | **per-family adapters** | `/jkai/run/+page@.svelte` resets to the *root* layout precisely to escape chrome. A root-layout header is inherited by the one page that exists to have none, with no `@`-escape above root. | yes |
| 3 | Bar height | new responsive height / keep 48px | **keep 48px**, and delete the dead 56px duplicate | 12 sites do arithmetic on `--site-nav-height`, incl. the landing hero and all three `/heart` heroes. Changing it silently resizes them. | yes |
| 4 | Home affordance | keep the text `HOME` cell / small icon | **inline SVG house cell, first** | The brief says "small 'home' icon on the top left". Text `HOME` is dropped from the item list so it is not offered twice. Inline SVG matches `AdminTopNav`'s existing arrow — the repo has no icon component and `sr-design` bans emoji. | yes |
| 5 | Back affordance | reuse `titleHref` / its own cell | **its own cell** | `titleHref` currently makes one cell mean both "this page" and "go up" (`/blog/tag/[tag]`). Separating them is what makes `/jkai/research → /jkai` legible. | yes |
| 6 | Anonymous leak | leave / add `ownerOnly` | **`ownerOnly` on manifest items**, derived from both `auth.ts` PUBLIC_PATHS *and* `gate-bypasses.ts` | Unifying without it would propagate the leak to every page instead of 6. | yes |
| 7 | Field studies | replace masthead / add a bar above it / **fold inside `.topstack`** | **fold inside `.topstack`** | Six layouts measure their own masthead with `bind:clientHeight={topH}` and eight arithmetic sites offset against `--topH`. A bar above `.topstack` is invisible to that measurement and drops the Three.js simulator's HUD below the fold. | yes |
| 8 | Full-viewport / export / PWA routes | force the bar everywhere / carve out | **carve out, 11 routes** | `position: fixed; inset: 0` shells cover anything sticky; `/decks/[slug]/print` is a headless-browser PDF+OG target; `/capture` and `/projects/broads-pilot` are separate installable PWAs whose scope a `/` link escapes. Listed in `EXCLUDED_PREFIXES` with a reason each. | yes |
| 9 | `/jkai/shared/[token]` spend leak | out of scope / fix | **fix** — anonymous variant, no meters | Found while inventorying the same component. Leaving a known public-facing spend disclosure in place to keep the diff tidy is the wrong trade. | yes |

## Verification

- `npx vitest run tests/lib/nav/site-nav.test.ts` — manifest unit tests (parent walking,
  owner filtering, exclusions, no hidden route ever emitted).
- `npm run gate:public-routes` — unchanged snapshot (no new anonymous routes).
- `npm run gate:font-sizes` — no literal under 12px in the new markup.
- `./scripts/gate-remote.sh` — full gate on porkserv.
- Live: `curl https://strangeramblings.com/<path>` and grep `data-site-header` on a page
  from each family; confirm the home icon and back link render.
