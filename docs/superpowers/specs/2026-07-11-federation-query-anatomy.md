# Federation simulator — query anatomy, ask-the-federation, opt-outs, real names, edtech ring, standards

**Date:** 2026-07-11 · **Grade:** Full autonomous (zero contact until final report) · **Page:** `/projects/data-spine/federation` (PRIVATE study)

## Brief (verbatim intent)

1. Explore simulated data requests down to the query itself, the component parts at response level, and what is provided back to DfE.
2. Simulate central government asking questions of the federation and receiving the response.
3. Demonstrate providers opting out of a query, within guardrails of what is mandated and what isn't.
4. Realistic MIS supplier names (Bromcom, Arbor, SIMS…).
5. Edtech providers on the federation ring as smaller toggleable tendrils, sharing intelligence through federation.
6. A section describing the standards required to make this happen.
7. *(mid-run addition)* The learner-held Education Record connects **through DfE**, not directly to the ring.
8. *(mid-run addition)* DfE's existing smaller databases — LEO, ILR, LDS, NPD — appear in the model.

## Design

All plain-TS core, DOM/Three-free, deterministic — matching the existing engine/topology/scenarios pattern. No LLM calls; answers are synthesised deterministically (mulberry32), same as `schoolInfo`.

- **`lib/topology.ts`** — replace the 15 fictional suppliers with the real English MIS market (indicative shares): Arbor, ESS SIMS, Bromcom (majors ≈83%), ScholarPack, RM Integris, Juniper Horizons, IRIS Ed:gen (mid), Compass, Advanced Cloud School, iSAMS, Engage, WCBS HUBmis, Schoolbase, Satchel? no — Furlong Schoolbase, + self-hosted long tail. New node kinds: `edtech` (tendrils off the ring) and `store` (NPD/LEO/ILR/LDS satellites orbiting below DfE, edge kind `satellite`). `con-record` member edge retargets to `con-dfe`; `routePath` learns to chain a member→member edge (record traffic passes through DfE's gateway).
- **`lib/queries.ts`** *(new)* — the query anatomy model. `FedQuery`: id, question, requester, basis (`statutory | voluntary`), statute/instrument, SQL-ish `queryBody`, fields, aggregation, edtech signal flags. `runQuery(topo, query, optOuts)` → per-supplier `PartialResult` (status `answered | opted-out | must-answer`, rows with deterministic values, suppressed-cell counts) + `AssembledReturn` (headline numbers, coverage %, partial flag). Guardrail: statutory basis **overrides** opt-outs (`must-answer`); voluntary honours them (`opted-out`, coverage drops). `buildQueryScenario()` converts a run into an engine `Scenario` so the 3-D scene plays it.
- **`lib/scenarios.ts`** — rename node refs to the real supplier ids; recompute narration school-counts from new shares; add an edtech-intelligence scenario ("The pattern only the tendrils can see"). Scripted query-shaped scenarios get `queryId` links so the drill-down explorer works for them too.
- **`lib/engine.ts`** — ambient pool gains optional edtech members (setter), so the ring "breathes" with tendril traffic when toggled on.
- **`lib/scene.ts`** — render tendrils (small cones on outward stalks, own label class) inside a toggleable group `setEdtech(on)`; render satellite stores (small cylinders + connecting edges under DfE); both pickable for the inspector.
- **`components/AskFederation.svelte`** *(new)* — "Ask the federation": question picker (catalogue of ~8, statutory + voluntary mix), requester chip, participation panel (per-supplier opt-out toggles with the mandated-guardrail rendered as disabled/overridden state), run button driving the sim, live assembled-answer card after the run.
- **`components/QueryExplorer.svelte`** *(new)* — the drill-down: THE QUERY (signed contract + query body) → THE PARTIALS (per-supplier response components, suppression, opt-outs visible) → THE RETURN (what actually lands at DfE). Rendered for the composer and for query-shaped scripted scenarios.
- **`components/FederationSim.svelte`** — HUD: edtech ring toggle; inspector cases for `edtech`/`store`; export `runFedQuery`.
- **`+page.svelte`** — new slides: "Ask the federation" (composer + explorer) and "The standards stack" (identify / describe / move / prove / protect / adopt — what exists vs what's missing); copy updates (real-names disclaimer replaces "names are fictional"; grammar rows for tendrils + satellites; stats).

## Verification plan

`npx vitest run src/routes/projects/data-spine/federation` (topology/scenario/engine/queries suites) → `npm run check` (heap flag) → build (no sandbox) → headless screenshot of the page locally → deploy.sh → live verification on strangeramblings.com (auth'd screenshot/curl of the deployed JS bundle containing e.g. "Bromcom").

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Q&A mechanism | (a) deterministic synthetic catalogue, (b) free-text LLM over the RAG chat | **a** | matches the sim's offline deterministic core + testable; LLM lives elsewhere on the study (RAG chat) | yes — composer could later add an LLM mode |
| 2 | Real names vs the page's "names are fictional" stance | keep fiction / rename | **rename** (explicit brief) | John's instruction overrides; add "shares indicative, behaviours illustrative" disclaimer since failure scenarios now name real firms | yes — one file |
| 3 | Market shares | precise sourced figures / indicative approximations | **indicative** (Arbor ~44, SIMS ~26, Bromcom ~13…) labelled as such | private study page; shape matters, decimals don't; publicly tracked figures move quarterly | yes |
| 4 | "LDS" expansion | ask / omit / best-guess | **model as the learner-records (ULN/PLR) family**, labelled LDS | no canonical DfE "LDS"; NPD/LEO/ILR unambiguous; flag in final report for correction | yes — label+desc |
| 5 | Opt-out UI placement | separate page section / inside AskFederation panel | **inside AskFederation** | opt-outs only mean something against a live query; guardrail teaching moment happens at run time | yes |
| 6 | Feature 1 scope | drill-down for every scenario / only query-shaped ones | **query-shaped only** (census, research, attendance, benchmark, + composer) | record-level scenarios (child moves, s.47) have no aggregate anatomy; forcing it would fake data | yes |
| 7 | Execution style | subagent-driven / inline single-head | **inline** | files are tightly coupled (topology ids ripple through scenarios/scene/tests); one head avoids cross-agent drift | n/a |
| 8 | Edtech names | real (Wonde, CPOMS, Sparx…) / fictional | **real**, category-labelled | consistent with brief item 4's spirit; tendrils are aspirational capability, phrased as "imagine" | yes |
