# The Data Spine — Federation simulator (`/projects/data-spine/federation`)

**Date:** 2026-07-10 · **Grade:** Full autonomous · **Author:** Claude (kick-off: John, verbatim brief below)

> Add a series of visual, graphic-heavy simulations of how a federated model (like the Estonian
> model) could work, interactive, using three.js, highlighting the interactions of a
> distributed/federated analytic model. Scenarios: DfE analytic requests, node-to-node requests,
> value to/from MIS providers, local government, children's social care, broader collections.
> Topology: ~3 major MIS suppliers + 10–15 smaller ones, connected to all UK schools.
> Synthetic data, as many scenarios as describable. Creative freedom, feature rich. Autonomous.

## What gets built

A fifth section of the existing Data Spine field study: **Federation** — a live, orbitable
Three.js model of an X-Road-style federated education data exchange, with a scenario engine
that plays scripted data-flow simulations over the network while an audit-ledger event log,
query-contract card, and live counters narrate what the architecture is doing and why it
matters. It extends the study's archetype 3 ("Federated exchange") from prose into a
running model.

## Topology (synthetic, deterministic)

- **24,000 providers** — one instanced point each, clustered by MIS supplier (blob size ∝ market share) on the ground plane.
- **15 MIS supplier gateways** — 3 majors (~84% share) + 12 smaller, **fictional names** mirroring the real market's shape (one legacy incumbent, cloud-native challengers, long tail).
- **Exchange ring** — the federation protocol layer (X-Road security-server analogue) as a rotating ring of relay nodes; every member connects to it, nobody sits above it.
- **Consumers** — DfE, 153 local authorities (cluster), children's social care, TRE/researchers, Ofsted, the learner-held Education Record, plus an **audit ledger** obelisk that ticks on every exchange (Estonia's citizen-visible log).
- Seeded RNG → identical layout every visit.

## Scenario catalogue (13, grouped)

| Group | Scenarios |
|---|---|
| Collections & statistics | census-free collection · new collection onboarding · TRE research query (small-cell suppression) |
| Frontline operations | child moves school (CME) · daily attendance early-warning · social-care check · multi-agency safeguarding enquiry |
| The vendor economy | supplier benchmarking value-back · admissions-day surge |
| Trust & failure modes | rogue bulk query refused · breach blast-radius (federated vs central) · major-supplier outage · family opt-out propagation |

Each scenario: title, plain-English framing, step script (pulses, highlights, fan-outs,
log entries, counters), a **query contract** card (fields, legal basis, aggregation,
retention), and the lesson it argues. Color language: petrol = query/contract,
burnt orange = data moving, green = verification/aggregate ok, red = refusal/breach.

## Architecture-mode toggle

Federated ↔ Central store. Central mode morphs the topology (a central database cylinder
appears, ring fades, nightly bulk-upload ambient animation) and the comparison panel shows
per-scenario counterfactual stats (records moved, blast radius). Scenarios animate fully in
federated mode; central mode is a visual + statistical counterfactual, not a second full
script per scenario.

## Files

**Create** (all under `src/routes/projects/data-spine/federation/`):
- `+page.svelte` — masthead, sim, how-to-read, scenario catalogue, honest-limits, next-row
- `lib/topology.ts` — synthetic network + deterministic layout (typed arrays for 24k points)
- `lib/scenarios.ts` — the 13 scenario scripts + contracts
- `lib/engine.ts` — plain-TS playback engine (play/pause/speed/step, ambient traffic, event emitter)
- `lib/scene.ts` — plain-TS Three.js scene (instanced points, pulse pool, CSS2D labels, OrbitControls, picking, mode morph, dispose)
- `lib/topology.test.ts`, `lib/engine.test.ts` — vitest over the pure-TS core
- `components/FederationSim.svelte` — canvas mount + HUD (scenario picker, transport, event log, contract card, counters, inspector, legend)

**Modify:**
- `components/SectionNav.svelte` — add Federation tab (Briefing · Value · Architecture · **Federation** · Governance)
- `architecture/+page.svelte` — next-row → federation; federation next-row → governance

## Non-goals

- No server code, no DB, no API routes — fully client-side synthetic simulation.
- No changes to `/projects` index (sub-route of an existing project).
- No real vendor names on the model (the architecture page already names the real market in prose).

## Verification

1. `npm run check` + `npm run test` (topology/engine tests) clean.
2. Local prod-build + headless Chromium screenshot of `/projects/data-spine/federation` showing the rendered network + HUD.
3. Deploy; `.deploy-sha` matches HEAD; page fetch via share-token (project is private on prod) or VPS-side authed check contains `federation` chunk + a unique marker string.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Where it lives | new top-level `/projects/<slug>` vs sub-route of data-spine | **`/projects/data-spine/federation`** | Brief says "on the data spine project"; the study already has sub-sections + nav; inherits visibility guard + share tokens | Yes — route move is mechanical |
| 2 | Three.js binding | Threlte vs raw Three.js in external TS modules | **Raw Three.js, scene/engine in plain `.ts`** | Known Threlte+Svelte5 pitfalls (nested `$state` arrays in useTask); 24k instanced points + custom pulse pool is imperative anyway; Svelte layer stays UI-only | Yes |
| 3 | Supplier names | real (Arbor/SIMS/Bromcom) vs fictional | **Fictional, market-shaped** | Study's careful non-official stance; "synthetic data" in the brief; prose pages already cite the real market with sources | Yes — data file edit |
| 4 | Central counterfactual | full second script per scenario vs topology morph + stats | **Morph + per-scenario stats** | Full dual scripts double authoring for marginal insight; the counters carry the argument | Yes — additive later |
| 5 | ELI5 toggle in sim narration | dual-register scripts vs single plain register | **Single plain register** (page prose keeps the toggle) | 13 scenarios × dual scripts is heavy; sim narration is already written plain | Yes — additive later |
| 6 | School count | real ~24.4k vs round 24,000 | **24,000** ("one point per provider") | Matches the study's own "24,000+ providers" copy; honest as synthetic | Trivial |
| 7 | Labels | sprite textures vs CSS2DRenderer | **CSS2D** | Crisp JetBrains Mono labels matching the study's typography; DOM count is small (~25 labels) | Yes |
| 8 | Mobile | full 24k vs reduced field | **Full 24k field everywhere; `reduced` flag caps DPR + fanout sample sizes instead** | 24k `THREE.Points` is GPU-trivial; the cost is DPR and per-frame work, not point count | Yes |

### Post-review decisions (8-angle code-review pass, all findings applied)

| # | Fork | Chosen | Why |
|---|---|---|---|
| 9 | fanout `direction` field (scripted but never rendered) | **Deleted from the contract** | Dead parameter across the whole chain; honouring it visually added nothing the heat+ring effect doesn't already say |
| 10 | Per-scenario counter reset | **Moved to the `scenario-start` event** (was only in `run()`) | Restart/replay paths were stacking counters — breaking the "exactly one record moved" rhetoric |
| 11 | Pulse travel time | **Engine divides `durMs` by speed** | 2×/3× controls sped narration but not pulses; stale pulses outlived their beat |
| 12 | Node-id literals (`central-store`, `ledger`, `con-dfe`) | **Exported `CENTRAL_ID`/`LEDGER_ID`/`DFE_ID` constants + ambient pool fields** | A rename would have silently killed ambient traffic / frozen central mode |
| 13 | MAJORS/SMALLS lists in scenarios | **Derived from `SUPPLIERS` tiers** | A 16th supplier can no longer be silently skipped by every fan-out |
| 14 | Legend/log colours | **Tokenized (`var(--accent-ink)`, `var(--accent)`)** where site tokens exist | CLAUDE.md design-system discipline; scene.ts hexes exempt (WebGL can't read CSS vars) |
