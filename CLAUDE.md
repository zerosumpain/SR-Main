# SR-Main — agent guidance

SvelteKit personal site at `https://strangeramblings.com`. Start with
`README.md`, `docs/README.md`, and the applicable `AGENTS.md` instructions.
Historical plans and the former version of this file are in the owner Drive
archive linked from `docs/README.md`.

## Development and releases

- Use `npm run dev` for development and `npm run validate:change` for the scoped
  validation entry point. Keep local databases, file volumes and credentials
  separate from production.
- Preserve the cumulative local batch until the user requests a PR or release.
- Production releases use CI. Never run `scripts/deploy.sh` by hand or replace
  production environment files with a local copy. Read
  `docs/deployment-runbook.md`; use `npm run deploy:status` before diagnosing a
  release mismatch.
- When a merge is authorized, wait for successful required checks and merge
  explicitly. Do not use `gh pr merge --auto`.
- PostgreSQL and Drizzle schema declarations remain in Main. Check
  `docs/module-ownership.json` and `scripts/check-extracted-schema.mjs` before
  removing declarations used by another application. Schema changes go through
  the established release process; do not push a local schema to production.

## Application boundaries and permissions

Drive, Health, Policy applications, Workflows and JKAI Core have their own
repositories. Consult SR-Infra's `registry/apps.json` and
`registry/operations.json` for current ownership. Some shared capability code
remains in Main; a local copy does not make Main the runtime owner.

Route access is denied unless explicitly allowed. Use the existing viewer,
permission and scope helpers for each area. Preserve owner/member separation;
a member's data must not enter an owner workflow by a default account lookup.
For Gmail, owner callers use `src/lib/workflows/gmail/owner-accounts.ts`.
Keep refresh-token and scraper-vault encryption keys out of source and logs.
Scraper execution retains its homeserv restriction and isolation checks.

## Models and generated code

All application AI calls use `$lib/llm/client` and its wrappers. Provider
selection belongs in `getLLMClient` and `coerceModelContext`; do not hardcode a
provider on a stored model setting. Check current model and provider capability
helpers when constructing content. Preserve the distinction between model
capabilities and chat's preprocessing capabilities in SR-Jkai-Core.

Codex prices remain `null` when cash cost is unavailable; quota use must not be
represented as a measured zero cost. The bridge's deployment and runtime
contract are documented in `packages/jkai-codex-bridge/README.md`. Use the
existing sidecar release process.

Retain authored-code isolation, static validation, smoke checks and promotion
checks. Historical descriptions of unrestricted `AsyncFunction` execution are
not a current security contract. Read the current execution boundary before
changing dynamic tool behavior.

## Codegraph

`src/lib/codegraph/` holds build-history retrieval and lessons. Retrieval uses
file sets and gate fingerprints before prose fallback. Forgetting is a tombstone
with a required reason; stale paths lower rank and flag a lesson, without
silently deleting it. Keep sentinel checks on sweeps. New helper scripts needed
by production must be included in the release staging process.

## Field studies

Research projects under `/projects/<slug>` are **field studies** and follow the Field Study
System in `field-study-system/`. Do not design these pages ad hoc.

When asked to create or edit a field study:

1. Read `field-study-system/INSTRUCTIONS.md` and follow the procedure.
2. Author content as data in `src/routes/projects/<slug>/study.ts`, validated against
   `field-study-system/content.schema.json`.
3. Every beat declares a `template` from `templates.json` (T0–T8). Render with the
   primitives in `src/lib/fieldstudy/`. Never write a bespoke page layout.
4. Before opening a PR, run `field-study-system/CHECKLIST.md` and paste the result into the
   PR description.

Hard constraints, in priority order over any aesthetic judgement:

- `Confidence = 'fact' | 'hypothesis' | 'contested'` — the shipped type in
  `src/lib/fieldstudy/types.ts`. Do not invent levels or rename these.
- Categorical hues (`#7a5aa6` identifier, `#3a8658` operational/federated, `#b4632e`
  standards, `#8a2d3a` trust/governance) appear only inside a legend and the marks that
  legend labels. Never in chrome, never on a claim. They live in `src/app.css` as
  `--fs-cat-*` and are shared with jkai's chat charts
  (owned by SR-Jkai-Core) — one ramp, not two.

  **`operational` was `#2f7d4f` until 2026-09-05.** Against `standards` it scored OKLab
  ΔE 4.0 under protanopia, against a floor of 6, so the two read as one colour to a
  red-blind viewer. `#3a8658` is the same green to a full-colour eye (0.031 drift in
  OKLCH) and scores 6.2. Re-step it only with the dataviz skill's
  `validate_palette.js`, never by eye, and keep the set at four — a fifth series folds
  into "other" or facets. The pair still sits in the 6–8 band, which is legal only
  alongside a secondary encoding, so a legend or direct labels are mandatory wherever
  these are used.
- Confidence chips use the site palette: petrol `--accent-ink` for fact, orange `--accent`
  for hypothesis, claret `#8a2d3a` for contested.
- Radius `0`, `2px` or `100px` only. No shadows inside a page. No emoji.
- Instruments (T5) are control surfaces: no serif, no drop caps, no margin notes, no page
  scroll, no autoplay when embedded in a beat.

If a beat does not fit a template, that is a signal the beat is two beats. Split it. Do not
add a tenth template without being asked.

**Two deviations from the shipped kit, both deliberate** (see
`2026-08-15-field-study-system.md` in the Drive archive linked from `docs/README.md`): the kit's 8.5–11px label sizes
are mapped onto the site type scale because the 12px floor is gated sitewide; and the kit's
`--fs-body` / `--fs-mono` font-family aliases are dropped in favour of the site's existing
`--font-body` / `--font-mono`, because `--fs-body` already means `1rem` here and
redefining it would invalidate 82 `font-size` declarations. Only `--fs-serif` is new.
