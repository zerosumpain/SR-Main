# The Engine Room — channels, ratification, the estate, and three capability pages

Date: 2026-08-07
Status: self-approved (autonomous build, Full grade)
Surface: `/projects/engine-room`

## The ask

Add to the Engine Room field study:

1. The **intelligence graph across multiple channels**, and **how it ratifies knowledge
   artefacts**.
2. **How the site is organised architecturally** across the public origin, the machine at
   home, and object storage.
3. The **actual functionality of Drive and Slides**, and the **integrations** — Apple Health,
   Whoop/Strava, and data APIs.

## What ships

Seven new leaf pages and one new part hub, following the study's existing contract:
`LeafHead` → `Instrument`(s) → `PageFoot`, all content in typed constants under `lib/`, all
figures traceable to a constant, no secrets/hostnames/addresses/credentials anywhere.

| Route | Part | Flagship instrument |
|---|---|---|
| `memory/channels` | II | Pick a channel; see who authored it, whether it pushes or is pulled, what it is graded, and what it costs |
| `memory/trust` | II | The real four-component confidence scorer, operable: two grading dials, corroboration, age, human confirmation |
| `reach/drive` | III | Drop a file kind in and watch which of six paths it takes to becoming searchable |
| `reach/decks` | III | A fixed 1280×720 stage: pour words in at a chosen register and watch it overflow |
| `reach/feeds` | III | Stored status against what a live probe just observed — the board where they disagree |
| `ground/estate` | V | Pick a machine; see which subsystems wake up on it and which refuse |
| `ground/storage` | V | Pick a kind of thing; see which of four stores it goes to and why |

Supporting changes: `lib/nav.ts` (fifth part + eleven new leaves), the index copy, the system
map's section links, `lib/retrieval.server.ts` (new corpus chunks so the Ask dock can answer
about all of it), `lib/references.ts`, and the public-routes lockfile.

## Decision log

**A fifth part rather than more leaves on the existing four.**
Options: (i) put architecture in Part IV *Change*; (ii) put it on the index; (iii) add Part V
*Ground*. Chosen (iii). *Change* is about self-modification and an estate page there would be
a second subject under one strap. The index is orientation only, by its own comment. And
"Ground" is already a named band on the system map with no page behind it — the fifth part
fills a hole the study had already drawn. Reversible: the IA is one file.

**Two ground pages, not one.** "Which machine runs what" and "where the bytes live" are
different questions with different instruments, and a one-leaf part reads as an accident.

**Channels and ratification split across two pages.** They are one subject and two arguments —
*where knowledge arrives from* and *what makes it believable*. The 350-word prose cap would
force a merge to drop one of them to a sentence, and ratification is the more interesting half.

**Data APIs folded into `reach/feeds` rather than a page of their own.** A health feed is a
hard-wired connector and the API catalogue is the soft-wired version of the same thing; both
fail in the same way (a stored status that claims to be evidence). One page, two instruments,
one argument. Descoping risk is low — if it reads thin later it splits cleanly.

**Reach re-ordered rather than appended.** New order: tools → mcp → drive → decks → feeds →
workflows. The catalogue and the doorway open the part, the three capability surfaces sit in
the middle, and "wiring it together" closes it. No URL changes; prev/next is derived.

**The trust scorer is re-implemented as a constant, not imported.** Precedent: `lib/memory.ts`
re-declares the matching ladder rather than importing the live one. A public page must not
couple to internal modules even for a pure function. The weights, the neutral midpoint, the
saturation constant, the half-life and the floor are copied as named constants with the source
module named in a comment, so a drift is a visible diff rather than a silent one.

**Vendor names avoided for infrastructure, kept for standards.** The study already names
SvelteKit, Postgres and WebDAV in its reference list and calls its own estate "the origin", "the
edge", "a disposable machine". The new pages follow both halves of that: the Admiralty grading
scheme, WireGuard and OAuth are named because they are the thing being described; the hosting
provider, the region and the storage account are not, because they are the address of a machine.

## Non-goals

- No live queries. Every figure is a constant counted from source on 7 August 2026.
- No new API routes, no schema change, no dependency.
- Entity resolution itself is not re-explained — `memory/entities` already owns it, and
  `memory/trust` links to it rather than repeating the ladder.

## Verification

`npm run gate` (public-routes lockfile rewritten and reviewed, check, tests, build), then merge
to master, then live verification of all eight new URLs on production plus the Ask dock
answering a question that can only be sourced from the new chunks.
