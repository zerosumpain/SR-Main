# Policy Incentives Lab

Private Strange Ramblings workspace at `/policy-incentives-lab`. This is an exploratory model builder, not a stakeholder prediction system. Use only public or synthetic material.

## Run

Use the site's existing `npm run dev` command and configured PostgreSQL database. The existing release applies the additive tables in `src/lib/db/schema.ts` through Drizzle. An already provisioned local database can apply `scripts/migrations/2026-09-09-policy-incentives-lab.sql`; no new database or container is required.

The cumulative isolated preview is served by `/home/john/docker/local/compose.jkai.yaml` at `http://127.0.0.1:5275/policy-incentives-lab`. It uses local-only credentials and volumes. The lab requires an incoming Auth.js owner session, including in development. The LAN proxy no longer injects a session for lab pages/APIs. A plain LAN visit is deliberately denied without a session. Google OAuth callback availability in a particular preview is separate from the application's owner check.

Optional environment settings:

- `POLICY_LAB_ENABLED=0`: disable the lab. Default enabled behind owner authentication.
- `POLICY_LAB_MODEL`: existing gateway model ID. Unset means deterministic mock, supporting only the clearly labelled Lantern fixture. Existing provider credentials remain in the existing environment configuration.

## Workflow

Create an analysis, load the synthetic example or add a source, and propose or manually enter a model. Read original source quotations beside each item. Amend actors, strategies, metrics, rules and assumptions through the structured item editor; the full model editor supports adding/removing items. Unknown numerical values remain null and block simulation. Editors enforce the canonical Zod schema and show validation errors.

Select reviewed items explicitly and approve them. The runner lists every missing approval/reference/value. Save an immutable approved version, select a simulation type, set a seed and configure parameter overrides inside approved ranges. Run and export JSON or Markdown from Audit. You may leave and resume after any saved operation. An unsaved editor buffer is not persisted; use Save before leaving.

Changing any model or evidence content clears all draft approvals conservatively. Existing versions and runs are immutable. A new source clears the draft model. Run explanations create a new annotated record referencing the original run and retain the original deterministic result hash.

Baseline, optimistic, adverse and custom are labels, not hidden numerical presets. Choose approved parameter values explicitly. No default implies a beneficial direction across conflicting actor objectives.

## Shared infrastructure

SvelteKit/Node; Auth.js owner allow-list; PostgreSQL/Drizzle; shared file store; `$lib/llm/client`; Zod; existing PDF.js/Mammoth extraction; shared seeded RNG; D3 `NetworkGraph`; Vega `ChartArtifact` and theme; SR shell and CSS tokens; Vitest and Playwright. No new dependency tree, service or public navigation entry.

## Checks

```sh
npx vitest run tests/lib/policy-incentives-lab
PUBLIC_VAPID_PUBLIC_KEY=ci-gate-placeholder npm run gate:check
# Explicit isolated existing preview only:
POLICY_LAB_LOCAL_TESTS=1 PLAYWRIGHT_EXTERNAL_SERVER=1 npx playwright test tests/e2e/policy-incentives-lab.spec.ts
```

The end-to-end test uses the existing preview's synthetic Auth.js identity and PostgreSQL database, checks anonymous/guest denial, creates labelled synthetic rows, seals a model, replays a run, exports a report, checks snapshot immutability and renders desktop/mobile graphs and charts. It never invokes a real model. It leaves labelled examples in the cumulative local database for review. Never point it at production.

The whole repository has additional checks and integration dependencies; the lab tests do not replace them. See `architecture.md`, `modelling-method.md`, `governance-and-limitations.md` and `threat-model.md`.

## Validation record — 2026-09-09

The full Vitest run passed 10,402 tests, with 71 existing skips, using a fresh disposable database in the existing local PostgreSQL service, UTC and a local test encryption key. The final focused lab/navigation/selector regression run passed 68 tests. Two Playwright checks passed over the LAN gateway, with external browser requests blocked: real database/API replay and export, and the complete synthetic workflow through the interface. Anonymous, guest, encoded-path and gateway session-cookie acquisition attempts were checked. The gateway does not forward synthetic session cookies to browsers.

Type-checking passed with no errors; the existing site warnings remain. Production build/client budgets, public-route inventory, module boundaries, font sizes, source footprint, schema import/drift checks and Compose validation passed. The lab source/test footprint allowance was extended within the existing gate to cover the approved module. Live-provider quality was not exercised. The synthetic fixture and sample JSON/Markdown reports require no live model.

## Policy examples and first look

The home page searches the live GOV.UK library and loads selected publication content as described below. The earlier four metadata examples remain available only as legacy query-prefill data; they no longer define library coverage.

Saving a source automatically produces a separate, unreviewed first-look dashboard: possible groups, response avenues, consequences, safeguards and questions. `FIRST_LOOK_RUBRIC` and `FIRST_LOOK_VERSION` in `first-look.ts` are the executable skill contract, described in `data/skills/policy-incentives-lab/SKILL.md`. The small pass uses the existing provider with a bounded output and timeout, validates exact quotation/location links and retries once. With no provider, or invalid model output, a labelled basic keyword scan supplies source mentions and review questions. It never represents the scan as a full AI analysis. This pass cannot approve a model or calculate results. Refreshing it leaves existing draft approvals unchanged; changing the source clears the candidate model as before.

First-look reports can be exported to Markdown/JSON before any model or run exists. Reports retain source hash, method, rubric version and timestamp; model attempts remain in the extraction audit. Full run exports also include the first look saved with their model snapshot. Existing projects without a first look can generate one with Refresh first look. This uses the existing draft JSON payload and needs no schema migration.

Each workflow section explains its purpose, gives an ordinary-language example and describes the next step. Item editing uses named references and explained decision rules. The guided starter collects two groups and two choices in everyday words, labels the outline as reviewer assumptions, and leaves every numerical value unknown. Scenario and range controls use forms rather than requiring JSON. Advanced JSON editing remains available for larger structures.

## Live policy library, illustrative setup and replay

The library now queries GOV.UK's entire paginated policy-paper index, with wider
consultation/guidance/regulation filters. Its scope is indexed GOV.UK material,
not a definitive register of every UK policy currently in force. Search and
content import require a network connection; the synthetic fixture and tests do
not. Publication metadata, links, retrieval time, selected attachment and full
extracted text are saved in the existing private project JSON. No real policy
text is checked into this repository. A publication with multiple attachments
exposes a document selector; only that document is loaded, never a landing-page
summary standing in for the attachment. Unsupported/scanned/oversized documents
remain visible with an explanation and manual-upload route. Limits remain 5 MiB,
200 PDF pages and 250,000 text characters; imports are never silently truncated.

In **Try a scenario**, **Preview automatic fixes** offers an optional illustrative
setup. The existing gateway can propose missing qualitative structure; without
it a clearly hypothetical two-group starter is available. Seeded deterministic
code samples missing numbers, supplies missing choices/payoff rows/decision rules
and selects a scenario. Existing numerical values remain. Integer bounds sample
uniform integers; other bounds sample continuously. These distributions express
no real-world probabilities. The preview shows changes, every assumption and the
full item list. Explicit user acceptance records per-item approvals and seals an
immutable snapshot, ready for the separate Run action. Unrepairable evidence or
schema errors, stale previews and missing acceptance remain hard blocks. The
setup version, seed, bounds, changes and acceptance identity/time travel with
saved snapshots and exports. Engine behaviour/version is unchanged.

Results now include saved-state replay: round controls and optional playback,
actor choices and payoffs, the existing network graph, a Vega choice timeline,
metric values and an accessible table. Reduced-motion users have manual controls.
Normal-form/sequential terminal profiles are alternatives, never animated as a
sequence of events. No equilibrium/unsupported results remain explicitly empty.

Sources for the integration contract:
- https://docs.publishing.service.gov.uk/repos/search-api/using-the-search-api.html
- https://content-api.publishing.service.gov.uk/reference.html

No additional dependency, service, migration, provider setting or setup command.
