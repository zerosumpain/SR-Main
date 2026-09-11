# /policy-analysis — a dashboard, not a report

Autonomous run, 2026-09-10. Branch `feat/policy-dashboard`.

John's brief, verbatim in ten numbered asks: the engine is good, the interface
needs a bottom-up rebuild in the design grammar of `/health` and `/research`;
headline → summary → drill; heavy use of hover cards and context-aware modals;
tone for a reader who did not write the paper; explainers on the game-theory
column types; a much cleaner actor view with a visual that redraws on the
measure the reader picks; better entity/relationship insight; a stress test that
is legible; a scenario process flow; and **no clickthrough that scrolls to
another part of the same page**. Export to Word and print to PDF are the two
things that must survive.

## The one-line diagnosis

The page is not badly built — it is **flat**. Twelve tab panels, each of which
renders everything it holds at full length, so the reader's only choice is
"which wall of text". A dashboard is the same content under a **depth
gradient**: a figure, then a hover that explains the figure, then a drill that
opens it, then the artefact's own provenance. The engine already emits every
join that gradient needs; nothing here asks a model for anything new.

## What ships

### The depth gradient — three layers, mounted once each

| Layer | Reached by | Answers |
|---|---|---|
| **Figure** | reading the page | how much / how many |
| **Peek** (`PeekCard`) | hover or focus on `data-pa-peek` | what IS this, and is it worth opening |
| **Drill** (`Drill`) | click, or "open" in the peek | everything, with provenance and refs |

`peek.svelte.ts` is a near-copy of `$lib/health/metric-peek.svelte.ts`: ONE card
for the whole page, delegated by an attribute, timers as plain `let`. Thirty
figures would otherwise be thirty idle popovers, and a timer in `$state` is the
`effect_update_depth_exceeded` cycle this repo has paid for twice.

The peek is **context-aware by subject kind**, which is ask 2: an actor peek
carries its incentives and its worst play; a play peek carries the four factors;
an assumption peek carries what rests on it and a switch into the stress test; a
term peek carries the glossary. One component, one controller, five renderings.

### The drill REPLACES the sticky inspector (ask 10)

The old `inspect()` set a hash, scrolled the page and focused a panel pinned to
the bottom of the viewport. Every clickthrough was a scroll. `Drill.svelte` is a
modal drawer on the `MetricDrill` shell — backdrop, Escape, click-out, focus
returned to the opener — so a click never moves the page under the reader. Deep
links keep working: a hash that names an artefact opens the drill on load, and a
hash that names a tab selects it, exactly as before.

### `glossary.ts` — the game theory, in words (ask 4)

The reader is a policy professional, not a game theorist. Every column type,
factor, band, relation family, evidence result, check verdict and provenance
origin gets a `what` / `why it matters` / `how to read it` entry, surfaced by
`ExplainLabel.svelte` on the header itself. It holds no values, only meanings —
the same split `metric-registry.ts` keeps.

### `actors.ts` + `ActorAtlas.svelte` (ask 5)

Five measures the reader switches between, each already in the data:

| Measure | Derived from |
|---|---|
| Worst exposure | the highest-ranked play they can run |
| Plays available | how many plays name them |
| Role in the policy | mentions × relationship degree, normalised |
| Times referenced | `actor.data.mentions` |
| Relationships | degree in the knowledge graph |

The visual is a **ranked horizontal bar**, redrawn on the chosen measure. One
magnitude per body, so bars — not a scatter, not a bubble cloud. Sequential
single hue (the accent ramp), because every measure here is a magnitude; the
band a bar carries is printed in words beside it. A filter row sits above the
chart, as `references/interaction.md` requires, and a table view carries the same
numbers for print and screen readers.

### `network.ts` + `RelationshipMap.svelte` (ask 6)

The twenty-six relation types fold into **seven families** — authority, money,
delivery, accountability, influence, dependence, evidence — and the map is a
**small multiple per family**, not seven colours. The site has exactly four
validated categorical hues; seven would mean generating hues, which the chart
rules forbid outright. Identity comes from the panel heading; magnitude from the
one accent ramp inside it.

Six derived insights, all structural, none of them a model call:

- authority without accountability
- bears the cost, receives no benefit
- measured by data it owns itself
- the bodies everything runs through (degree)
- one-way relationships the paper never closes
- the reciprocal pairs

### `StressLab.svelte` (ask 7)

Same `stress.ts` — untouched, because the arithmetic was never the problem. The
layout becomes: a **consequence strip** across the top (what moved, in four
figures), levers in a sticky left rail, and the two OPPOSITE directions split
into two named columns — *the assessment loses* and *the policy gains* — because
collapsing them is the one thing `stress.ts`'s own comment forbids.

### `ScenarioFlow.svelte` (ask 9)

The beats become a **process flow**: condition → first move → effects →
outcomes → detection → correction, as connected steps with the current beat
open. The existing step controls and the print-all block stay; this is a
presentation change over `scenarioBeats`, which is already tested.

### Word export (`report-doc.ts` + `/api/policy-analysis/[id]/export`)

`assessmentMarkdown()` is a pure module: artefacts in, a full markdown document
out. The endpoint renders it through the repo's existing
`synthesize({ format: 'docx', source: 'markdown' })`, which is how
`/projects/dfe-data-strategy` already produces a Word brief. Pure so the
document can be asserted in a test without a database, and so the shared copy
can render the SAME document minus its withheld kinds.

Print keeps everything it won on 2026-09-10: panels hide by class, disclosures
open in script before printing, every workspace named on paper.

## Decision Log

| # | Fork | Chose | Why | Reversible |
|---|---|---|---|---|
| 1 | Regroup twelve flat tabs into workspaces, or keep them flat | **Keep flat, restyle as a dashboard rail with counts** | The flattening was a deliberate 2026-09-10 decision; the defect was NESTING, not flatness. The rail gets group spines and a figure per cell so the shape of the assessment is visible without clicking. | Yes — `TABS` is one array |
| 2 | Inspector stays sticky / becomes a drawer | **Drawer** | Ask 10 is explicit, and the sticky panel was the thing doing the scrolling. | Yes |
| 3 | Colour the seven relation families / small-multiple them | **Small multiples** | Only four categorical hues are validated on this site; a fifth would be invented. | Yes |
| 4 | Actor visual: scatter, bubble, or ranked bar | **Ranked bar, measure-switched** | One magnitude per body. A scatter would force two measures when the reader asked to pick one. Prints legibly. | Yes |
| 5 | Word export client-side or server-side | **Server** | `docx` is a server dependency already wired through `synthesize()`; shipping it to the browser would blow the client budget. | Yes |
| 6 | Rewrite `stress.ts` / restyle only | **Restyle only** | The two-direction split is a hard-won invariant with tests. The complaint was layout. | n/a |
| 7 | Summarise the verdict by paragraph split or by a new model field | **Paragraph split, client-side** | Ask 1 says "first para". A new contract field would mean a schema change and a re-run of every completed assessment. | Yes |
| 8 | Tone: rewrite copy in place or add a standing frame | **Both** | Ask 3 is about the reader not being the author, which is a framing problem first and a wording problem second. | Yes |

## Verification

- `npx vitest run src/lib/policy-analysis src/lib/components/policy-analysis`
- `./scripts/gate-structural.sh` — the five lint gates the remote gate skips
- `./scripts/gate-remote.sh --build` on porkserv — svelte-check OOMs on homeserv
- A dev server on the real RSH assessment: peek opens, drill opens, no scroll on
  click, the atlas redraws on every measure, the export downloads a .docx
- Production after merge: `build/.deploy-sha`, then the live page
