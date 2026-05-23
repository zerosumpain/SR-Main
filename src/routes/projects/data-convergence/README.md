# The Spine — Data Convergence Timeline

A standalone, isolated interactive visualisation built into `src/routes/projects/data-convergence/`.

Live: `https://strangeramblings.com/projects/data-convergence`

## Concept

Multiple data sources enter the timeline at their start dates as oscillating
strands of "twine". They wind together at confluences — strand into strand —
until everything binds into a single horizontal spine, the source of truth.
Thickness encodes user counts; oscillation frequency encodes how often that
source is collected; colour encodes the source itself, and merged strands
show their constituents as a visible braided pattern rather than blending
to a single tone.

## How to run it

This route lives inside the existing SvelteKit site. It has no server
dependencies and no global CSS impact. Just visit `/projects/data-convergence`
in any environment where this repo is running.

For development you can use the debug URL hash:

- `#t=0.55` — seek the playhead to 55% of the timeline.
- `#panel` — open the config drawer on load.
- These can be combined: `#t=0.85&panel`.

## Isolation contract

Per the brief, this route does not import from anywhere else in the project:

- No `$lib/*` imports.
- No changes to shared layouts or global CSS.
- All styles are component-scoped Svelte styles (no `:global` leaks).
- Fonts are loaded via a `<link>` inside `<svelte:head>` on this page only
  (Fraunces, DM Sans, JetBrains Mono).
- Persistence is via `localStorage` under a namespaced key
  (`data-convergence:config:v1`); no server or DB.

## Engineering decisions

### Canvas-2D over SVG

The visualisation has many simultaneously animating waveforms, and merged
strands need a *braided* effect — multiple constituent-colour filaments
interweaving along a shared centreline. Drawing those as SVG paths means a
DOM node per filament per strand per frame, which is hostile to mobile
animation. Canvas lets us redraw N filaments per parent strand cheaply at
60 fps. The trade-off is doing manual hit-testing for hover/tap, which is a
small price for the animation budget.

### Two-axis fit

Layout offsets (where each strand sits vertically before it merges) and
visual thickness (how thick a strand draws) are on different curves:

- **Layout** is sized in raw "subtree weight" units (sum of users in the
  subtree), and the renderer applies a one-pass `yScale` that shrinks the
  whole layout to fit the canvas height. That way the composition always
  fills the visible space gracefully whether you have 5 strands or 50.
- **Thickness** uses a gentle exponent (`users^0.45 * 0.55`) so a 900-user
  strand is only ~6× thicker than a 1-user strand, not 900×.

The constants live at the top of `lib/strands.ts` so they're easy to tune.

### DAG resolution

`resolveModel(config)` is the single entry point. It:

1. Detects duplicate ids, missing merge targets, self-merges, and cycles
   (DFS with three-colour marking).
2. Warns when a strand's merge date is after its target has itself merged on.
3. Builds a tree rooted at `'spine'`, sorts each parent's children by start
   date for stability, then re-sorts by subtree weight for layout so heavier
   confluences get more vertical room.
4. Lays out children alternating above/below the parent's centreline.
5. Computes each strand's birth offset by summing all ancestor offsets, so
   leaf strands' starting y is unique and consistent.
6. Returns a `ResolvedModel` with strands, layout map, time bounds, and a
   list of validation issues. Errored strands are excluded from rendering;
   the table surfaces their issues inline.

### Strand geometry

For any strand at world-time `t`:

- `strandCentreY(strand, t)` returns the y offset from the spine, including
  smoothstep-eased convergence onto the parent's centreline over the last
  `CONVERGE_WINDOW` (32%) of the strand's lifespan.
- `strandAmplitude(strand, t)` tapers the oscillation amplitude to zero over
  that same window so the strand neatly *settles* into its parent rather
  than disappearing mid-wobble.
- The path is sampled in CSS pixels with a step of 3 px; each sample's
  world-time is derived from its x-position, so the shape is purely a
  function of the model + playhead.

### Braided merged strands

When a strand has children that have merged into it, it's drawn as a
*braid* of those constituent threads (`drawConstituentBraid`). Each thread
is rendered as its own coloured stroke along the parent's centreline, with:

- A static vertical offset within the band (sized by its own thickness).
- A phase-shifted sinusoidal wobble (`twistAmp = min(totalThickness * 0.42, 8)`)
  that makes the threads weave in and out of each other. The phases are
  offset by `(i / N) * 2π + i * 0.7` so adjacent threads cross visibly.

The spine uses the same braid mechanism with a perfectly straight
centreline.

### Hit testing

`hitTest(mx, my, model, state)` is a math-only point-in-band check rather
than an offscreen-canvas approach. It iterates strands by descending
ancestry depth (children win over parents), maps the mouse x to a world
time, computes the strand's y at that time, and checks `|my - cy| ≤
thickness/2 + 8px`. Spine is the fallback. Fast enough for hundreds of
strands per pointer event.

### Playback loop

A `requestAnimationFrame` loop advances the playhead by
`span / 28s * speed * dt`. At speed=1 that's ~28 seconds to traverse the
whole timeline; speeds 0.25× → 8× are exposed. Hitting play when the
playhead is already at the end rewinds to the start first, so you can
re-watch without having to scrub manually.

### Initial playhead

We seed the playhead at the *end* of the timeline so the first paint shows
the fully wound rope — the conceptual punchline. Then the user can press
play to rewind and re-experience the convergence. The clamp `$effect`
keeps the playhead in range when the config changes underneath.

### Persistence

`saveConfig` / `loadConfig` round-trip through `localStorage` under a
versioned key. `validateConfig` is permissive — it accepts anything that
smells like a strand array, coerces types, and silently drops bad rows.
Import takes a file or pasted JSON; export downloads a pretty-printed file
and "Copy" puts the same blob on the clipboard.

## Responsive behaviour

- **Desktop / wide**: full layout — header, visualisation, controls bar,
  legend, footer.
- **Landscape phone (`max-height: 520px`)**: header collapses to a single
  thin bar (title + Edit Sources button), blurb and footer hide, legend
  becomes a horizontally-scrollable row, the canvas takes everything else.
- **Portrait phone (`max-width: 720px`)**: shows the rotate-for-best-view
  hint over the visualisation; the layout still works, just compressed.
- **Config panel**: always a right-side drawer; on narrow widths it covers
  most of the viewport, and each table row becomes a stacked card so the
  inputs stay tappable.

## Project layout

```
data-convergence/
├── +page.svelte              # composition root — owns state + playback loop
├── README.md                 # this file
├── components/
│   ├── ConfigTable.svelte    # editable table with DAG-aware merge dropdowns
│   ├── Controls.svelte       # play/pause/speed/scrubber bottom bar
│   ├── Legend.svelte         # colour↔source mapping
│   ├── Tooltip.svelte        # hover/tap inspector
│   └── Visualization.svelte  # canvas mount, ResizeObserver, hit-testing
└── lib/
    ├── defaults.ts           # default scene used on first load
    ├── render.ts             # canvas-2D rendering
    ├── storage.ts            # localStorage + JSON I/O
    ├── strands.ts            # DAG resolution + strand math
    └── types.ts              # shared types
```

## WhatsApp notification

Delivered on completion via the running site's existing
`/api/channels/[id]/test` endpoint, which authenticates via DB-side channel
ownership and routes through `getWhatsAppService().sendMessage()`. The
script created an ephemeral `whatsapp` channel, sent the message, and
deleted the channel afterwards. WhatsApp `messageId: 3EB01A805DF1AD4E488727`.

For future autonomous projects, consider adding a dedicated
`/api/projects/whatsapp-notify` endpoint so this doesn't have to round-trip
through the channels CRUD.
