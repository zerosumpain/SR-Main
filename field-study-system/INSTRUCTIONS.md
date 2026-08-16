# Build procedure

The loop. Do not skip a step; each one gates the next.

## 0 · Refuse to start without findings

Before any page exists, write the three findings the study will state in its
front matter, each with a confidence level and at least one source. If you
cannot write them, the research is not finished — say so and stop. A study whose
conclusions are discovered during layout will read as a tour of the author's
notes.

## 1 · Draft the beat plan

Seven beats, always in this order, always numbered:

| # | Beat | Question it answers |
| --- | --- | --- |
| 01 | The problem | What is being claimed, and by whom? |
| 02 | The estate & evidence | What exists today, and how do we know? |
| 03 | Ways to build it | What are the options, and who has tried them? |
| 04 | The recommendation | Which one, and why that one? |
| 05 | What it does & who wins | Who is better off, who is worse off? |
| 06 | Trust & safeguards | What could go wrong, and what stops it? |
| 07 | What happens next | What would change the picture, and when? |

You may merge two beats. You may not reorder them or add an eighth. Rename them
to the study's subject freely — the questions are what is fixed.

For each beat write, in one line each: the question, the claim that answers it,
the claim's confidence, the "so what", and the open question with its falsifier.
This is the whole study in about 40 lines. Get it reviewed before building.

## 2 · Assign a template per beat

Pick from the beat's **verb**:

- declaring → **T0 Front matter**
- reasoning → **T1 Argument**
- accounting → **T2 Survey**
- recommending → **T3 Position**
- weighing → **T4 Ledger**
- operating → **T5 Instrument**
- decomposing → **T6 Anatomy**
- narrating time → **T7 Chronicle**
- judging cases → **T8 Precedent**

Two verbs apply → it is two beats. T6, T7 and T8 are section-scale: they
normally sit inside a T1 or T2 beat rather than owning one.

Rhythm: T0 once, at the front. Never two of the same template consecutively
except T1. A study that is all T2 is a database; all T1 is an essay.

## 3 · Author content as data

Write `study.ts` against `content.schema.json`. Every claim gets a
`confidence`. Every number gets a `source` and a `asOf` date. Estimated values
get `basis: 'estimate'` and are excluded from totals.

Validate before rendering. A schema failure is a content failure — fix the
content, do not loosen the schema.

## 4 · Render

Compose the primitives in `src/lib/fieldstudy/` per the markup contract in
`TEMPLATES.md`. Fill every required slot; omit optional slots rather than
padding them. Never write a bespoke page layout for a beat.

## 5 · Artefacts

Any chart, lever or interaction must come from `ARTEFACTS.md`. Before adding
one, answer: what should the reader be able to *do* after seeing this?

- Understand a quantity → it is a chart, and it needs no levers.
- Test whether the claim survives its own assumptions → it is an instrument,
  and it needs levers, a baseline and a stated limit.
- Neither → cut it. An artefact that only demonstrates capability is the most
  expensive kind of filler.

## 6 · Gate

Run `CHECKLIST.md`. Every line passes or the study does not ship.

## Editing an existing study

Identify the beat, identify its template, change content in `study.ts`. If the
change needs markup, it needs a template change — and a template change applies
to every study, so raise it rather than forking the layout locally.
