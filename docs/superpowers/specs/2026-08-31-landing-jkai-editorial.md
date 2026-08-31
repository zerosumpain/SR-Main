# The health editorial system, applied to the landing rail and the jkai shell

2026-08-31 · autonomous run · branch `feat/health-design-landing-jkai`

## Brief

> "using the design system from /health, introduce a similar approach for the
> landing page (the vitals bar brown/orange) and for /jkai. do this autonomously"

Full-autonomy grade: no questions, every fork logged below.

## What the system is

Established by PR #588/#591/#597 on the /health owner pages and extended to
`/jkai/daydreams` by PR #607, whose shell components are the working precedent
this build copies:

- A **dark cover band** — `--text-primary` (#1a1008) ground, cream type, the
  `> strangeramblings.com/path` mark with an `--accent-on-dark` (#e8863a) caret,
  a mono kicker, an Archivo Black headline.
- A **light rail** immediately under it, `--surface-rail`, 2px ink bottom rule,
  mono uppercase tabs, 3px accent seam on the current one.
- **Tiles that carry their own border** with a real gap — never `gap: 1px` over
  a background (auto-fit paints the unfilled tracks).
- **Radii 0, no shadows** (the one exception is the live dot's glow), the 12px
  mono floor, tone colours that come from meaning rather than from a stored word.
- On dark the olive and the orange both move: `--good-on-dark`,
  `--accent-on-dark`. Paper keeps `--good` / `--accent`.

## What changes

### A — the landing vitals rail

`VitalSigns` + `VitalTile` were a cream panel on `--surface-rail` sitting on a
cream page: a rail that had to be found rather than read. It becomes the cover
register — an ink slab with orange instrumentation, which is the "brown/orange"
the brief asks for, and the same band the /health and daydream covers open with.

- Ink ground, cream type, `--accent-on-dark` for every live signal.
- Hairlines between cells move to `rgba(237, 228, 212, 0.16)`; the tiles keep
  the `cellgrid` shape, only the colours invert.
- The foot's petrol buttons go: petrol is the paper counter-accent and has no
  role on an ink band. Primary is a filled `--accent-on-dark`, secondary a
  cream outline that fills on hover — the `ds-power` shape.
- The BPM numeral stays Archivo Black; the no-signal state stays mono.

### B — the jkai shell

`/jkai` is an application, not a document, so it gets the system's **chrome**,
not its section rhythm. The daydream hub already argued this line and its note
about "two black strips arguing" is the reason the header — not a second
masthead — is what turns dark here.

- `HubHeader` becomes the dark cover band: ink ground, cream mark, chips as
  cream outlines that go `--accent-on-dark` on hover, the mobile spend pill in
  the on-dark accent. The dropdown stays on paper — it is a floating layer.
- `HubTokenStrip` moves to its on-dark register (both variants; it has exactly
  one consumer).
- `ConversationTabs` becomes the light rail under the band: 2px ink rule, a 3px
  accent seam on the current tab. Thread titles keep sentence-case mono, which
  was a deliberate decision of the ledger redesign.
- `JkaiTabBar` (phone) matches the band rather than the page.
- The chat empty state becomes the one editorial moment on the surface: a mono
  kicker, an uppercase Archivo Black headline, square chips that invert on
  hover instead of pill outlines.
- `theme-color` follows the band to `#1a1008`.

Selawik stays. Only `--font-body` differs from /health, exactly as before.

## Decision Log

1. **Which "vitals bar"** — the landing `VitalSigns` rail, not `/admin`'s host
   status strip. The brief names the landing page in the same sentence.
   Reversible: the admin strip is untouched.
2. **Dark rail vs. tinting the existing cream panel.** Tinting would have given
   an orange-ish panel that still reads as page furniture. The system's own
   answer to "this is the instrument" is the ink band, and it is what makes the
   hero read as a magazine cover rather than two columns of cream. Reversible —
   the change is colour rules in two components.
3. **jkai gets chrome, not sections.** A cover band and lettered section heads
   on a live chat transcript would fight the thing the page is for. The header
   is the masthead; the tab strip is the rail. Reversible per component.
4. **`HubTokenStrip` / `VitalTile` restyled directly rather than given a `dark`
   prop.** Each has exactly one consumer, and `StatDeck`'s prop exists because
   it renders in both registers on one page. A comment records it.
5. **The phone tab bar's grid was `repeat(5, 1fr)` with six tabs**, so `more`
   wrapped to a second row. Fixed to six while the file was open — a defect on
   the surface being restyled.
6. **Empty-state hero left-aligned.** Centred display type is the one thing the
   reference set never does. It sits in the same 34rem column as before.
7. **`theme-color` moved to ink.** The installed PWA's status bar has to
   continue the page, and the page now starts dark.

## Verification

- `npm run gate` (font floor, boundaries, svelte-check, tests, build).
- Playwright shots of `/` and `/jkai` at 1440×1000 and 390×844 against a dev
  server cut from this worktree, plus an overflow check on `.jkai-body`
  (`fullPage` captures only the viewport on that layout).
- Merge → CI deploys → verify live on strangeramblings.com.
