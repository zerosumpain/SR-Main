# The Field Study System

A design system for research-paper projects on Strange Ramblings — the shape of
the argument, the page templates that carry it, and the artefact library the
templates draw from.

Built for **zerosumpain/SR-Main** (SvelteKit 2 + Svelte 5 + Tailwind v4). It
extends the site's warm-brutalist language rather than replacing it: same palette,
same grain, same square corners, same 0.2s ease-out. What it adds is a reading
serif, a fixed seven-beat arc, claim/evidence structure, and citation apparatus.

## Contents

| File | What it is |
| --- | --- |
| `CLAUDE.md` | Drop this at the repo root (or merge into an existing one). It is the standing instruction. |
| `INSTRUCTIONS.md` | The build procedure — the loop Claude follows to produce a study. |
| `TEMPLATES.md` | The nine page templates: slots in order, markup contract, prohibitions. |
| `ARTEFACTS.md` | Charts, levers and interactions — what is allowed inside a page. |
| `templates.json` | The same registry, machine-readable. Validate against this. |
| `content.schema.json` | JSON Schema for a study's content. Content is authored as data, not markup. |
| `example/data-spine.study.json` | A real study expressed in the schema. |
| `css/field-study.css` | Tokens and primitives. Append to `src/app.css`. |
| `components/` | Svelte 5 primitives every template composes from. |
| `CHECKLIST.md` | The gate. A study does not ship until every line passes. |

## The idea

Content and layout are separated. A study is authored as **data** conforming to
`content.schema.json`; each beat names a **template**; the template decides the
markup. That is what makes the design automatable — Claude is choosing a template
and filling slots, not inventing a layout per page.

## Install

1. Append `css/field-study.css` to `src/app.css`.
2. Copy `components/` to `src/lib/fieldstudy/`.
3. Copy `CLAUDE.md` content into the repo's root `CLAUDE.md`.
4. Author `src/routes/projects/<slug>/study.ts` against the schema.
5. Run the procedure in `INSTRUCTIONS.md`.

## The rules that do not bend

- Findings are stated in the front matter, before beat 01.
- One question per beat, printed at the top of the beat.
- Every claim carries a confidence chip: `fact` | `hypothesis` | `contested`.
- Every beat closes with an open question and a falsifier.
- Every instrument states what it does not show.
- No emoji. Square corners. Palette does not grow.
