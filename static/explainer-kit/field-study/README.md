# The Field Study System — studio mount

You are building an **information project**: a research study, not a marketing
page. This directory is the system it must be built against. Read `TEMPLATES.md`
before you write a chapter, and run `CHECKLIST.md` before you call it finished.

## What is here

| File | What it is |
| --- | --- |
| `TEMPLATES.md` | The nine templates (T0–T8). Slots in render order, and the prohibitions. |
| `templates.json` | The same registry, machine-readable. Your chapter plan names ids from it. |
| `field-study.css` | The classes the templates are made of, written against the kit's `--ex-*` tokens. |
| `CHECKLIST.md` | The ship gate. The studio gate checks the mechanical half of this automatically. |

## Load it

```html
<link rel="stylesheet" href="./explainer-kit/tokens.css">
<link rel="stylesheet" href="./explainer-kit/shell.css">
<link rel="stylesheet" href="./explainer-kit/field-study/field-study.css">
```

Fraunces is already loaded by `tokens.css`. Do not add a second font import.

## The shape of the argument

Seven beats, fixed order, always numbered. You may merge two. You may not
reorder them or add an eighth. Rename them to the subject freely — the
questions are what is fixed.

| # | Beat | Question it answers |
| --- | --- | --- |
| 01 | The problem | What is being claimed, and by whom? |
| 02 | The estate & evidence | What exists today, and how do we know? |
| 03 | Ways to build it | What are the options, and who has tried them? |
| 04 | The recommendation | Which one, and why that one? |
| 05 | What it does & who wins | Who is better off, who is worse off? |
| 06 | Trust & safeguards | What could go wrong, and what stops it? |
| 07 | What happens next | What would change the picture, and when? |

## What every beat carries

- One **question**, printed at the top of the beat.
- One **claim** that answers it, carrying a confidence chip:
  `fact` | `hypothesis` | `contested`. No other values.
- A **so what** in the author's voice.
- An **open question** and a **falsifier** — the thing that would change the
  author's mind.

The front matter states the study's three findings before beat 01. A study that
withholds its conclusions to build suspense is a tour of the author's notes.

## Two rules that are checked mechanically

- Confidence chips use the site palette — petrol for fact, the flag colour for
  hypothesis, claret for contested. The categorical hues (`--fs-cat-*`) appear
  ONLY inside a legend and the marks that legend labels. Never on a claim.
- Radius `0`, `2px` or `100px`. No shadows inside a page. No emoji anywhere.

## Instruments

A `T5` instrument is a control surface, not an editorial page: no serif, no drop
caps, no margin notes, no pull quotes, no page scroll, no autoplay when embedded
in a beat. Five levers maximum, each showing its baseline, positions in the URL.
It always states what it does not show and where its numbers came from — put
that in a `.fs-limits`.
