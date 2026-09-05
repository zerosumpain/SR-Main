# Intel resolution v2 — better matching, better triage, a navigable taxonomy, a category-aware map

Kicked off 2026-08-29, autonomous (Full grade). Brief:

> on intelligence, I want a better more comprehensive / automated / research
> assisted way of matching entities and triage. Build an improved system, do
> this autonomously. Also the categories page should be easier to navigate with
> suggestions of things to merge. The 2d/3d map should allow highlighting and
> filtering by category too.

## The state it starts from (measured on production, 2026-08-29)

| | |
|---|---|
| live entities | 4,513 |
| **pending triage** | **1,241** |
| entity types | **257** — 29 active, 227 proposed, 1 retired |
| ER categories (`intel_categories`) | **0** |
| notes | 3,348 |
| relationships | 5,364 |
| merges applied | 490 |

Five concrete defects behind those numbers:

1. **A rejection is not remembered.** `/jkai/intel/quality` "Dismiss" writes to a
   client-side `Set` that dies with the tab. Every sweep re-proposes every pair a
   human has already ruled out, forever. There is no table for it.
2. **Aliases are not matched on.** `intel_entities.aliases` is populated by
   extraction and `loadResolvableEntities` does not even SELECT it. The one column
   that exists to bind surface forms together is invisible to the matcher.
3. **Candidates can only meet through a shared token or a shared address.**
   `findDuplicateCandidates` blocks on significant tokens and acronyms. Two names
   for one thing that share no token ("MoJ" vs "Ministry of Justice" is caught by
   the acronym rule; "Companies House" vs "CH register" is not) never meet, so
   they are never even scored. The `semantic` signal exists but can only
   corroborate a pair that a lexical block already produced.
4. **Nothing reads the evidence.** Every signal is a string comparison, an email
   equality or a cosine. Nobody looks at what the notes actually SAY about the two
   entities. That is the "research-assisted" half of the brief and it is missing
   entirely.
5. **Triage is 1,241 coin flips in a row.** The queue is ordered but not grouped,
   and it does not know that an item is a duplicate of something already
   confirmed — so an entity that should be merged gets confirmed instead, which is
   how the duplicate count grows faster than the sweep clears it.

Plus the two surfaces named in the brief:

6. **There is no categories page.** The taxonomy lives as one panel on
   `/jkai/intel/quality`: 257 types rendered as a chip list and two `<select>`s
   with 257 options each. Navigating it is not possible, and it offers no
   suggestion about what should be folded into what.
7. **The map cannot highlight or filter by category.** Nodes carry `categories`
   and `typeId`; the graph colours by cluster only, the type filter is a
   single-select `<select>`, and the category filter is buried in the Sources
   rail behind a `filesInPlay` gate.

## What gets built

### A. Resolution engine

- **`intel_match_decisions`** — a durable verdict per ordered pair
  (`same` | `different` | `unsure`), with who decided (`human` | `llm` | `auto`),
  the signals, a rationale and the model. `findDuplicates` subtracts human
  `different` verdicts; the count subtracted is REPORTED, never silent.
- **Alias-aware loading and blocking.** `loadResolvableEntities` gains
  `aliases`, `summary` and `canonicalName`; blocking keys are drawn from every
  alias as well as the name; a new `alias_match` signal fires when one side's
  name is the other's recorded surface form.
- **Semantic blocking.** A pgvector `<=>` lateral top-K over
  `intel_entities_embedding_hnsw_idx` produces candidate pairs that lexical
  blocking cannot reach, which are then scored by the ordinary rules.
- **LLM adjudication.** `resolve/adjudicate.ts` assembles a dossier for one pair
  — names, aliases, types, summaries, email properties, shared neighbours and up
  to three evidence excerpts each — and asks for `same` / `different` /
  `unsure` with a one-line rationale. The verdict is stored as a decision row.
  Available per-row and per-batch from the UI, and as a nightly engine stage
  over the undecided mid-band.
- **Adjudication moves the score, it does not bypass review.** An LLM `same`
  raises confidence; an LLM `different` drops it below the queue floor and files
  the pair under "ruled out", where it stays visible and reversible.

### B. Triage

- `/jkai/intel/review` gains a **duplicate suggestion per queue item** — computed
  by the same matcher, against confirmed entities — with merge-instead-of-confirm
  on one key.
- A `duplicates` sort order, and bulk actions for the two mechanical cases
  (confirm everything above a confidence-score floor; reject everything with no
  evidence and no neighbours).

### C. `/jkai/intel/categories`

A real surface, in the nav, with two panels:

- **Entity types** — searchable, grouped by status, sorted by usage, with
  **merge suggestions**: lexical near-duplicates, singular/plural pairs,
  co-occurrence, and the 227 empty proposals as one bulk action.
- **Source categories** — list/create/edit/delete as today, plus a **merge**
  that rewrites `intel_notes.categories` and `drive_folder_settings.category_ids`
  (a capability that does not currently exist at all).

### D. Map

- A **colour-by** mode on both the 2D and 3D graph: `cluster` (today) | `type` |
  `category`, with a legend.
- Legend chips **highlight** (everything else washes out, nothing moves) and
  **filter** (a real query narrowing) as two separate actions.
- The type filter becomes multi-select (`types` CSV on the network API,
  `typeId` kept for URL compatibility).

## What was found while building it

Three things that were not in the plan because nothing in the code said them.

**Aliases were never written by anything.** `intel_entities.aliases` is read by
entity linkification, the ingest preview and lens filters. It is written by
nothing. On production, after 490 merges, all 4,513 live entities carried `[]`.
So the graph forgot every merge the moment it applied it: the surface form that
had produced a duplicate was discarded, and the next extraction could fork the
same duplicate again. `mergeEntities` now records the loser's name, and
`backfillAliasesFromTombstones` recovers the 490 that were thrown away — the
tombstones still hold their original names, so the whole history is recoverable
from the graph itself.

**The dominant false positive is a number.** Running the pgvector pass over
production showed what actually sits at the top of the similarity ranking:
`192.168.1.0/24` vs `192.168.0.0/24`, `32GB` vs `16GB`, `700Wh Battery` vs
`600Wh Battery`, `iteration 2` vs `iteration 3`, `PR #166` vs `PR #173`,
`Nmap 7.80` vs `7.991`. One series, many members, every pair 92–98% similar and
every pair two different things. `differsOnlyByNumber` settles them for free —
both sides must carry digits, so "MoJ AI action plan" vs "MoJ AI action plan
(2025-2028)" is untouched: a number APPEARING is not a number CHANGING.

**Colouring by type would have painted the graph one colour.** 48 of 55 entity
types carry the column default `#7dd3fc`, and the seven that do not are
off-palette Tailwind values. So the stored colour is treated as "nobody chose
one" and the palette slot is hashed from the key instead — with the legend going
through the same helper, because a key that disagrees with the picture is worse
than no key.

**The semantic pass was a 172-second outage waiting to happen.** It runs in
211ms on homeserv's 1,121 entities and in **172 seconds** on production's 4,513
— because Postgres defaults `random_page_cost` to 4.0, the embeddings are
TOASTed so the table looks cheap to scan, and the HNSW index loses the estimate.
Inside a `LATERAL` that mistake is multiplied by the row count: 4,513 correlated
probes each falling back to a seq scan. `SET LOCAL random_page_cost = 1.1`
(the treatment `context.ts` already gives the chat-turn lookups) takes it to
**3.6 seconds** for the identical 2,705 pairs, and the result is memoised for
five minutes because three intel surfaces trigger a sweep on one visit.

A vector query that is fast on homeserv tells you nothing about production.

## Verified

- `npm run gate:test` — 8,178 passing, 691 files. `svelte-check` clean.
- Static gates: public-routes, font-sizes, measure, module-boundaries,
  schema-imports all OK.
- Alias backfill against the local graph: 10 merges recovered, e.g.
  `Office for National Statistics ← ["ONS"]`, `IBCA ← ["Infected Blood
  Compensation Authority (IBCA)"]`.
- Adjudication end to end, 7 real pairs, 0 failures. Every judgement correct:
  *Chair of the Authority* / *Deputy Chair of the Authority* → **different**
  ("the shared source explicitly distinguishes the two roles" — that is the
  co-mention lookup doing exactly what it was added for); *deep navy blue
  background* / *Navy Blue Background* → **same** (0.95); *Government AI Testing
  and Assurance Framework* / *AI Assurance Framework* → **unsure**, which is the
  right answer.
- Verdicts move scores as designed: `different` → 0.2 and out of the queue but
  visible under "answered"; `same` → 0.70 lifted to 0.795.
- Browser QA on all four surfaces, 0 console errors.

## Decision Log

| Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| What "the categories page" means | (a) `intel_categories` (0 rows on prod) (b) `intel_entity_types` (257 rows, unnavigable) (c) both | **(c)** — one page, two panels | (a) alone would be a page about nothing; (b) alone ignores the literal word. Both is one route and satisfies either reading. | Yes — a panel is deletable. |
| Where the new page lives | new `/jkai/intel/categories`; or grow the quality panel | **New route**, quality links to it | Quality is about the graph's shape; the taxonomy is its own object with its own backlog. It also earns a nav badge. | Yes. |
| LLM adjudication scope | every pair; mid-band only; on demand only | **Mid-band + on demand**, capped per night | The band 0.35–0.85 is where all the human work is. Above it the rules are already right; below it the volume is unbounded. | Yes — a cap and a kill switch. |
| Does an LLM verdict auto-merge? | yes; no | **No.** Originally "no, but a `same` lifts the score toward the threshold" — the lift was **deleted 2026-08-29** after the first production run measured it as incapable of promoting anything | Auto-merging on a model's say-so is the one irreversible-feeling action here. The lift was meant to be the safe middle ground and turned out to be nothing at all: all 49 confirmations scored 0.49–0.55, a +0.094 maximum cannot reach 0.85, and zero could cross. It only made the displayed number disagree with the matcher's reasoning. A confirmation now reaches a merge through a person, from the quality page's "select the N confirmed". | Yes — every merge is in the ledger. |
| Rejected pairs: hide or show | hide silently; show under a filter | **Show under a filter, with a count** | A silent guard that swallowed everything is a documented failure on this codebase. | — |
| Where the work happens | shared checkout; own worktree | **Own worktree from `origin/master`** | The shared checkout is on a stale branch (behind master on the very intel files this touches) and another session has uncommitted work in it. | — |
| Multi-select types | replace `typeId`; add `types` | **Add `types`, keep `typeId`** | Existing links and the entity-card deep links carry `typeId`. | Yes. |
| Adjudicator grounding | graph evidence only; add web search | **Graph evidence, plus notes naming BOTH entities** | Web-grounding an identity call is where fabrication would enter, and the corpus already held the decisive material unread — a source naming both is usually saying they are two things. The first live run confirmed it: the Chair/Deputy Chair verdict cites the shared source. | Yes — the loader is one function. |
| Which model reads the pairs | reuse `extraction`; a new workload | **A new `resolution` workload following the site default** | Extraction is pinned cheap because it is mechanical JSON on a latency-visible path. This is the opposite, and the spend needs its own line in the ledger — it is the first thing in intel that costs money PER PAIR. | Yes — the picker can repoint it. |
| Series pairs (`700Wh` vs `600Wh`) | drop them; demote them; hand them to the reader | **Demote and withhold, with the count on screen** | A rule settles them for nothing; spending a model call to agree would be waste. Withheld rather than dropped, and a human saying "same" overrules it — a guard nobody can overrule is a bug with a rationale. | Yes — lower the confidence floor and they reappear. |
| Type colours on the map | honour `intel_entity_types.color`; hash the palette | **Honour it only when it is not the column default** | 48 of 55 types carry the default, so honouring it paints one blue graph. | Yes. |
| The taxonomy panels on /jkai/intel/quality | keep both; keep one; move both | **Move both to the new surface, leave a link and the `#types` anchor** | Two places governing one vocabulary is how they drift. The anchor stays because an insight action links to it. | Yes. |
