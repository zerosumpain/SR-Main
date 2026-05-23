# The Spine — Data Convergence Timeline (V2)

A standalone, isolated interactive visualisation built into `src/routes/projects/data-convergence/`.

Live: `https://strangeramblings.com/projects/data-convergence`

## What V2 added

Compared to V1:

- **Rainbow spine** — the core spine is now a single, always-moving rainbow
  bar of horizontal coloured stripes (one per merged source), all sharing a
  single sine displacement that animates continuously regardless of the play
  state. The bar thickens over time as more sources merge in. The internal
  wave-thread braid is gone.
- **Zoom presets** — four locked zoom levels, each with a calibrated
  oscillation rhythm for the spine:
  * **6 months** — each oscillation ≈ 1 day
  * **1 year (default)** — each oscillation ≈ 1 week
  * **10 years** — each oscillation ≈ 1 month
  * **Lifetime** — each oscillation ≈ 1 year
  The visible time window is centred on the playhead and clamped to model
  bounds. Strand oscillations use their own data cadence but are capped to a
  minimum readable wavelength so daily-cadence sources don't smear into a flat
  line at the tighter zooms.
- **Outputs** — a new "business activity" entity (analyses, funding rounds,
  dashboards). Rendered as labelled circles above/below the spine with bezier
  connectors to each contributing source. When a source has merged into the
  spine, the connector hooks on the spine at the output's x; when the source
  is still independent, it hooks on the strand's leading edge.
- **Reference-data feeds** — a distinct strand kind that doesn't have a
  single merge point. Rendered as a labelled chip band with regular tick
  marks falling onto the spine at intervals matched to the active zoom. They
  contribute to spine thickness gradually rather than as a step.
- **Always-prominent colour identity** — every strand keeps its colour as a
  full ribbon throughout its lifetime, with white inner highlight + ink
  outline. Within the spine, each source contributes its own coloured stripe
  in a stable rainbow order so the constituent colours stay readable even
  after merging.
- **Desktop layout fix** — the play/scrubber/zoom row is now its own
  flex-column slot, so the legend no longer overlaps it on desktop. The
  mobile compact layouts still collapse correctly.
- **DfE-themed scene** — defaults model the UK Department for Education's
  data landscape across a learner's life: attendance (daily), School Census
  (termly), Phonics / KS2 / KS4 (annual), A-Level + College ILR (FE), HESA
  (HE), Apprenticeships + Adult Skills (ongoing), and a bi-directional LA
  Children's Social Care feed. Reference data: GIAS and qualifications net.
  Outputs: school performance tables, Pupil Premium funding, EBacc analysis,
  Skills funding, Safeguarding casework, Statistical First Release, regional
  outcomes dashboard.

## Quick controls

- **Zoom**: 4 buttons in the bottom bar.
- **Play / pause / scrubber / speed**: bottom bar.
- **Hover a source / output / spine**: tooltip with metadata; the
  related connectors highlight.
- **Edit sources →**: opens the right-side drawer with the full config
  table (per-row outputs assigned via chips), plus the Outputs editor.

For development:

- `#t=0.5` — seek the playhead to 50% of the model's full span.
- `#zoom=6m|1y|10y|adult` — start at that zoom.
- `#panel` — open the config drawer on load.

## Isolation contract

This route imports nothing from `$lib`. All styles are component-scoped. Fonts
are loaded via a `<link>` inside `<svelte:head>` on this page only (Fraunces,
DM Sans, JetBrains Mono). Persistence is via `localStorage` under
`data-convergence:config:v2`.

## Engineering decisions

### Canvas-2D

Same reasoning as V1 — many simultaneous animating waveforms + a perpetually
animating rainbow bar would punish the DOM in SVG. Canvas lets us redraw the
spine stripes per frame cheaply at 60 fps. Hit-testing is math-only.

### Spine thickness scaling

The spine's natural total thickness = sum of `usersToThickness(s.users)` for
every strand whose ancestry includes the spine. We compute a single `stripeScale`
= `min(1, MAX_SPINE_PX / naturalMax)` once, where `MAX_SPINE_PX` is
`min(64, height * 0.16)`. Every stripe is then drawn at its natural thickness
× scale × current ramp. This gives a bar that grows over time but never eats
the canvas, regardless of the user-volume mix.

### Stripe stability

Stripe order is computed once per model and held stable across frames so the
rainbow doesn't shuffle when the playhead moves. Reference feeds order by
`startMs`; conventional sources by `mergeMs`.

### Spine animation rhythm

Each zoom level specifies a target `oscCount` across the visible span. The
spine's wavelength in CSS px = canvas usable width / `oscCount`. The animation
phase advances continuously (`animTime` ticked by a separate rAF loop in the
canvas component), so the bar is "alive" even when playback is paused.

### Outputs layout

Outputs spread along the canvas x by side-balanced index (a stable spread that
keeps labels apart) blended 70/30 with their `anchorDate` x. y-positions get a
small alternating stagger so adjacent labels don't collide. When an output's
anchor falls outside the current view window, the output is pinned to the
nearest edge — it never disappears just because the user zoomed past it.

### Strand-to-output connectors

A connector starts on the spine at the output's x when the source has merged
in (clean visual: just a near-vertical line down/up from the rainbow), or on
the strand's current leading edge when the source is still independent (the
bezier sweeps from the strand's oscillating tip toward the output). Reference
feeds always hook on the spine since they flow continuously.

### Reference-data feeds

Stacked above/below the spine in alternating rows. Each gets a labelled chip
band with hairlines top/bottom, then dotted tick marks at zoom-matched
intervals (1 week at 6m → 1 year at Lifetime). The feed's contribution to
spine thickness ramps in linearly from `startMs` to `mergeMs` so it builds
the rope gradually rather than as a step.

## Project layout

```
data-convergence/
├── +page.svelte              # composition root — owns state + playback loop
├── README.md                 # this file
├── components/
│   ├── ConfigTable.svelte    # editable strands + outputs tables, output chips
│   ├── Controls.svelte       # zoom buttons + play/pause/scrubber/speed
│   ├── Legend.svelte         # three columns: sources, reference data, outputs
│   ├── Tooltip.svelte        # hover/tap inspector for strands AND outputs
│   └── Visualization.svelte  # canvas mount, continuous animation, hit-testing
└── lib/
    ├── defaults.ts           # DfE-themed default scene
    ├── render.ts             # canvas-2D rendering (spine, strands, refs, outputs)
    ├── storage.ts            # localStorage + JSON bundle I/O
    ├── strands.ts            # DAG resolution + strand/spine math, cadence helpers
    └── types.ts              # shared types + ZOOM_SPECS
```
