# Daydream: the aperture

**Status:** built 2026-09-17. Review that produced it:
https://claude.ai/code/artifact/38944ee5-d304-40a4-a783-9cc5668486de

John's brief: *"I think it's not being as creative in what it thinks about
enough."* Ten changes, in three waves, toward an autonomous mechanism grounded
in John that explores in free cycles and acts usefully.

## What the measurement found (production, 2026-09-17, read-only)

Everything below is a count from the production database or a heartbeat pulse.

| | |
|---|---|
| ponder cycles, 30 days | 97 |
| musings proposed | 184 |
| musings actually new | **41** — the other **137 merged** into a live claim |
| musing themes, 14 days | 35 `plans`, 5 `money`, 1 `family`, 0 `health` |
| `musing_patterns` / `musing_general` | **never fired, ever** (added 27 Aug) |
| capability proposals admitted since 4 Sep | **0 of ~39**, 13 consecutive nights |
| hypotheses ever | 337 — 202 inconclusive, 135 underpowered, **0 supported, 0 refuted** |
| leads | 11 open, **59 abandoned**, 0 earned |
| signals registered / askable / carded | 315 / 22 / 15 |
| action kinds | **1** (`remind`) |
| free-text notes from John | 7 |

### The two bugs

**1. The capability lane dropped 100% of what it proposed.**
`renderAppetitePack` prints each fact as `[intent:0] …` and the prompt asked the
model to cite the `[key]` *verbatim*. It complied. `packKeys.has('[intent:0]')`
was false against a set holding `intent:0`. Thirteen nights, `3 proposed → 0
admitted` every time, `daydream_capabilities` empty. The ideas binned were the
wide ones the lane exists for: a National Rail Darwin feed, a UK legislation and
bill feed, Google Places for local availability, an FIA results feed, a Forest
Holidays availability watch, recurring-payment reconciliation.

This is the second time this exact class of failure has cost the engine: every
lead ever proposed was once rejected for `unknown metrics` because the prompt
named a vocabulary the model could not see. Nothing reported either, because "0
admitted" is a legitimate answer on any single night and nothing watched the run
of them.

**2. The test arm has never returned a finding.** 337 hypotheses, all the same
shape — *"on days John does more X, does he do less Y?"* — over the same 22
daily metrics. Pairwise correlation over a few months of daily aggregates under
FDR control almost never clears. The frontier is not short of data; it is short
of question shapes.

## The ten changes

### Wave A — repair (commit 1)

**1. Unbreak the capability lane, and make a dead lane say so.**
`cites.ts` — one rule for reading a citation back off a model's answer. Brackets,
backticks and surrounding whitespace are formatting the renderer chose, not part
of a fact's identity; what a key *means* stays exact, so `intel:4` can never
resolve to `intel:5`. Both audits (appetite, ponder) use it. The appetite prompt
also now says what a key *is* rather than "verbatim".

`lane_silent` joins `FAULT_KINDS`: a stage that proposed something and was
allowed to keep none of it raises a fault self-improve reads first, and clears it
the moment it admits again. Condition is deliberately narrow — `proposed > 0 AND
admitted === 0`. A stage that proposed nothing is content, not silent.
`raiseFault` upserts, so the row's `count` *is* the run of nights.

**2. Tell it what it already said.** An `ALREADY SAID` block in the ponder
prompt from the week's live claims, beside the refuted block — the fix that
already worked twice here. Rule 4b: a repeat only earns a slot when a cited card
has **changed**, and it must say what changed and cite it. Not a ban; silence
about a live subject would be worse than the repetition. The pulse summary also
gains `merged`, whose absence is why the circling went unseen for a month.

**4. Signal seats rotate, and cards carry a shape.** Ten seats keep the movement
ranking; five walk the rest of the registry on a clock-derived cursor, reaching
everything in about a week. `signalShape()` adds what a signal is *doing* —
shifted from its own history, stopped reporting, first readings, unmoved —
because a mean alone cannot tell the model whether a reading is ordinary.

**7. One askable vocabulary.** `sweepableSignalMenu` moves from
`hypotheses/propose.ts` to `signals/registry.ts` and leads read it too, so a lead
may finally name a registered signal. Two copies of that list is how a sensor
stayed sweepable-but-never-askable. `MIN_PAIRS` still keeps a signal discovered
this morning out of the vocabulary.

### Wave B — aperture (commit 2)

**3. Rotate the lens.** `ponder/lens.ts`. Six angles — household, money, health,
house, knowledge, longview — one per cycle on a clock-derived cursor, so all six
are looked at daily. A lens is two things and the second matters more: a
reweighting of the card budget (`limitsFor`, never zero, `LENS_FLOOR = 2`), and a
**brief** naming what the cycle is for. Every brief ends by saying it is a
direction and not a fence. With every weight at 1 the pack is byte-for-byte what
it was.

**5. The long look.** `longViewCards()` — 30-day drift against the 60 before,
and **what has stopped**: named places with 4+ visits not seen for 3 weeks.
Plus a `record:span` card stating where the history begins.
**No year-on-year comparison**: the record starts 2025-12-25, so "this week last
year" has no rows behind it. The span card exists precisely so nothing reasons
past the end of the data.

**10. Spend the headroom, and make it argue.** A `deep` cycle returned 636
completion tokens against a quota meter reading 0% of both windows. The standing
rule is that spare budget buys *thinking*, never talking — so it does not raise
the musing cap (which would mostly buy more echoes). `ponder/adversary.ts` is a
second pass over the same pack and the same musings: `stands`, `drop` (must name
the card that trivialises it), or `sharpen` (replacement text, through the same
citation audit). It cannot add musings, change a theme or touch leads. Gated on
`budget.applies && budget.reachable && depth === 'deep'` — on a non-Codex model
the spend is cash and an extra call a cycle is a bill, not slack.

### Wave C — faculties (commit 3)

**6. A question shape the data can answer.** `rankOutliers()` — which signals sat
furthest from their own recent history, ranked across the **whole** registry
rather than the seated cards, since the sensor worth naming is by definition the
one that did not win a movement seat. A single series against itself has no
pairwise power problem. Reported as a standardised distance and labelled *"A
distance, not a finding"* — claims still belong to the sweep and the hypothesis
machinery, which correct for multiplicity.

**Honest scope:** three of the four shapes the review proposed are delivered —
change-point (`signalShape`), absence (`longViewCards`, `signalShape`) and
outlier ranking (`rankOutliers`). **Conditional next-day means is not**: it needs
a verdict vocabulary and a schema change of its own, and the lead machinery stays
pairwise. Recorded here rather than half-built.

**8. More than one verb.** `ACTION_KINDS` goes from one to four: `remind`,
`watch` (`createMonitor`), `draft` (a notebook note), `ask` (one question, filed
where the briefing shows it and the next pack cards it — so the answer comes back
through the note → memory path that already exists).

The capability boundary: **`watch` is tap-only.** A one-tap action executes
because John pressed it; a standing rule executes on its own for ever once
approved. A rule that arms monitors manufactures recurring notifications nobody
read first, which is the single thing the no-auto-activation design exists to
prevent. `validateAction(raw, context)` takes `'tap' | 'rule'`, defaults to
`'tap'` so every pre-existing caller is unchanged, and both automatic call sites
(`rules/spec.ts`, `daydream-detect.ts`) pass `'rule'`.

**9. His own words steer it.** `assembleProfile` gains a `corrections` block:
the last 12 notes he has written, verbatim, in the **constraint** half of the
prompt rather than as cards competing with 190 others, and read straight off the
thought rows rather than waiting for the nightly consolidator. *"What the
calendar suggests needs to be verified by the location through life360 of the
family"* was written on 31 August and the engine went on asserting calendar-only
family claims for a fortnight. A correction should bind.

## Owner decisions

Answered by "build out all of those proposed changes" plus the standing
"go with your recommendations":

- **D1 scope** — (a) all three waves.
- **D2 new verbs** — (a) all three propose-only until tapped; `watch` additionally
  barred from standing rules.
- **D3 the long look** — (a) John only. (Moot for the year-ago half, which does
  not exist for anyone.)
- **D4 notes** — (b) applies immediately. His note reaches the next cycle's
  profile with no approval step; the existing Calendar tab remains the reversible
  path for exclusions.

## What did not change

The honest substrate, all of it. Citation-or-drop, coverage gates, the Codex
caps, `never_kind` mutes, no auto-activation, no lat/lon in any prompt,
`MIN_PAIRS` before a signal is askable, delivery limits in `deliver.ts`
untouched by any of this. Every new gate is code, not prose.

## How to tell it worked

On the pulses, within a week of deploy:

- `daydream-appetite` says `N proposed → M admitted` with **M > 0**, and
  `daydream_capabilities` has rows.
- `daydream-ponder` summaries show the **lens rotating** through all six, and a
  **merged count below the created count** rather than three times it.
- `musing_patterns` or `musing_general` fires for the first time.
- `openFaults` carries no `lane_silent` row.
- Thoughts appear carrying a `watch`, `draft` or `ask` action.
