# The Engine Room — structural redesign

**Date:** 2026-08-06
**Supersedes the presentation layer of:** `2026-08-05-engine-room-field-study.md` (content model unchanged)

## The brief

> "the functionality is good but the look and feel/user experience needs to be much more
> storytelling with features, and less narrative. I want interactive visuals, charts, etc and
> less death by text. also the structure of the site needs work; think about grouping, less
> content per page and more pages."

## Diagnosis

Measured before touching anything — rendered words per live page:

| Page | Words |
|---|---|
| guardrails | 2,478 |
| models | 2,105 |
| memory | 2,047 |
| tools | 1,954 |
| building | 1,926 |
| chat | 1,614 |
| automation | 1,585 |
| research | 1,581 |
| shipping | 1,362 |
| trace | 1,330 |
| index | 1,320 |
| **total** | **~19,300** |

That is a 75-minute read. Eleven interactives across ten sections; **shipping and guardrails
had none at all**. For comparison, the Policy Engine — the page the brief cites as the target
— carries 47 components and renders almost no server-side prose.

Three structural causes:

1. **`StoryMasthead` spent ~120 words before the reader saw anything** — a 60-word thesis plus
   a three-item "what this section answers" list, on every page.
2. **`.ds-card` grids were prose in a box** — a heading plus a 40–70 word paragraph, 6–14 per page.
3. **The instrument came after the essay.** The reader had to earn the interactive part.

## The change

- **Four parts, sixteen leaves.** `turn` (5) · `memory` (4) · `reach` (3) · `change` (4), each
  part a hub that is a *menu, not a chapter*. Twenty-one routes where there were eleven.
- **Instrument-first.** Every visual sits in a shared `Instrument` frame: label → controls →
  visual → at most one sentence of payoff. The caption goes *under* the instrument; above it,
  people read instead of touch.
- **A budget.** Leaf pages cap at 350 rendered words, enforced by a checker in CI-adjacent
  scripts and by an adversarial review pass per page.
- **A chart vocabulary.** Eight shared primitives (`Bars`, `StackBar`, `Funnel`, `Gauge`,
  `Scatter`, `Steps`, `Treemap`, `Stat`) so sixteen pages come out consistent rather than
  sixteen bespoke essays.
- **Two-level navigation.** The chrome now shows which part you are in and only the pages
  inside it.

**No content claims changed.** Every figure still comes from the typed constants in `lib/*.ts`;
the redesign compresses wording, never facts.

## Decision Log

| Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| Scope | Trim the ten pages / regroup into parts / start again | **Regroup into four parts** | The brief names structure explicitly ("grouping, less content per page, more pages"). Trimming alone would not fix navigation. | Yes — content constants untouched |
| Page count | 10 → 12 / 10 → 21 | **21** | "More pages" plus a 350-word cap forces one idea per page. | Yes |
| Grouping axis | By subsystem / by lifecycle / by question | **By question the reader has** (what happens when you type → what it knows → what it can touch → how it rebuilds itself) | Subsystem grouping is the org chart of the code, not a story. | Yes |
| Consistency device | House style guide / shared wrapper component | **`Instrument` wrapper** | A guide is advisory; a component is enforced. Sixteen parallel authors needed the latter. | Yes |
| Charts | Add a charting library / hand-rolled SVG primitives | **Hand-rolled, dependency-free** | Precedent: Policy Engine hand-rolls all 47. The study also argues for choosing the simpler tool, so importing a library to draw eight bar charts would undercut it. | Yes |
| Old URLs | Break them / 18 redirect files / `hooks.server.ts` / dynamic `[legacy]` route | **`[legacy]` dynamic route** | Two files instead of eighteen, and static routes still win the match, so `/turn` and friends never reach it. Unknown slugs 404 honestly. | Yes |
| Part identity | Numbering only / colour per part | **Colour per part**, from existing tokens (petrol, burnt orange, green, crimson) | Grouping has to be visible in the chrome, and all four were already in the study's palette. | Yes |
| Hub pages | Nav-only grouping / hubs with content | **Hubs as menus** — strap line, four stat tiles, page list | A hub that explains things recreates the problem one level up. | Yes |
| Facts | Let page authors re-source / freeze the constants | **Frozen** — authors may reshape, never add a figure | Sixteen parallel authors inventing numbers is the obvious failure mode of a fan-out. | n/a |
| Ask dock | Leave citations pointing at old URLs / remap | **Remapped all 48** | Citations would have worked via the redirect but landed readers on a redirect hop. | Yes |

## Verification

1. `npm run gate` to exit 0 (svelte-check, vitest, build).
2. Word-count check on every rendered leaf ≤ 350.
3. All 21 routes 200 anonymously; all 9 legacy URLs 308 to the right target.
4. Secret scan over the *served* HTML, not the source.
5. Ask dock returns a cited answer live.
