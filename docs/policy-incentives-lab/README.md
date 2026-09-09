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

Type-checking passed with no errors; the existing site warnings remain. Production build/client budgets, public-route inventory, module boundaries, font sizes, source footprint, schema import/drift checks and Compose validation passed. The release uses the existing source/test footprint budgets on current master without changing them. Live-provider quality was not exercised. The synthetic fixture and sample JSON/Markdown reports require no live model.
