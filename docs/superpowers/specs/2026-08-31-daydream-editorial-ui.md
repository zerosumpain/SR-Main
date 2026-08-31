# /jkai/daydreams — the health editorial system, applied

Autonomous run, 2026-08-31. Brief: *"look at the design system used for /health
and apply it to /jkai/daydream. Tables, editorial, browns and oranges in the
same design flow as health. Significant overhaul of the UI only — autonomously.
Use grouping, filtering, ordering, rely more heavily on cards, color by
priority and clear call to actions."*

**UI only.** No loader change, no API change, no schema change. Every fetch,
every action payload and every derived figure keeps its current meaning; what
changes is what the page looks like and how a reader navigates it.

## What it looked like before

One 3,215-line `+page.svelte`: a `.page-hdr` admin header, a pill tab row, and
eight tabs of `.nm-sec` blocks — the generic admin section shape from
`/admin/files`. Flat rows, one accent, no hierarchy between "a job failed" and
"a detector is gathering history". Grouping existed on the Feed alone; ordering
existed nowhere; filtering was four status chips.

## The system being applied

`/health` (PR #588/#591/#597) — the shipped editorial owner pages:

- a **dark `#1a1008` masthead band** carrying a mono kicker, an Archivo Black
  headline and a tile deck (`SegmentTotals`);
- **lettered section heads** — `A / STATE OF PLAY` mono kicker, two-line
  display headline, one right-aligned standfirst (`SectionHead`);
- **alternating bands** — paper `--bg`, sunken `--bg-section`, dark
  `--text-primary` — rather than boxes on one background;
- **facet chips with counts** and **every table heading a sort**
  (`SegmentLedger`);
- radii 0 (pills 100 only), no shadows, no springs, 12px mono floor.

## Decision Log

1. **Keep jkai's body font.** The health pages read in DM Sans; `/jkai/*` is
   deliberately Selawik/Segoe (`sr-design`, John 2026-08-29). `--font-display`
   (Archivo Black) and `--font-mono` are unchanged inside jkai, so the
   editorial voice carries; only the reading face differs.
   *Reversible: one line.*
2. **A page masthead, not a second site header.** `HealthShell` is a sticky
   dark site header; `/jkai` already has `HubHeader` above the scroll
   container. `DaydreamShell` therefore renders a masthead band inside the page
   and a sticky tab rail beneath it. *Reversible.*
3. **Local `hub/` components, not imports from `components/health/hub`.** The
   boundary gate would allow the import (same `ui` layer), but a jkai page
   importing health chrome couples two design surfaces that must be free to
   diverge. Four small presentational components, copied in shape.
   *Reversible: delete and import.*
4. **One tone vocabulary, in a pure module.** `$lib/daydream/priority.ts` maps
   every status the page renders onto six tones — `urgent action watch good
   steady quiet` — with an explicit rank for ordering. Colour-by-priority then
   means one function, not thirty class names. Tested. *Reversible.*
5. **Rewrite in place; do not split the page into eight tab components.** The
   tabs share ~40 pieces of state and six action helpers; threading those
   through eight components is a refactor, and the brief is UI. The page keeps
   its script, gains its new chrome. *Reversible.*
6. **Two things that are not strictly "UI only", both kept.**
   - `LedgerPlace` gains `suggestedLabel` / `suggestedAddress`. Both are already
     on the row, already selected for the thoughts join and already sent for
     the naming *queue*; the list had never carried them, so every unnamed card
     in the new design read "somewhere you stop" and the question was a memory
     test rather than a confirmation. Two fields on an owner-gated payload that
     already carries the coordinates.
   - The action queue's buttons OPEN the panel they name and scroll to it,
     rather than only switching tab. A button that says "sort through them" and
     leaves you at the top of a 3,000px page with a closed panel below is the
     shape the old page had, and it is why nothing on it ever got sorted.
   *Both reversible.*
7. **New controls are additive.** Ordering added to the Feed, the discoveries
   board and the detectors; filtering added to the board (verdict) and the
   detectors (state); grouping unchanged on the Feed (type/likelihood/day) and
   added to Places (kind). No existing control is removed, and no URL contract
   changes except the additive `?tab=` that already existed.

## Verification

- `node scripts/check-font-sizes.mjs` — 12px floor over `src/routes/jkai`.
- `node scripts/check-module-boundaries.mjs`
- `npx svelte-check --threshold error` on the two touched trees.
- `npx vitest run src/lib/daydream/priority.test.ts`
- `npm run gate:build`
- Live: the page rendered on homeserv, then on the VPS after CI deploys.

Verified 2026-08-31 on homeserv against the built server, every tab screenshot
at 1440px and at 390px: zero horizontal overflow on the document AND on
`.jkai-body` (jkai's real scroll container — `fullPage: true` captures only the
viewport here, because `.jkai-root` is `height: 100dvh; overflow: hidden`), no
page or console errors, and the action queue's buttons confirmed to open the
triage deck and the naming session rather than only switching tab.

**The dev DB had no daydream rows**, so the data-carrying views were checked
against a temporary `uiseed-*` fixture set, since deleted. Two things that
found: the dev DB was missing the five `review_*` columns from PRs #604/#605
(added), and `tests/lib/workflows/nodes/briefing-compose.test.ts` reads the
LIVE database — it failed on "an empty briefing has 6 gaps" purely because the
fixtures made the daydream section non-empty, and passed again once they were
removed. Anything seeding that database has to clean up after itself.
