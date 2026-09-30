# SR-Main — guidance for coding agents

Read by the autonomous builder (`/jkai/develop`, change requests) on every repo
build, and by any agent that honours `AGENTS.md`. Short on purpose: each rule
here is one a real build broke. `CLAUDE.md` has the wider picture.

## How to work

- **Copy a precedent; do not invent one.** For almost anything you need, two
  working examples of the same shape already exist — same route family, same
  component type, same kind of endpoint. Find them first (the codegraph query
  `siblings:<path> | nodes limit=5` names them) and match their file layout,
  naming, helpers and error handling. A new library, helper framework or
  pattern needs a reason you can state in one sentence.
- **Name the files you will touch before editing**, and the check that will
  prove the change works. If the list surprises you, the design is wrong.
- **Find the root cause before fixing.** Known misreadings in this codebase:
  health values 100× off are storage scaling or SUM-vs-MAX aggregation, not
  display code; a Svelte page that locks up or never hydrates is an effect
  reading what it just wrote; a build that fails with no code change is a stale
  `.svelte-kit/output`.
- **Never weaken or delete an existing test to go green**, and never edit gate
  scripts, build configuration or `package.json` scripts. Adding a test is
  welcome. A change that modifies an existing test is classified high risk and
  waits for the owner.

## What the site expects

- **Svelte 5 runes only** — `$props`, `$state`, `$derived`, `$effect`,
  `onclick`, snippets. No `export let`, `on:click`, `$:` or `<slot>`. The
  `svelte5-pitfalls` skill has the traps.
- **Design system, not taste.** Tokens in `src/app.css` and
  `src/lib/styles/nm-tokens.css`; fonts are Archivo Black (display), DM Sans
  (body), JetBrains Mono (labels), DM Mono (brand mark), and `/jkai` pages use
  Segoe UI for body on purpose. No raw hex colours, no new fonts, nothing under
  12px. New pages wear their family's shell and the one navigation bar — the
  `sr-design` skill says which.
- **Access is denied unless allowed.** A new public route must be listed in
  `.github/public-routes.txt` (`node scripts/check-public-routes.mjs` checks
  it). Use the existing viewer, permission and scope helpers; never widen
  access to make a page render.
- **All model calls go through `$lib/llm/client`.** No provider SDK imports and
  no hard-coded model ids; model choice belongs to the workload registry.
- **Field studies** (`/projects/<slug>` research pages) follow
  `field-study-system/INSTRUCTIONS.md`: content as data in `study.ts`, every
  beat on a template. Never a bespoke layout.
- **Module layers:** `foundation < platform < domain < ui < routes`. A module
  imports its own layer or below, never above, and no route imports another
  route. `scripts/check-module-boundaries.mjs` enforces it.

## Data and release

- **`src/lib/db/schema.ts` is protected.** A change there makes the pull request
  high risk (the owner merges it). A NEW table also needs a grant to the
  runtime role, `sr_main_runtime`, recorded as a conditional SQL file under
  `scripts/migrations/` — without it production returns `permission denied`
  the moment the table is read. Prefer a design that uses existing tables.
- **Protected paths** are listed in `.github/protected-paths.txt`. Anything
  there waits for a person; say so in your summary when you touch one.
- **Tests:** unit tests sit beside the code as `*.test.ts`. Tests that need a
  real database are named `*.integration.test.ts` and are not in the merge gate;
  a plain test that reaches a database must skip — never throw — when the
  database is not the disposable test one.
- **Never push, open a pull request, merge or deploy from a build.** Releases go
  through CI after the owner or the release lane opens the pull request.
