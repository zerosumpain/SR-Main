# Daydream rooms — P1 of the 2026-09-02 overhaul

Autonomous build. Brief: John's six asks on `/jkai/daydreams` (2026-09-02),
"go with your recommendations, crack on with P1". The full slate (32 items,
8 decisions) is the artifact linked from `project_daydream_overhaul_review`
memory. This spec covers **P1: rooms and primitives** (items 1.1–1.8).

## What is wrong, measured

- `+page.svelte` is 6,043 lines across eleven tabs. `+page.server.ts` runs
  sixteen ledger loaders plus four more on every arrival, for every tab.
- Twenty-five sections are raw row dumps with no rollup.
- `.board` cells are ragged (`align-items: start`); `.grid` is
  `auto-fit minmax(300px, 1fr)`.
- Colour is priority-only (`priority.ts`), so the six kind families are
  visually identical; `kindChip()` prints raw slugs.
- A `?tab=` link is a same-route navigation; an effect follows the URL, and
  that trap has already killed five shipped links.
- `loadFamily` is an N+1 by construction (2–3 queries per subject, then a
  board load per subject).

## Design

### Rooms are routes

```
src/routes/jkai/daydreams/
  +layout.server.ts   hub counts (cheap COUNTs only) + enabled flag
  +layout.svelte      DaydreamShell: cover, readout, rail of LINKS, paused banner,
                      and the shared `.ds-vocab` CSS vocabulary (:global)
  +page.server.ts     redirect → /feed, mapping ?tab=X → /X and keeping ?rate=
  feed/ memory/ briefing/ watches/ family/ discoveries/ calendar/ places/
  money/ engine/ improvement/     each: +page.server.ts + +page.svelte
```

Precedent: `/jkai/intel` (layout.server = ten COUNT queries; sub-routes own
their expensive loads). The old `?tab=` links redirect at the root page;
`hooks.server.ts`'s three legacy redirects point at the rooms directly.

### Three primitives, in `components/jkai/daydream/hub/`

- `RollupGrid` — even cells (`grid-auto-rows: 1fr`, `align-items: stretch`),
  bounded content: mono label, display figure, one sub line (2-line clamp),
  optional sparkline, optional href/onclick. Replaces the ad-hoc tile decks
  where the tile is a *category* rather than a headline statistic
  (`StatDeck` stays for the masthead and money/engine headline decks).
- `CategoryMatrix` — rows × columns of counts; every non-zero cell is a link
  or a button; row and column totals; the active cell is marked.
- `DrillPanel` — the thought overlay extracted: portal to body, backdrop,
  Escape, wrapping header (kicker, chips, close), scrolling body, footer
  snippet. Same shell as `RelationshipModal` so the two jkai overlays read as
  one object.
- `FactList` — label/value rows with optional href and tone, for the
  structured half of a drill.

`Room` is not a component: `+layout.svelte` wraps `children` in
`<div class="ds-vocab">` and declares the shared vocabulary (`.band .inner
.card .pill .tag .tbl .btn .cta .note .stack .grid .mark …`) as `:global`
rules under it. One copy, no CSS import from a route file (the vite-pwa
trap), and `DrillPanel` puts `ds-vocab` on its own panel so portalled content
is styled too.

### Feed is a category matrix (1.4)

Families (places / mail / musings / graph / rules / patterns, from
`thought-groups.ts`) × states:

| state | statuses |
|---|---|
| sent | delivered, seen |
| undecided | new |
| held | suppressed |
| filed | archived, dismissed, actioned, snoozed |

`loadFeedMatrix()` is one grouped query over the whole table (not the last
60 rows). Selecting a cell is a URL (`/feed?f=musings&s=held`) so it is
shareable and server-rendered; `loadFeedCell()` returns up to 50 rows for it.
Default cell: the **undecided** column across all families. A row is one
line: family mark · headline · verdict · likelihood · when · quick actions.
Opening a row opens the `DrillPanel` with the existing overlay content.

### Family mark (1.6)

`familyMark(kind)` in `thought-groups.ts` → `PLACE MAIL MUSE GRAPH RULE
PATTERN`. Rendered as a mono kicker (`.mark`). `priority.ts` stays the only
colour authority.

### Cheaper loads (1.8)

`loadFamily` becomes two grouped queries (per-subject aggregates in one,
per-subject board rows in one with a window function). The feed loads counts
plus the selected cell's rows, nothing else. Every room's `load` calls only
the loaders it renders. `loadLedger()` survives for the `GET /api/daydream/
thoughts` JSON endpoint and its test.

### Engine room (1.7)

One even cell per activity in a `RollupGrid`, grouped by stage:

| stage | activities |
|---|---|
| observe | observe, places, signals, features, bank, spend, offers, mail, notebook, memory |
| discover | sweep, hypothesise, explore, ponder, intel |
| test | review, rulesmith |
| propose | compose, suggest, detect, digest, weekly |
| improve | improve |

Cell: cadence, last run, next run, outcome dot, cost. The detectors table,
rules table, budget deck, coverage sparkline and provenance keep their data
but each opens on a rollup.

## Verification

- `svelte-check` 0 errors; the five lint gates by name from the worktree;
  `gate-remote.sh --build` on porkserv.
- Playwright on homeserv against the built server: each of the eleven routes
  returns 200, no horizontal overflow at 390px (`document` and `.jkai-body`),
  screenshots at 1440×3600 with `uiseed-` fixtures, deleted afterwards and
  the gate re-run after the delete.
- Live: `.deploy-sha` matches the merge; `/jkai/daydreams` and
  `/jkai/daydreams/feed` answer (302 to auth for a stranger).

## Decision Log

| # | fork | chosen | why | reversible |
|---|---|---|---|---|
| 1 | routes per room vs one page with lazy tabs | routes | John's D1(a); kills the `?tab=` effect trap and the per-arrival load | yes, routes can be re-merged |
| 2 | shared CSS: import a `.css` from the route vs `:global` in the layout | `:global` under `.ds-vocab` in `+layout.svelte` | a standalone CSS import from a route file breaks the vite-pwa build | yes |
| 3 | badge counts in the layout vs each room | layout, COUNT queries only | the rail is on every room; `/jkai/intel` precedent | yes |
| 4 | feed cell selection in URL vs client state | URL (`?f=&s=`) | shareable, SSR, no client fetch for the first paint | yes |
| 5 | `familyMark` as colour vs as a mono kicker | kicker | colour is priority, decided in one place; a second colour axis breaks that | yes |
| 6 | `loadLedger()` deleted vs kept | kept for the JSON endpoint | it has an importer and a test; the pages stop using it | yes |
| 7 | filed = archived+dismissed+actioned+snoozed | as stated | "answered" and "filed" are both "the owner has dealt with it"; `actioned` rows are place questions already resolved | yes, one map |
| 8 | monolith deleted in this PR vs kept as fallback | deleted | two renderers of one ledger is how drift starts; the redirect keeps every old link working | via git |
