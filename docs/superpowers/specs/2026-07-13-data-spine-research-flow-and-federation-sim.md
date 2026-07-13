# Data Spine — research-project flow + federation sim breakout

**Date:** 2026-07-13 · **Project:** `/projects/data-spine` (PRIVATE) · **Status:** in build

Restructure the Data Spine study to read as a standard research project, break the 3D
federation scenarios into their own single-screen simulation, make the per-MIS dots
reflect **real** school counts, add schools × local-authority (and cross-sector) join
scenarios the engine can actually execute, and reconcile the two duplicate estate models
to a single source of truth.

## Decision Log (agreed with John, 2026-07-13)

1. **Site IA** — Full 7-beat reflow with new routes. Problem → Sources → Solutions →
   Recommendation → Outcomes → Governance → Next steps. Add `/sources` + `/next`; rename
   `/value → /outcomes` and `/dfe-model → /model` with 308 redirects.
2. **Federation** — Dedicated single-screen `/federation/sim` (canvas fills viewport,
   controls as HUD overlay, no page scroll). Old `/federation` deck → thin launcher; its
   prose redistributes into the narrative beats.
3. **Joins** — Build the engine extension **and all ~8 hard joins** (schools × LA +
   cross-sector). LA becomes a first-class queryable context space; add a JoinQuery path
   and an honest identity-resolution / match-confidence visual.
4. **Two models** — Reconcile now: the DfE-model deck reads real per-vendor counts + LA
   context from the federation topology (single source of truth).

Decided by default (not forks): dots = 1 per real school vs the 22,067 state census;
independent/EY/bespoke vendors in a separate "indicative" band; drop/relabel dead
Advanced/Progresso; stamp `SOURCE = WhichMIS Oct 2025`; make `SCENARIOS.length` test
derived; template hardcoded share-derived narration counts; resolve the Milburn
~314k-vs-"over a million" contradiction by stating both with their definitions; slicker
point-field + tokenised HUD; fix the majors-cluster placement bug (topology.ts:274).

## Target information architecture

| Beat | Route | Label | Content (reuse-first) |
|---|---|---|---|
| Problem | `/` | The problem | spine.ts QUOTES/STATUS/SPINE_VS_ID/TIMELINE + hidden-NEETs + hero worked-question pulled forward |
| Sources | `/sources` (NEW) | The estate & evidence | MIS market (real counts) + satellite stores NPD/LEO/ILR/LDS + 153 LAs + identifier plumbing; precedents + WorldTour + sources.ts promoted from footer |
| Solutions | `/architecture` | Ways to build it | 4 ARCHETYPES explorer, FLOW_TODAY/SPINE, 5-layer anatomy; links out to the sim |
| Recommendation | `/model` (was `/dfe-model`, 308) | The recommended model | DfE-model deck reframed as THE recommendation ("centralise the trust, not the data") + governance SYNTHESIS thesis; estate re-sourced from topology |
| Outcomes | `/outcomes` (was `/value`, 308) | What it does & who wins | personas + valueLedger + operational shift; **the standalone sim is the interactive centrepiece** |
| Governance | `/governance` | Trust & safeguards | unchanged; + "honest limits" folded in |
| Next steps | `/next` (NEW) | What happens next | consultation/phasing facts, the missing identity-resolution standard, open design decisions from the playbook |
| (sim) | `/federation/sim` (NEW) | The federation, live | single-screen `FederationSim` + HUD; reached from Solutions & Outcomes |

`/federation` (old deck) → thin launcher card to `/federation/sim`; grammar/standards/limits
prose redistributes to Sources/Solutions/Governance.

## Phase A — data + engine (correctness-critical, TDD, keep 48 vitest green)

**A1 · Dots accuracy** (`topology.ts`, `topology.test.ts`, `queries.ts`, scenario prose)
- Add `schools: number` to `SupplierSpec`; set real WhichMIS Oct-2025 counts:
  Arbor 9,677 · ESS SIMS 6,897 · Bromcom 3,493 · ScholarPack ~800 · RM Integris ~650
  (Key-Group residual 1,450, split ESTIMATE) · Pupil Asset/Juniper ~284 · IRIS Ed:gen ~115
  · Compass ~102. State-census total ≈ 22,018.
- Independent/EY/bespoke band (indicative, not census): iSAMS, Famly, Engage, Databridge,
  WCBS HUBmis, Self-hosted — flagged `indicative: true`, excluded from the accuracy total.
- Drop or relabel Advanced/Progresso (EOL Aug 2023).
- `supplierCounts()` allocates from `schools` (1 dot = 1 school; `DEFAULT_SCHOOL_COUNT =
  Σ schools`). `sharePct` becomes a **derived** display value.
- `SOURCE_MIS` provenance constant surfaced in UI; keep the "shares drift quarterly" caveat.
- Template the 5 hardcoded narration counts from `counts` (Arbor/SIMS/ScholarPack/Integris/HUBmis).
- Update `topology.test.ts` (shares-sum, deterministic allocation) to the count basis.

**A2 · LA as a first-class queryable context space** (`topology.ts`, new join engine in `queries.ts`)
- Add an LA estate: 153 LAs clustered by real-ish LA case-management vendors
  (education: Capita ONE, Servelec Synergy, Civica/Impulse; social care: Liquidlogic,
  OLM Mosaic) — shares marked ESTIMATE/illustrative. LA data-holder gateway nodes + an
  LA dot-field (153) parallel to the schools field.
- `PartialResult.providerKind` gains `'la'`. Add an LA-side partial path in `runQuery`.
- New `JoinQuery` variant: fans into the MIS band **and** the LA band, performs an
  identity-resolution step (UPN ↔ LA case-ID) yielding `matchedPct` / `unmatchedCount` /
  `matchConfidence`, then combines to an `AssembledReturn` carrying both-sided partials +
  join metadata. Honest: unmatched records drop out; no clean-join fiction.
- Tests: cover LA partials, join match/unmatch, coverage maths.

**A3 · Scenarios + queries** (`scenarios.ts`, `queries.ts`, `scenarios.test.ts`)
- Make `scenarios.test.ts` count assertion derived first.
- Author ~8 join queries + scripted scenarios in a new group "Joining two worlds":
  1. Attendance × Children's social care (open CIN/CP → persistent absence, by LA) — HARD
  2. Admissions × SEND/EHCP (EHCP over-representation in in-year admissions / fair-access) — HARD
  3. Exclusions × LA alternative provision (perm-excluded → AP within 6wks, duration) — HARD
  4. CME × enrolment (CME register children enrolled elsewhere under a different UPN) — MED (lift cme-count into a real join)
  5. Cross-LA mobility × attainment (boundary-crossing mid-KS → attainment) — HARD
  6. Children-Not-in-School register × prior exclusion/off-rolling — HARD
  7. Attendance × health (unexplained-absence spike ↔ CAMHS/A&E) — HARD (cross-sector, SUI is purpose-limited)
  8. Post-16 destinations × KS4 (FSM KS4 leavers → sustained employment via ILR/LEO) — HARD
  + keep FSM × attainment as the deliberately-EASY single-context baseline contrast.
- Every join scenario visualises the resolution step + a match-confidence badge.

## Phase B — standalone single-screen sim + slicker visuals

- New route `/projects/data-spine/federation/sim/+page.svelte` rendering only `FederationSim`.
- Add a `standalone` prop (distinct from `embed`, which hides the catalogue a playable sim needs).
- `.sim-shell` pinned to `100svh` (measure nav height; drop the magic `-54px`); body overflow:hidden.
- Move the three under-canvas panels (exchange log / query contract / legend) into
  absolutely-positioned collapsible `.hud` overlays (translucent-cream + backdrop-blur),
  reusing the pickerOpen drawer pattern. Keep native Fullscreen as the escape hatch.
- Visuals: size-graded / depth-shaded point field (per-vertex size attr) keeping the
  contiguous per-supplier offset layout; tokenise HUD surface to `--hud-surface`; fix the
  majors-placement comment/code mismatch; render the join resolver + match-confidence.
- Inherit field-study `+layout.svelte` (—ink/—paper aliases + Fraunces). svelte5-pitfalls:
  scene/engine/topo stay plain `let`, only template-read values `$state`.

## Phase C — site IA reflow + reconcile

- Rewrite `SectionNav` SECTIONS to the 7-beat order.
- Renames + 308s: `/value → /outcomes`, `/dfe-model → /model` (old paths `+page.server.ts`
  `redirect(308, …)`); new `/sources`, `/next`.
- Build `/sources` (data estate + evidence base) and `/next` (phasing/standard/open decisions).
- Reframe `/model` as the recommendation; reconcile its 6-MIS %-share estate to read from
  `topology.ts` (real counts, 15 MIS, LA context). Resolve Milburn figure contradiction.
- Redistribute old `/federation` deck prose; `/federation` → launcher.
- Pull hidden-NEETs + hero worked-question forward into Problem.

## Phase D — QA + deploy

- `npx vitest run src/lib/sim/federation` (all green) + `npm run check` + clean build.
- Verify one-screen sim renders (homeserv dev on a port; real-GPU headless bench if needed).
- Deploy `scripts/deploy.sh`; verify live behind private-vis (grep static bundle / share token).
- Commit + push; update memory.

## Verification commands
- Engine: `cd src/lib/sim/federation && npx vitest run` → all pass incl. new join tests.
- Dots: assert `Σ supplierCounts()` == state-census total; per-vendor == real counts.
- Sim one-screen: load `/projects/data-spine/federation/sim`, no page scroll, HUD overlays present.
- IA: each of the 7 nav beats resolves; `/value` + `/dfe-model` 308 to new paths.
- Live: grep the deployed bundle for a new string on each new route.

## Risks / gotchas
- 48 vitest pin the engine — update `SCENARIOS.length` (→ derived), `okReturns.length ===
  SUPPLIERS.length`, topology allocation tests in the SAME change.
- Hardcoded narration counts drift → template them.
- PRIVATE visibility: seed row before deploy; new sub-routes inherit the layout gate; cf-connecting-ip rate limit; verify via bundle grep / share token.
- Field-study-LOCAL `--ink/--paper` aliases — standalone sim route must inherit `+layout.svelte`.
- Headless WebGL = SwiftShader (paper sky renders black) — colour artifact, not a bug.
- Reconciling two estate models is non-trivial — a half-reconciliation leaves them contradicting.
- No lawful shared analytic key across schools/LA/health — the match-confidence step must be honest, not a clean join.
