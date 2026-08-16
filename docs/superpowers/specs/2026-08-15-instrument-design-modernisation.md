# Instrument — design modernisation of the core surfaces

**Date:** 2026-08-15
**Branch:** `feature/instrument-design`
**Source:** `Modernizing Strangeramblings design.zip` (uploaded to /drive, 2026-08-15 08:06 UTC)
**Grade:** Full autonomy (no human gates; every fork logged below)

## What this is

A high-fidelity design handoff — `Modernised.dc.html` (design reference in HTML),
`tokens.additions.css` (the token layer), and a README with per-file instructions.
The palette, voice, grain and square-cornered brutalism are unchanged. What changes is
**structure and depth**:

- a tonal **surface ladder** instead of one translucent card wash
- a **hairline border scale** used as a cell grid
- **mono-led metric hierarchy** with tabular figures
- **elevation reserved for app frames and floating layers only**

The handoff is explicit that the HTML is a *reference*, not code to copy: recreate the
designs inside the existing Svelte components and `src/app.css` token system, following
established patterns (scoped `<style>` per component, CSS custom properties, no utility soup).

## Order of work (from the handoff, followed as given)

### Phase 1 — tokens (no visual risk)
Append `tokens.additions.css` to `src/app.css`. Keep every existing token; `--divider`
and `--card-border` stay for back-compat. Add `.cellgrid`, `.frame`, `.card-raised`
utilities. Nothing changes visually until phase 2.

### Phase 2 — the shell
`src/routes/jkai/+layout.svelte`, `HubHeader.svelte`, `HubTokenStrip.svelte`,
`ConversationSidebar.svelte`. Header height 46px stays; background `--bg-section` →
`--surface-rail`; `.menu` border 2px → 1px `--line-strong` + `--elev-pop`; every `<b>`
tabular; rail `--surface-rail` with `--line-hair` edge; active row accent tint.

### Phase 3 — surfaces, one per commit
| Surface | Files |
| --- | --- |
| Chat | `jkai/+page.svelte`, `ChatArea.svelte`, `ChatMessage.svelte` |
| Graph rail | `KnowledgeGraphRail.svelte` |
| Canvas | `jkai/canvas/+page.svelte` |
| Intel | `jkai/intel/+page.svelte`, `+layout.svelte` |
| Drive | `drive/+page.svelte` |
| Decks | `decks/+page.svelte` |
| Homepage | `+page.svelte`, `SiteNav`, `PageHeader`, `LandingHero`, `VitalSigns`, `ShippedSeam`, `FeatureIndex` |

## Rules the mocks follow (carried into the code)

- Elevation only on app frames and floating layers. Never on cards, rows, chips, buttons.
- Radius stays `0` / `2px` / `100px`. No 8/12/16.
- Every number that ticks is tabular. Metric labels 10–11px mono, uppercase,
  `letter-spacing: .14em`, `--text-ghost` or `--text-muted`.
- `/` separates metadata chunks; each droppable chunk owns the `/` before it.
- Petrol (`--accent-ink`) is the second data series and "system is fine". Burnt orange is
  live, current, and primary action. Never both for the same meaning.
- No emoji. Unicode glyphs only: `← → ◉ ○ ◆ ▸ ▾ ⇄ /`.
- Motion: 0.2s ease-out; the 1.5s live-dot pulse; nothing else.

## Responsive intent

Right rails collapse first, then the left rail becomes a slide-over, then cell grids drop
to two columns. **Cell grids must never scroll horizontally on a phone.** All existing
behaviour is preserved: ⌘K launcher, hub/page-menu takeover with `←` back chip, rail
collapse persistence, 2h conversation resume, 10s live-run poll, presence heartbeat,
graph rail collapse at <1280px and bottom sheet at <800px, phone tab bar at <800px.

## Decision Log

Every fork that would have been a question.

### D1 — Token font sizes vs the 12px accessibility floor
`tokens.additions.css` specifies metric labels at "10–11px mono" and the mocks use 10px
throughout. `src/app.css` documents `--fs-label-xs: 0.75rem` (12px) as a **HARD FLOOR**,
enforced by `scripts/check-font-sizes.mjs`, which fails the CI gate if anything smaller
appears.
- **Options:** (a) follow the mock at 10px and weaken the gate; (b) keep the 12px floor
  and render the mock's 10px labels at 12px; (c) exempt the new surfaces.
- **Chosen: (b).** The floor is an accessibility commitment already shipped and gated;
  the handoff is a visual pass and says nothing about relaxing accessibility. Labels keep
  their mono/uppercase/tracking treatment, just at the floor size.
- **Reversible:** yes — one token change if John wants the tighter mock size.

### D2 — Vitals rail content on the homepage
The mock's hero rail shows BPM / Steps / Weather / Activity / Ascent / Deploys-today.
The live `VitalSigns.svelte` shows JKAI / Builder / Health / Live Walk / Canvas, fed by
`/api/landing/vitals`.
- **Options:** (a) rebuild the rail around the mock's biome metrics; (b) keep the existing
  five real signals and restate them in the mock's rail *structure*; (c) both, longer rail.
- **Chosen: (b).** The handoff says "numbers in the mocks are plausible placeholders —
  bind them to the real loaders", and the hero already carries bpm/steps/temp in its
  strap line. Rebuilding around biome data would delete a shipped aggregator and
  duplicate the hero copy. The rail structure (surface-rail panel, hero numeral, hairline
  cell grid, footer actions) is applied faithfully; the *series* stay the real ones.
- **Reversible:** yes — the tile list is one `$derived` array.

### D3 — Nav as a full-bleed cell strip
The mock replaces the padded sticky nav with a 48px full-bleed strip: brand cell, per-item
cells with right borders, `inset 0 -2px 0 var(--accent)` on current, right-hand live cell.
`SiteNav` currently renders `.nav-link` pills with numbered prefixes and a filled active
block, and is shared by `PageHeader` across every site page.
- **Options:** (a) new strip variant used only on the homepage; (b) change `SiteNav`
  wholesale so every page gets it.
- **Chosen: (b).** CLAUDE.md is explicit: "mirror the FULL design system sitewide — do not
  do selective reconciliation". A homepage-only nav would be exactly that.
- **Reversible:** yes — `variant` prop still exists.

### D4 — How faithful to be where the mock has no counterpart
Several real features have no mock (drive grid view, WebDAV panel, intel's nine sub-pages,
canvas node editor). The brief says: "Where the system covers capability, use the
principles in this system and apply those."
- **Chosen:** apply the principles (surface ladder, cell grid, hairline borders, tabular
  mono metrics, elevation discipline) to those surfaces rather than leaving them on the
  old wash. No feature is removed to match a mock that simply didn't cover it.

### D5 — Isolated worktree rather than the shared checkout
`~/strange_rambling_svelte` was on another session's branch (`intel-source-filters`) with
uncommitted work.
- **Chosen:** `.worktrees/instrument-design` off `origin/master`, per
  `reference_shared_worktree_hazard`. Nothing this task does can land in the other
  session's commit.

## Verification

- `npm run gate` in the worktree (check + lint + tests + font-size gate).
- Production build served locally, screenshotted at 1440px, 1024px, 768px and 390px for
  every touched surface; zero page-level horizontal overflow at 390px.
- After merge: CI deploys; verify live on strangeramblings.com.
