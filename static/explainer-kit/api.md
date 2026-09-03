# Explainer kit — API reference

Every signature in the kit. Read this before writing a visual; the kit had no
signatures at all until now, and a guess at `createScene` from prose alone
produced meshes at NaN coordinates — a blank canvas, no console error, and a
check that counted canvases said it was fine.

All factories hang off the global `Explainer` and take a single spec object
whose `mount` is an element or a CSS selector. Simple factories return their
element; operated simulators return a small controller.

Load order matters: `tokens.css`, then `shell.css`, then the scripts.

```html
<link rel="stylesheet" href="explainer-kit/tokens.css">
<link rel="stylesheet" href="explainer-kit/shell.css">
<script src="explainer-kit/shell.js"></script>
<script src="explainer-kit/instruments.js"></script>
<script src="explainer-kit/sim.js"></script>
<script src="explainer-kit/scenario.js"></script> <!-- when routed here -->
<script src="explainer-kit/cohort.js"></script>   <!-- when routed here -->
```

Paths are **project-root-relative, no leading slash, no `../`**. Both surfaces
a reader reaches inject a `<base href>` at the project root, so that is the
only form which resolves on both. A leading slash escapes to the site root.

---

## Chrome — `shell.js`

### `Explainer.mountShell(spec) → HTMLElement`

Writes the header, the chapter nav, the chapter heading and the prev/next
footer. Call once per chapter page. Returns the `<main class="ex-chapter">`
your content lives in — if the page already had body content, it is moved
inside automatically.

| field | type | required | meaning |
|---|---|---|---|
| `project` | string | yes | Title shown in the header, links to `./` |
| `chapters` | `{n, title}[]` | yes | Every chapter, in order. Drives the nav. |
| `current` | number | yes | This chapter's `n`. Use `0` for the contents page. |
| `form` | string | yes | How this chapter is told — see below. Comes from the spine's Form column. |
| `kicker` | string | no | Short label above the title |
| `lede` | string | no | One sentence framing the chapter |

**The forms.** Each changes the arrangement, and some create a container for
you to mount into:

| form | what it does | mount point it creates |
|---|---|---|
| `open` | visual runs full width above the words | `#ex-stage` |
| `question` | the title is asked; evidence; a bounded answer | — |
| `walk` | numbered movements, one beat per `<h2>` | — |
| `compare` | two columns, this against that | `#ex-left`, `#ex-right` |
| `annotate` | one artefact held wide, notes beside it | `#ex-aside` |
| `ledger` | a list of items, each with its own small visual | `#ex-ledger` |
| `close` | tighter measure; an accounting, not an essay | — |

The containers are created by the shell rather than described here, because an
arrangement that depends on you writing the right wrapper is an arrangement
that will not happen.

### `Explainer.addLedgerEntry({title, note}) → HTMLElement`

Adds a row to a `ledger` chapter and returns the slot for its visual.

### `Explainer.mountContents(spec) → HTMLElement`

Same spec minus `current`; renders the chapter list. Use in `index.html`.
`chapters[].blurb` adds a line under each entry.

---

## The frame — `instruments.js`

### `Explainer.createInstrument(spec) → {root, body, controls}`

The frame every visual sits in. Mount your visual into `.body` and any control
into `.controls`.

| field | type | meaning |
|---|---|---|
| `mount` | Element\|string | where it goes |
| `title` | string | what this shows |
| `kicker` | string | short label above the title |
| `reading` | string | one line naming what is plotted — an axis label in prose, not an argument |
| `takeaway` | string (HTML) | the payoff, under 40 words. `<b>` the number that matters. |

```js
const inst = Explainer.createInstrument({
  mount: '#funding',
  kicker: 'per pupil',
  title: 'Where the money lands',
  reading: 'Each bar is one funding stream, in pounds per pupil.',
  takeaway: 'Two streams carry <b>four fifths</b> of the total.',
});
Explainer.createBars({ mount: inst.body, items: [{ label: 'AWPU', value: 4200 }] });
```

---

## Quantity

### `Explainer.createStat({mount, items})`
`items: {value, label, note?, outcomeId?}[]` — big numbers in a responsive row.
Give `outcomeId` to make one the chapter's `data-outcome`.

### `Explainer.createBars({mount, items, format?, labelWidth?, tone?})`
`items: {label, value, colour?}[]`. Horizontal bars. `format(v) → string`.

### `Explainer.createStackBar({mount, parts, title?})`
`parts: {label, value, colour?}[]`. One bar, the composition of a whole, with a
legend beneath. Percentages are computed for you.

### `Explainer.createIconArray({mount, total, filled, perRow?, tone?})`
N dots, `filled` of them highlighted. The clearest way to show a proportion or
a risk: "7 in 100" lands where "7%" does not.

### `Explainer.createGauge({mount, value, max, unit?, format?, outcomeId?, tone?})`
One arc and one number, against a target.

### `Explainer.createLineBand({mount, points, format?, tone?})`
`points: {x, y, lo?, hi?}[]`. A series; supply `lo`/`hi` on every point to get
an uncertainty band. The endpoint is emphasised.

### `Explainer.createComparison({mount, rows, beforeLabel?, afterLabel?, tone?})`
`rows: {label, before, after}[]`. Paired bars with the percentage change
called out, coloured good/bad.

---

## Process

### `Explainer.createSteps({mount, steps, title?})`
`steps: {label, note?, tone?}[]`. Numbered boxes left to right with arrows.
**The default answer to "how does this work?"** — reach for this before a 3D
scene.

### `Explainer.createCycle({mount, steps, title?})`
Same, but round, for a process with no end. Needs at least two steps.

### `Explainer.createFunnel({mount, stages, format?})`
`stages: {label, value}[]`. A narrowing flow with the drop between each stage
shown as a percentage.

### `Explainer.createTimeline({mount, events, format?})`
`events: {at, label, tone?}[]` where `at` is a number. Labels alternate above
and below so clusters stay readable.

---

## Structure

### `Explainer.createMatrix({mount, points, xLabel?, yLabel?})`
`points: {x, y, label, tone?}[]` with `x`/`y` in **0..1**. A 2×2 positioning grid.

### `Explainer.createTree({mount, root})`
`root: {label, tone?, children?: []}` recursively. Top-down hierarchy.

### `Explainer.createVenn({mount, sets, overlapLabel?})`
`sets: {label, tone?}[]`, two or three. Overlapping circles.

### `Explainer.createDiagram(spec)`
Boxes and labelled edges — a mechanism. See `README.md`.

### `Explainer.createChart(spec)`
Axes and series. Prefer `createBars` or `createLineBand` unless you need axes.

### `Explainer.createScene(spec)`
The low-poly tile grid — see `scenes.md`. **The exception, not the default.**
Right for a quantity that varies across a SET (one tile per source, claim, year
or category; height for magnitude, colour for a second variable). Wrong for
nine boxes: both target pages contain zero canvas and zero WebGL.

---

## Interaction

### `Explainer.createSim(spec)`
Builds the controls and the readout together and tags both, so a lever and its
outcome always match the ids the checker looks for. Use it rather than wiring
an `<input>` by hand.

| field | type | meaning |
|---|---|---|
| `mount` | Element\|string | createSim builds its **own** controls inside this — do not pass an instrument's `.controls` slot |
| `levers` | `{id, label, min, max, value, step?, unit?}[]` | range inputs carrying `data-lever="<id>"` |
| `outcomes` | `{id, label, unit?, format?}[]` | readouts carrying `data-outcome="<id>"` |
| `step` | `(values) => outcomes` | **`step`, not `compute`.** Takes lever values keyed by id, returns an object keyed by outcome id. May be async. |

**Control kinds.** `kind` decides the shape of the control:

| kind | when | shape |
|---|---|---|
| `choice` | **the default** — the parameter is a SET: which source, which year, which claim | segmented buttons |
| `toggle` | a single assumption held or dropped | one button |
| `step` | walking an ordered sequence | previous / next |
| `slider` | **only** a continuous quantity: money, people, a rate | range input |

A slider for "which of six topics" is a category dressed up as a number, and it
reads as one. The house style this kit copies uses buttons over sliders 43 to 10.

```js
// choice — options as strings, numbers, or {value,label}
Explainer.createSim({
  mount: inst.body,
  levers: [{ id: 'source', label: 'Which source', kind: 'choice',
             options: ['Inquiry report', 'Scheme summary', 'Regulations'], value: 'Inquiry report' }],
  outcomes: [{ id: 'scope', label: 'What it establishes' }],
  step: ({ source }) => ({ scope: LOOKUP[source] }),
});

// slider — a real quantity
Explainer.createSim({
  mount: inst.body,
  levers: [{ id: 'roll', label: 'Pupils on roll', kind: 'slider', min: 100, max: 1200, value: 400, step: 10 }],
  outcomes: [{ id: 'total', label: 'Total funding' }],
  step: ({ roll }) => ({ total: roll * 4200 }),
});
```

Every chapter needs **one control that visibly moves one outcome and the visual**. The control
carries `data-lever="<leverId>"`, the readout carries `data-outcome="<outcomeId>"`,
and both ids come from the chapter spine — the checker reads the same file.

### `Explainer.createNetworkSimulator(spec)`

Use when the lesson is which route through a declared system is active. Pass
`nodes: {id,label,x,y}[]`, `edges: {id,from,to,label?}[]`, one choice `lever`,
`outcomes`, and `scenarios` keyed by lever value. Each scenario contains
`edges: {edgeId: 0..1}` and `outcomes`. The runtime advances
`data-visual-version` whenever the route changes. See
`examples/network-simulator.html`.

### `Explainer.createCohortSimulator(spec)`

Builds an evidence-aware policy instrument: controls and outcomes, a 100-cell
population view, baseline/current comparison, uncertainty view and model card.

| field | type | meaning |
|---|---|---|
| `population` | `{total, cohorts: {id,label,count,tone?}[]}` | sourced baseline; mutually exclusive cohort counts must sum to total |
| `levers` | createSim lever[] | policy choices and genuine numeric assumptions |
| `outcomes` | createSim outcome[] | numeric readouts; `kind: 'percent'` enforces 0..100 |
| `baselineValues` | object | lever values that must reproduce the baseline exactly |
| `policies` | object | safe finite lookup keyed by the first lever; every declared state is validated |
| `model` | `(values, baseline) => result` | synchronous pure function for a genuinely continuous/interacting mechanism |
| `forecast` | boolean | requires uncertainty/trajectory or a specific exemption |
| `modelCard` | object | `observed`, `assumptions`, `derived`, `scenarios`, `limitations`, optional `uncertaintyExemption` |

The result is `{cohorts, outcomes, uncertainty?, trajectory?}`. A range is
`{low, central, high, label?}`; trajectory points add `x`. The runtime rejects
non-finite/negative counts, non-finite outcomes, unknown cohorts, population
leakage, a false baseline, nondeterminism, invalid percentages, and ranges that
do not satisfy `low ≤ central ≤ high`. See
`examples/cohort-simulator.html` for a complete sourced chapter.

---

## Illustrations

For a physical or spatial subject the SVG artefacts cannot draw:

```bash
node <repo>/scripts/studio-image.mjs \
  --prompt "a side view of a school building showing where each funding stream arrives" \
  --out assets/where-money-arrives.png
```

It writes the file into your tree and prints the `<figure>` markup to paste in.

**Never use a generated image to carry a number.** A model will draw a
convincing axis with invented values on it. Quantities belong in the
instruments above, which are exact and which the reader can operate.
