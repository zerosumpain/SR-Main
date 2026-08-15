# The Field Study System — install, apply, and weave into Studio

**Date:** 2026-08-15
**Branch:** `feature/field-study-system`
**Source:** `field study design system.zip` (uploaded to /drive, 2026-08-15 15:27 UTC)
**Grade:** Full autonomy

## What arrived

A complete, opinionated kit for research-paper projects: nine page templates (T0–T8), a
fixed seven-beat arc, a JSON Schema for study content, nine Svelte primitives, a CSS layer,
a build procedure, a ship checklist, a machine-readable template registry, and a
`CLAUDE.md` standing instruction. It extends the site's warm-brutalist language — same
palette, grain, square corners, 0.2s ease-out — and adds a reading serif (Fraunces),
claim/evidence structure, and citation apparatus.

Its own summary of what does not bend:

- Findings stated in the front matter, before beat 01.
- One question per beat, printed at the top of the beat.
- Every claim carries `fact` | `hypothesis` | `contested`.
- Every beat closes with an open question and a falsifier.
- Every instrument states what it does not show.
- No emoji. Square corners. The palette does not grow.

## The brief

1. Apply it to the four built studies: **Data Spine, Policy Engine, Engine Room, SCS Pay**.
2. Weave the templates into the **Studio** build sidecar, so automatically-built
   information projects are produced against them.

## Decision Log

### D1 — Depth of application to the four existing studies

The kit's ideal is content-as-data: author `study.ts` against `content.schema.json`, every
beat naming a template, primitives doing the markup. The four studies are 18,500 lines of
bespoke, researched, working pages (data-spine 12 routes, policy-engine ~20, engine-room
~8, SCS Pay a separate Vite bundle).

- **Options:** (a) re-author all four into `study.ts` against the schema; (b) install the
  system and bring the studies onto its primitives, tokens and invariants, leaving the
  researched content where it is; (c) apply to one study only as a reference.
- **Chosen: (b),** with (a) reserved for new studies via Studio.
- **Why:** re-authoring is not a design task, it is a content migration of months of
  research, and the risk is losing sourced prose to a schema round-trip. The kit's own
  "Editing an existing study" section says to change content in place and raise template
  changes rather than fork layouts — it does not ask for a rewrite. What the studies
  actually need from the system is the part they visibly lack: **one confidence scale, one
  set of registers, one beat close.** Today there are three different `ConfidenceBadge`
  components with three different palettes, two of which use categorical hues the kit
  explicitly forbids on a claim.
- **Reversible:** yes — the primitives are installed, so any study can be migrated fully
  later, one beat at a time.

### D2 — The kit's type sizes against the 12px accessibility floor

`css/field-study.css` sets labels at 8.5–11px. `src/app.css` documents 12px as a hard
floor, enforced by `scripts/check-font-sizes.mjs`, whose scope now covers app.css and most
of the site (widened in the Instrument sweep, PR #281).

- **Options:** (a) ship the kit's sizes and exempt the file; (b) map its sub-floor sizes to
  the floor; (c) keep field-study.css outside the gate's scope.
- **Chosen: (b).** Same call as the Instrument bundle (twice now): the floor is a shipped,
  gated accessibility commitment, and a design bundle is not the place to quietly reverse
  one. Labels keep the kit's mono/uppercase/tracking treatment at 12px.
- **Reversible:** yes, and this is the single most likely thing to want overturning — it is
  one token change plus a scope line.

### D3 — SCS Pay is not a SvelteKit route

`/projects/scs-earnings` is a standalone Vite+TS bundle in its own repo (`~/scs-earnings/`),
deployed by rsync via `bundle-deploy`, not by CI.

- **Chosen:** apply the kit's **tokens and confidence palette** there in its own repo and
  deploy with `bundle-deploy`; do not import Svelte primitives into a non-Svelte bundle.
- **Why:** the system's portable half is the visual language; the Svelte half cannot cross
  that boundary. Logged so the asymmetry is deliberate rather than an omission.

### D4 — Where the kit lives in the repo

- `src/lib/fieldstudy/` — the nine Svelte primitives (as the kit's install step says).
- `field-study-system/` at the repo root — docs, `templates.json`, `content.schema.json`,
  the checklist. Machine-readable registry lives with its prose.
- `css/field-study.css` — appended into `src/app.css`. A standalone CSS file imported from
  a route breaks the PWA build (`reference_svelte_pwa_css_import`), so global is the only
  safe home.
- The Fraunces `@import` merges into app.css's existing font import: CSS `@import` must
  precede all other rules, so it cannot be appended at the end.

### D5 — How Studio consumes the templates

Studio plans "chapters" with its own `Form` taxonomy (open/question/walk/compare/annotate/
ledger/close) and `Control` taxonomy. That is a second, parallel design vocabulary to the
kit's T0–T8.

- **Options:** (a) replace Form with the templates outright; (b) add a `Template` column
  alongside Form; (c) leave Studio alone and document the kit as advisory.
- **Chosen: (a) for information projects.** The brief is explicit — the templates are to be
  woven in "for when automatically building information projects". Two competing
  vocabularies is exactly the drift the kit exists to end. `Form` becomes the template id.
- **Mechanism:** the kit is mounted into the Studio workspace beside the explainer kit
  (`static/explainer-kit/field-study/*`, listed in `EXPLAINER_FILES`), so it rides the
  existing `syncExplainerKit` path and the existing `design-lint` mount allowance. The
  chapter-plan table's headings are byte-identical between the proposer prompt and
  `buildRevisionInstruction` and pinned by a mirror test — both sides change together.
- **Reversible:** yes; the prompt strings and one column.

### D6 — Scope of the Studio gate change

`scripts/studio-gate.mjs` drives a real browser and its findings feed the next iteration
without ever aborting. Adding field-study invariants there is the cheapest place to make
the templates real rather than advisory.

- **Chosen:** extend the gate with the checkable subset — a confidence chip on every claim,
  a beat close carrying an open question and a falsifier, no emoji, radii 0/2/100. Leave
  the judgement calls (is the risk column honest?) to the human checklist.

## Verification

- `npm run gate` in the worktree (public-routes, font-sizes, check, test, build).
- The four studies screenshotted at 1440 and 390 before and after; zero page-level
  horizontal overflow, zero JS errors.
- A mirror test pinning the chapter-plan headings across the two prompt strings.
- Unit tests for the template registry and the gate's new assertions.
- After merge: CI deploys, verify live. SCS Pay separately via `bundle-deploy`.
