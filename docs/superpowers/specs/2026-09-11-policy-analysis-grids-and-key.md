# /policy-analysis — grids, definitions, and a masthead that reaches the edge

Second pass over the dashboard, 2026-09-11. Branch `feat/policy-dashboard-rethink`.

John, on the first pass (#822): *"it doesn't go far enough, and has focussed on
reorganising the pages instead of fundamentally rethinking them… Even basic
things are wrong like the header is not full width. The report approach is just
too dense in information, is uses inaccessible language, the actors page remains
too long where it could be a much neater x by y table. Theres no definition of
the structures, some of the measures used, or anything."*

## The diagnosis, measured

The first pass added a depth gradient — a figure, a hover, a drill — over content
that was still **rendered as full-size stacked cards**. So the reader's choice was
still "which wall", it was simply a nicer wall. At 1440px on the nine-body RSH
assessment:

| Workspace | Before | After |
|---|---:|---:|
| Ways to beat it | 5,321px | 2,558px |
| The write-up | 4,668px | 1,567px |
| How they connect | 4,481px | 2,947px |
| Who is involved | 3,541px | 2,669px |
| Gaps in the paper | 3,179px | 2,127px |
| What if we are wrong | 2,138px | 1,572px |
| Verdict | 1,595px | 1,898px |

The verdict is the one that grew, deliberately: it named nothing before.

And the masthead: `max-width: 1400px` sat on the page WRAPPER, so the ink lede
band was a 1400px card with the gutter growing as the window did — 260px of cream
either side on a 1920 monitor. The negative margin it used to break out could
only ever reach the wrapper, never the window.

## What ships

### 1. The measure moved off the wrapper and onto each band

`/research` already had the answer and this copies it exactly: `.research-page`
carries no measure, the ink lede is full-bleed, and `.lede-inner` /
`.research-body` each do `width: min(1400px, 100%); margin: 0 auto`. Here
`.pa-band` paints to the window edge and holds its content to `--pa-measure`;
`.pa-wrap` is the measure with no paint. Verified at 1920, 1280 and 430: band
1920 wide, inner 1400 at x=260, zero horizontal overflow at every width.

The strap and the standing frame need a WRAPPER (`.ab-head`) rather than the
measure on themselves: both are `<p>`, both carry their own `margin` shorthand,
and the layout's `.policy-page p { max-width: 75ch }` beats a `width` on the
element — so at 1920 they hugged the left edge while every panel beside them sat
on the measure.

### 2. Three walls of cards became three grids

`matrix.ts`, pure and tested: `traitGrid`, `playGrid`, `adjacency`. `Grid.svelte`
is the shared table — sticky header and first column on an OPAQUE ground,
`table-layout: fixed` with a `<colgroup>`, scroll on the wrapper and never on the
page, stickiness dropped in print because a sticky header prints once and leaves
every page after it unlabelled.

- **The cast is the x-by-y table John asked for.** Nine bodies down, the six
  questions that decide how each behaves across. Nine cards repeating the same
  six field labels were 2,600px of a 3,541px panel; the grid lets a reader run
  a finger down "Judged on" and see the gameable measures line up.
- **The playbook is a ranked table.** Eleven rows where eleven cards stood. Each
  factor is a number AND a bar in one cell — a bar alone cannot be read off
  precisely enough to argue with, a number alone cannot be scanned down a
  column — and the computed figure sits at the end, so the arithmetic reads left
  to right.
- **Bodies × bodies finally draws the network.** The old panel had six family
  small-multiples, six prose readings and a 37-row list, and never showed the
  SHAPE: a full row is a body everything runs through, an empty column is a body
  nothing answers to, a cell with no partner across the diagonal is a link the
  paper states one way only. Families are GLYPHS, not colours — the site has
  four validated categorical hues and there are seven families. The grid is
  capped at twelve bodies, and names what it left off.
- Checks are four columns; the family breakdown and the full relationship list
  fold behind disclosures that `print.ts` opens for the pack.

**The repeated label was as bad as the wall.** Every one of 54 cast cells carried
the words "structural inference" under it, which is true and hides the values it
annotates. `traitCoverage` finds the dominant origin, the caption states it once,
and a cell labels itself only when it DIFFERS — with a one-word badge (`short`),
because "a guess about how a body would act" wrapped to three lines under every
value in a column.

### 3. The write-up reads one movement at a time

Five in-page anchors with all five acts rendered below them was 4,668px — and the
rail was the last clickthrough in the feature that scrolled the reader to
somewhere else in the same document, which the original brief ruled out. It
selects now. Every act stays in the DOM, hidden by CLASS, so find-in-page and
`@media print` still reach all five.

### 4. The verdict names things

It carried a headline, four factor bars, four counts and a band strip, and named
not one single thing — so a reader with ninety seconds left knowing the paper had
"11 ways to beat it" and no idea what any of them were. **The short version** is
four columns that name the worst plays, the thinnest checks, the one assumption
most of the assessment rests on, and what the assessment suggests. Every line
opens its own drill; every column also leads to the workspace holding the rest.

### 5. The stress lab previews instead of explaining itself

At rest its right-hand half was three paragraphs about what would happen if you
used it, beside four zeroes. It now runs the same computation against the most
load-bearing assumption and shows what would move, with one button to commit.
Costs nothing — the whole module is a walk over citations that already exist. The
duplicate list of the five most fragile assumptions above the lab is gone; the
lab's own rail already offered them as switches.

### 6. Definitions, visible and exported

The first pass's explainers were all hover-only, which answers "what is THIS
column" for a reader who already suspected there was something to ask and answers
nothing for one who opens the page cold and finds bodies scored on "concealment".
There was no page that said what a play IS.

- `glossary.ts` gains **`STRUCTURE_TERMS`** — the sixteen things the pipeline
  emits, in the order the argument runs, each with what it is, why it exists and
  the trap in reading it — plus **`READING_CHAIN`** (how they join),
  **`formula`** on every computed measure, **`plain`** (the plain-English name
  every table now leads with) and **`short`** (a one-word badge for a cell).
- A **"How to read this" workspace** (`KeyPanel.svelte`) renders it as a
  document, not a tooltip, and prints as the pack's appendix.
- `report-doc.ts` renders the same content into the Word and markdown exports
  from the same module, so the screen and the document cannot drift into two
  definitions of "exposure".

**A real collision fell out of writing the coverage test.** The relation family
`evidence` and the artefact kind `evidence` share one `Map`, so the family
silently replaced the structure and every hover on "Evidence link" showed the
family's wording. Family keys are now `familyTermKey(key)`, and a test asserts
the key holds every term exactly once.

### 7. Language

Every table leads with the plain name and keeps the technical word beside it:
"Reason to do it (incentive)", "How hard it is to spot (concealment)", "Overall
risk (exposure)", "Things resting on it (dependants)". The workspace rail reads
as questions — "Ways to beat it", "Who is involved", "What if we are wrong",
"Gaps in the paper" — and the group labels lost their articles to buy back a rail
row.

## What was retired

`PlayCard.svelte` and `ActorBoard.svelte`. The drill already renders a play in
full, and the cast grid replaces the board; both were left referenced only by
their own tests, which is what dead code looks like.

## Verification

- 32 new tests over `matrix.ts` and the glossary; the dashboard suite updated
  where it encoded the OLD decisions (the report's anchors, the stress lab's
  resting copy).
- All six lint gates the remote gate skips, run locally: public routes, font
  sizes, measure, source footprint, module boundaries, schema imports.
- Driven in a browser at 1920/1280/430 against BOTH copies. On the shared copy —
  which renders two fewer workspaces — End, ArrowRight and Home each keep exactly
  one panel lit, which is the dead-index trap the last pass found.
- Print emulated: all fourteen workspaces and all five movements reach the page;
  the run log stays off it deliberately.
