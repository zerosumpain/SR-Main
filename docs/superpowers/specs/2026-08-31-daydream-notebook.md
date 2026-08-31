# Daydream Notes — a middleground place for ideas, and an engine that reads them

Autonomous run, 2026-08-31, continuing the standing "do it autonomously" brief.

## The ask

> I want to be able to write 'daydream notes'. Free text, markdown compatible,
> like a note taking app with simple structuring (categories, folders). A
> middleground place to put ideas, or blog musings, or thoughts, actions, tasks.
>
> A daydream activity should be on dead-cycles, reviewing notes with a model,
> looking for research topics, intelligence links, documents, people, places or
> dates that might be useful, and creating supporting information for those
> notes. Token capped. It can kick off automated research activities — short
> ones only — linked back to the notes. Each note has a list of actions the
> daydream model has planned and executed. Notes AND ANY OTHER ACTIVITY THE
> MODEL UNDERTAKES should weave into future ponders, daydreams, suggestions,
> intelligence, and the knowledge graph.
>
> The notes interface needs to be simple and elegant. Open, title, text, save,
> close. Usable.

Plus a bug: a stale feed item still prints the pre-fix sleep figure.

## Precedents this copies rather than invents

| Need | Existing thing |
|---|---|
| An idle-cycle, token-capped model pass | `heartbeat/activities/daydream-ponder.ts` — `isUserActive`, `listJobs`, `budgetStatus`, `attributeSpend` |
| A closed action vocabulary, validated as DATA | `daydream/actions.ts` — "each kind here is a capability grant, and widening it is a decision, not a refactor" |
| Short research that returns an answer | `research_start` at `scan`/`brief`: `budgetMs != null` ⇒ `runResearchSync`, so it finishes inside the caller's patience. `investigation` is unbounded and is refused here |
| Weaving text into the graph | `extractIntoIntel` — a fifth `AutoKind`, not a second pipeline |
| Reaching the ponder engine | `ponder/run.ts` `aggregates` — the same slot `noteCards`, `diaryNoteCards` and `rulingCards` already use |
| Owner-gated action endpoint | `api/daydream/thoughts/+server.ts` — one route, an `action` discriminator |

## Files to touch

| File | Why |
|---|---|
| `src/lib/db/schema.ts` | `daydream_notebook` + `daydream_notebook_actions` |
| `src/lib/daydream/notebook/store.ts` **(new)** | CRUD, folders, listing |
| `src/lib/daydream/notebook/actions.ts` **(new)** | The closed vocabulary, validator, executor |
| `src/lib/daydream/notebook/review.ts` **(new)** | The model pass: reads a note, PLANS actions as data |
| `src/lib/daydream/notebook/cards.ts` **(new)** | Pack cards + the weave text |
| `…/{actions,review,cards}.test.ts` **(new)** | |
| `src/lib/heartbeat/activities/daydream-notebook.ts` **(new)** | The idle-cycle activity |
| `src/lib/heartbeat/registry.ts` | Register it |
| `src/routes/jkai/notes/+page.{server.ts,svelte}` **(new)** | Open, title, text, save, close |
| `src/routes/api/daydream/notes/+server.ts` **(new)** | Owner-gated CRUD + run-now |
| `src/lib/jkai/intel/auto-extract.ts` | `AutoKind` gains `'note'` |
| `src/lib/daydream/ponder/run.ts` | Notebook cards into the pack |
| `src/lib/components/jkai/JkaiTabBar.svelte` | Nav entry |

## The rules that do not bend

1. **The model never edits John's text.** Supporting information is written to a
   separate, attributed column and rendered as the model's, never merged into
   the body. Same discipline as `daydream/notes.ts`: "a note is never
   interpreted at write time. It goes in verbatim."
2. **Research is `scan` or `brief` only.** `investigation` is refused by the
   validator, not merely discouraged — it is unbounded and would run for 20+
   minutes off a background tick.
3. **Planned ≠ executed.** The model returns a PLAN as data over the closed
   vocabulary; code validates and executes. Every action row records both
   stamps, so "what it decided to do" and "what it actually did" can never be
   confused on the page.
4. **Token capped, on spare cycles only.** Same two idle gates and the same
   `budgetStatus` the ponder engine uses; a run that cannot afford itself skips.

## Verification

1. Unit tests on the validator (especially the depth refusal), the plan parser
   and the card/weave text.
2. `npm run gate:{public-routes,font-sizes,measure,schema-imports,boundaries}`
   — **all five, from the worktree** (see the Decision Log).
3. `./scripts/gate-remote.sh --build`.
4. A scratch-DB drizzle push proving the schema applies non-interactively.
5. Live on the built server: write a note, save it, reopen it, run the review by
   hand, and confirm an action row appears with both stamps and a link back.

## Decision Log

**D1 — `notebook`, not `notes`.** `src/lib/daydream/notes.ts` already exists and
means something else entirely (what the owner said about a *thought*, stored as
a memory). A second `notes` module would be the most confusing name available.
The user-facing word stays "notes"; only the module is `notebook`.

**D2 — Its own route, not a ninth hub tab.** "Open, title, text, save, close"
is a writing surface, and burying it in a tab of a 3,000px hub that reloads the
heaviest query on the site is the opposite of usable. `/jkai/notes` stands
alone and is linked from the jkai tab bar. Reversible.

**D3 — Folders are a STRING on the note, not a table.** "Simple structuring"
does not need a hierarchy with its own CRUD, and a folder table would need
create/rename/delete/merge UI before the first note could be filed. A `folder`
text column with a datalist of what already exists gives foldering with no
management surface at all. Reversible into a table if it ever earns one.

**D4 — The plan is data, and the executor is code.** The model returns
`{kind, …}` over a closed list; `validateNoteAction` refuses anything else,
including a research depth it is not allowed to ask for. This is the same shape
`daydream/actions.ts` and `rules/spec.ts` already use, and it is what keeps a
prose-generating model from reaching a capability nobody granted.

**D5 — Supporting information is APPENDED, attributed, and separately
clearable.** Not merged into the body, not a diff against John's words. If the
whole review path failed permanently, every note would still read exactly as
typed.

**D6 — The stale musing is repaired as DATA, not with a sweeper.** One row
(`ad3233ec`) carries the pre-fix figure in its explanation. The code fix stops
recurrence; a general "retire anything whose numbers have since changed" sweep
is speculative machinery for a population of one. Archived on production,
reversible, and reported.
