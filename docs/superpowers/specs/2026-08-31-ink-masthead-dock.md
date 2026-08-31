# Docking the editorial system: the masthead is ink, sitewide

2026-08-31 · branch `feat/ink-masthead-dock` · follows PR #608

## Brief

> "they're looking ok, but think about how to dock the new theme in a more
> integrated way"

## The diagnosis

Everywhere the editorial system already existed — the /health cover, the
daydream cover, `HealthShell.hs-head` — the ink is a **full-bleed band the page
hangs from**. It is structural chrome.

What #608 shipped was ink as **panels sitting on cream pages**: a vertical
rectangle inset in the landing hero (cream nav above it, cream signature bar
below, cream copy beside) and a 46px hat above jkai with cream under it. Neither
attached to anything. Worse, the site began contradicting itself — the same
wordmark on a cream ground on the landing and an ink ground in jkai.

The root cause is one declaration. `:global(.site-nav-bar)` in the root layout
painted `--surface-rail`, and its own comment already stated the principle the
paint was breaking:

> "the strip reads as part of the page's structure rather than as chrome
> floating over it"

## What changes

**The site's masthead is ink.** One background declaration, plus relighting
everything rendered inside it — `SiteNav`, `PageHeader`, `AdminTopNav`, and the
four `meta` snippets that pass through it. All 58 surfaces that mount the strip.

That single change docks both surfaces without either needing a special case:

- **Landing.** The nav, the owner sync strip and the vitals rail are all ink and
  all touch, so they read as one L-shaped mass wrapping the cream hero instead
  of a rectangle floating inside it. The `.hero-divider` hairline loses its
  paint — the ink/cream value change IS the division now.
- **jkai.** The ink carries on down the collapsed thread rail, so the header
  stops being a hat and becomes a frame around the conversation column. On the
  sub-pages an ink `.site-nav-bar` sits under the ink `HubHeader`, so that
  header gains a cream hairline and the two read as a two-tier masthead — the
  shape `HealthShell` already had.

**The cut-out gets better, not worse.** `.nav-cell[aria-current]` was already
"page ground behind it, accent seam below". On cream that was a shift between
two warm tones. On ink it is a notch of the page punched through the band, so
the strip visibly holds the page. Seam widened 2px → 3px to match the editorial
rails.

**The owner sync strip is the masthead's second tier**, not a notice pasted on
the page: ink ground, cream text, an accent seam down its left edge.

## Decision Log

1. **Sitewide, not the two surfaces.** Put to John as a batched choice with this
   recommended; he took it. Doing only the landing and jkai is the selective
   reconciliation CLAUDE.md forbids, and would have left a cream lid over an ink
   rail on the very page the brief named. Reversible: one background
   declaration, and the relighting is inert once the ground goes back.
2. **Ink down the COLLAPSED jkai rail only.** That is the default state and the
   piece that closes the L. Expanding it opens the thread library, and a list
   you read belongs on paper — the same call the hub dropdown and `ActivityStrip`
   already make. Relighting the 300-line expanded list is a bigger job with more
   risk than value.
3. **No bottom rule under the strip.** The value change from `#1a1008` to cream
   is the edge; a hairline on top of it fuzzes the join. The one exception is
   `HubHeader`, which needs it precisely because what sits beneath it there is
   also ink.
4. **`isActive` resolves most-specific-first** rather than special-casing
   `/jkai` — see below.
5. **The ECG was left alone.** The ink rail still masks the trace behind it.
   Fixing that means a second animating instance on the front door, which is a
   perf cost for a flourish the brief did not ask for.

## The defect the ink exposed

`SiteNav.isActive()` was a plain prefix test, so on `/jkai/builds` **two** cells
matched — `Chat` (`/jkai`) and `Builds` (`/jkai/builds`) — and the strip claimed
you were in two places at once. Always true; invisible on cream, glaring once
the current cell started cutting a cream notch out of an ink band.

Fixed generally: a cell is current only if no longer item in the same list also
matches. That also retires the `DEFAULT_ITEMS` comment claiming a nav cell under
`/health` "could never deactivate".

## Verification

- `npm run gate` on porkserv (font floor, boundaries, svelte-check, tests,
  real adapter-node build); the four lint gates locally.
- Playwright over the surfaces the strip actually reaches — `/`, `/blog`,
  `/projects`, `/health`, `/jkai`, `/jkai/builds`, `/admin` — at 1440 and 390,
  with both overflow measures at 0.
- Merge → CI deploys → verify live.
