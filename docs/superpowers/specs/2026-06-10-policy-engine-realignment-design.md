# Policy Engine Realignment — Briefing + Field Studies

**Date:** 2026-06-10
**Status:** Approved (bundle: "Full realignment"; structure: Briefing + Field Studies; triage simulator: real published multipliers with uncertainty bands)
**Scope:** `/projects/policy-engine` in `strange_rambling_svelte`

## Goal

Convert the policy engine from a linear simulator narrative into a **strategic intelligence toolset** that supports decisions on how DfE uses data effectively to monitor education outcomes. Four workstreams:

- **A. Narrative realignment** — Outcomes becomes "The Briefing" (high-level DfE policy overview); every other page becomes an explicitly-themed Field Study with a standard masthead.
- **B. UI** — story and interaction co-visible instead of fighting; finish half-wired features.
- **C. NEET model deepening** — segment the NEET stock, wire in the evidenced feeder pipeline, add live-policy levers, add NEET economics.
- **D. NEET intelligence story** — rebuild `/neet` around risk tooling, data estate, stakeholders, ML opportunities, governance; add a sitewide measurement layer.

Each phase deploys independently (per CLAUDE.md: deploy after UI changes, verify live).

## Non-goals

- No backend/DB — the engine stays self-contained ES-module data, bespoke SVG charts, no chart library.
- No real personal data anywhere; the triage simulator is a synthetic-cohort model calibrated to *published* aggregate multipliers.
- No redesign of the SR design system; reuse existing `pe-*` patterns and tokens.

---

## Phase A — Narrative realignment

### A1. Information architecture

New conceptual grouping (routes unchanged except labels/framing):

- **The Briefing** — `/outcomes`, retitled. High-level state-of-the-system readout across the five outcome themes (equity, attainment, SEND, system health, money). This is the "DfE policy overview" anchor.
- **Field Studies** — each a self-contained themed story:
  - `/regions` — *The geography of inequality* (rich/poor divide is THIS page's theme, not the site's)
  - `/population` — *The human scale* (percentages as real children; economic return)
  - `/global` — *England against the world*
  - `/monitor` — *The data spine* (how would we know if policy worked?)
  - `/neet` — *The early-warning system* (rebuilt in Phase D)
- **Method** — unchanged role (reference), absorbs new Phase C/D documentation.

### A2. `StoryMasthead` component

New component rendered at the top of every Field Study page. Fields (per-page constants in a new `lib/stories.ts`):

- `kicker` — "Field Study" + number
- `theme` — one-line theme name
- `question` — the driving question
- `thesis` — 1–2 sentence answer the page argues
- `dataAsk` — **"What data would we need to monitor this?"** — 1–3 bullets tying the story to the data-strategy goal (this is the thread that unifies the site with John's strategic objective)

Both narrative modes (research/ELI5) supported.

### A3. Navigation

`SectionNav.svelte` FLOW regrouped: Overview · **Briefing** · then a visually-grouped "Field Studies" cluster (Population, Regions, Global, Monitor, NEET) · divider · Method. Tab labels updated; mobile overflow handled (horizontal scroll already exists).

### A4. Route-mode fix

`isDataRoute` in `+layout.svelte` (L21): remove `neet` — the drawer must NOT auto-open on `/neet` (field study, not a scenario page). The NEET page keeps its single live engine-fed projection chart but framed as "the engine's view", with a link to open the drawer deliberately.

---

## Phase B — UI improvements

### B1. Co-visible storytelling layout (the big one)

On The Briefing: replace the prose-block-then-charts stacking with a **two-column co-visible pattern** per theme section: prose column (~38ch–46ch) alongside the charts column; charts stick (`position: sticky`) within their section while the prose scrolls past on desktop ≥1100px. Below 1100px: fall back to current stacked flow. Implementation: a `StorySection.svelte` wrapper (slots: `prose`, `data`) so Field Studies can adopt the same pattern incrementally. Kill the `columns: 23em` multi-column prose CSS where it conflicts.

### B2. Drawer peek mode

Replace the binary 46px-spine/348px-drawer with three states: closed spine → **peek (~120px)** → full (348px). Peek shows: scenario name, count of changed levers, and a compact list of changed-lever chips (name + delta); clicking a chip opens full drawer focused on that lever. State in `appState` (`drawerMode: 'closed'|'peek'|'full'`), persisted in localStorage. Mobile overlay behaviour unchanged.

### B3. Scenario state clarity

- Model "preset + modifications": track `basePreset` in appState; `scenarioDisplayName` becomes e.g. "Balanced +2 changes" instead of "Custom scenario". Reset-to-preset affordance.
- **Compare difference dashboard**: when `compareB` is set, show a compact diff strip (gap, A8, NEET, cost at horizon: "B vs A: gap −0.4mo, cost +£2.1bn") above the charts, replacing legend-only signalling.

### B4. Finish half-wired features

- `focusLever()`: implement scroll-to + flash in `LeverRail.svelte` (highlightLever already exists at appState L36); wire chart hint chips to call it.
- Monte Carlo: one-line explainer tooltip on the uncertainty toggle ("110-draw Monte Carlo over effect-size bands; fan = P10–P90").
- ELI5 coverage: fill gaps on `/global` and `/neet` (new NEET page written with both modes from the start).
- Export/import: brief inline hint + example of the JSON shape; visible success state on import.

### B5. Performance & mobile

- Chart jitter on drawer toggle: debounce the ResizeObserver callback in `OutcomeChart.svelte` (~80ms trailing) + CSS `transition` on the grid so the reflow is one settled re-render.
- Mobile sticky stack: collapse scene-bar controls behind a single "⚙ Scenario" disclosure under 700px to keep the sticky header ≤ 2 rows.

---

## Phase C — NEET model deepening (engine)

### C1. Three-segment NEET stock

Replace the single `neet` scalar in `engine.ts` (L291–300) with three components summing to the headline rate (baselines from ONS Jan–Mar 2026 / DfE 2025 brief, England-calibrated):

- `neetUnemployed` (~39% of stock): cyclical; responsive to labour-demand/Youth Guarantee/jobs-guarantee levers and attainment.
- `neetInactiveHealth` (~28% and rising): sticky (8-in-10 still NEET 2+ yrs later — Milburn); driven by youth ill-health drift; responsive to `mental_health`/`camhs`, weakly to careers/skills levers.
- `neetInactiveOther` (~33%): caring/discouraged; slow-moving; responsive to poverty and post-16 offer levers at low elasticity.

Headline `neet = sum`; YearResult gains the three components. The existing drift/mitigation logic moves into the health segment. Charts: Briefing NEET chart gains a stacked-composition variant; NEET page shows segment trajectories.

### C2. Feeder pipeline

New derived "pipeline pressure" term feeding segment inflows from upstream model state, calibrated to DfE *Risk factors for becoming NEET* (May 2026) + NatCen/YFF multipliers (encoded as Bands in `params.ts` with sources):

- persistent absence → 3.9× NEET risk (6.3× persistent NEET)
- EHCP → ~⅓ NEET at 17–19, ~⅔ ever-NEET at 20–24
- below-L2 attainment → ~2×; FSM → ~2×; care experience → 40% vs 13%
- compounding: FSM+SEND+low-quals ≈ 2.8× average

Mechanically: a `neetPipeline(yearState)` function converts modelled absence/attainment/SEND/poverty levels into an inflow multiplier per segment, replacing the bare `neetPerA8` elasticity (which is retained as a floor and documented as superseded). Confidence: flagged "medium (admin-data associations, not causal)".

### C3. New levers (4)

| id | group | what | effect channel | confidence |
|---|---|---|---|---|
| `youth_guarantee` | Post-16, Skills & Wellbeing | Youth Guarantee / Jobs Guarantee rollout intensity (£820m + 18–24 expansion) | reduces `neetUnemployed` (keyworker ≈ +1.8pp re-engagement evidence; Youth Contract) | low–medium |
| `careers_gatsby` | Post-16, Skills & Wellbeing | share of schools achieving all 8 Gatsby benchmarks | reduces inflow to all segments (−8% NEET likelihood, −20% disadvantaged schools) | low (correlational) |
| `apprenticeships` | Post-16, Skills & Wellbeing | 16–24 apprenticeship-start recovery (levy reform, SME full funding from Apr 2026) | reduces `neetUnemployed` + small attainment-adjacent effect; YFF "high impact / low evidence security" | low |
| `post16_premium` | Disadvantage & Poverty | 16–19 student premium (EPI proposal; disadvantage funding currently stops at 16) | reduces post-16 dropout → inflow to unemployed/other segments | low–medium |

Each gets full LEVER_META, ELI5 name, Band effect sizes, cost, source URL, model note, Method-page card. `post16_skills` is re-scoped (blurb/evidence) to avoid double-counting with the new levers; its NEET max effect is reduced accordingly and noted.

### C4. NEET economics

- Per-person scarring: lifetime earnings loss up to £300k (Milburn; flagged upper-bound) and the York/Audit Commission ~£56k public-finance / ~£104k resource cost (2010 prices) as the conservative anchor.
- CostPanel gains **cost per NEET-year avoided** alongside existing value metrics; Population page econ grid gains a NEET line (headcount avoided at horizon × scarring band).
- Milburn £125bn/yr aggregate quoted in prose only, explicitly as a contested upper bound.

### C5. Method page

New equations entry (3-segment stock-flow + pipeline), updated causal-flow diagram (pipeline arrows into NEET segments), per-lever cards for the 4 new levers, sources appended to `sources.ts` (ONS May 2026 bulletin, DfE risk-factors May 2026, Milburn interim, RF False Starts / Lost in Transition, YFF toolkit, Gatsby/CEC, IFS spending, Commons Library CBP-10827).

---

## Phase D — NEET intelligence story + measurement layer

### D1. `/neet` rebuilt as Field Study: "The early-warning system"

Six acts (research + ELI5 throughout):

1. **The headline** — 1m NEETs (13.5%), composition flip to inactivity, segment chart fed live by the Phase C engine.
2. **The risk-tooling ladder** — RONI (checklist, nationalised Jan 2025) → NERI (NatCen weighted index) → ML (Bristol's ATRS-published model, Essex dashboard). The load-bearing fact: **no deployed English NEET model has published precision/recall.** Failure gallery as design constraints: Ofqual 2020, DfE's own ABIE suspension, DWP UC advances model.
3. **The triage simulator** (D2).
4. **The data estate** (D3).
5. **The stakeholders** (D4).
6. **The opportunity ladder + governance** (D5).

Existing good content (LA spread, international comparators, Estonia funnel, ethics guardrails) is retained and redistributed into these acts. `lib/neet.ts` is extended, not replaced.

### D2. Triage simulator (centrepiece interactive)

A synthetic-cohort risk model, **calibrated to published multipliers, with uncertainty bands and prominent caveats** (John's call).

- **Cohort construction** (`lib/triage.ts`): synthetic Year-11 cohort (~600k) with joint prevalence of risk markers (persistent absence 17.8% autumn-24/25, EHCP ~5%, SEN support, FSM ~25%, care experience, below-L2 prior attainment), overlap structure approximated from published cross-tabs (Impetus compound-disadvantage, DfE risk-factors). Each stratum gets a NEET probability from the published relative risks against the ~13% base rate, each carried as a Band {low, central, high}.
- **The interaction**: one primary slider — "flag the top X% of the cohort" (X = 1–40). Live readouts: **recall** (% of future NEETs caught), **precision** (% of flagged who become NEET), **false positives per true positive**, **caseload** (headcount flagged, per-LA average). All with P10–P90 bands from sampling the multiplier Bands (reuse the Monte Carlo pattern, ~200 draws, memoised).
- **Secondary toggle**: "checklist (unweighted RONI)" vs "weighted index (NERI-style)" — two ROC-ish operating curves showing the value of weighting, qualitatively consistent with the published claim that weighting + earlier signals beats points-scoring.
- **Caveats panel** (always visible, not collapsed): synthetic cohort; published *associational* multipliers, not causal; overlap structure approximated; real systems face data-quality and lag problems the simulator ignores; risk ≠ responsiveness (link to uplift modelling act).
- Charts: bespoke SVG consistent with OutcomeChart idiom (a recall-vs-flag-rate curve with band fan + a 100-dot waffle showing flagged/missed/false-positive at the chosen threshold).

### D3. Data estate map

Interactive SVG linkage diagram (`lib/dataestate.ts` + `DataEstateMap.svelte`): nodes = school census/NPD, daily attendance feed, NCCIS/CCIS, ILR, LEO (HMRC/DWP), destinations, ECHILD (NHS), Data First (MoJ), GUiE, UCAS. Each node triaged **proven / underused / missing-link**, click → side card (what it is, latency, access route, the strategic gap). Drawn-in literal gaps: the **age-18 dark zone** (tracking duty dropped 2016) and the missing **post-16 real-time signal** (no FE equivalent of the daily feed). Headline annotation: "LEO could validate any risk index against real 5-year outcomes — nobody has published that."

### D4. Stakeholder map

Ownership grid (`StakeholderMap.svelte`): rows = life stage (pre-16 / 16–18 / 18–24), columns = function (tracking, funding, delivery, careers, health, evidence); cells = owner (DfE, DWP, LA, MCA, CEC, colleges, NHS, YFF). The five documented coordination failures rendered as annotated fault lines (tracking cliff at 18; data-sharing guidance omitting Jobcentres/ICBs; not-known rates; SEND transitions; no single owner of the 16–24 outcome).

### D5. ML opportunity ladder + governance

Ranked ladder (table + prose) of the eight opportunity shapes from validated-weighted-index (cheap, half-done) up to **uplift modelling** (the frontier: target by treatment effect, enabled by YFF RCTs + LEO), each with: what it is, what data it needs (cross-linked to D3 nodes), evidence status, and governance price (DPIA, ATRS record, ICO human-in-the-loop, subgroup error reporting, LGA challenger-team pattern). Distilled design rules from the failure cases.

### D6. Measurement layer (sitewide)

Every Briefing chart gets a small **"How we'd monitor this"** affordance (icon → popover, reusing the modal/portal pattern): data source(s), update latency, known gaps, one-line "what better looks like". Content in a new `lib/measurement.ts` keyed by chart id. This is the converting move from simulator to data-strategy instrument; Field Study mastheads' `dataAsk` (A2) link into the same content.

---

## Architecture notes

- **New lib modules**: `stories.ts`, `triage.ts`, `dataestate.ts`, `measurement.ts`; extensions to `neet.ts`, `params.ts`, `levers.ts`, `engine.ts`, `types.ts`, `sources.ts`, `economics.ts`.
- **New components**: `StoryMasthead`, `StorySection`, `TriageSimulator`, `DataEstateMap`, `StakeholderMap`, `MeasurementPopover`, `CompareDiffStrip`.
- **Engine compatibility**: YearResult gains `neetUnemployed/neetInactiveHealth/neetInactiveOther`; headline `neet` retained so all existing charts/scorecard/sensitivity keep working before being upgraded.
- **No new dependencies.** All charts bespoke SVG; all data baked-in constants with sources.
- **Testing**: engine changes get vitest coverage (segment sum = headline; pipeline monotonicity; lever direction sanity; triage recall/precision identities — recall↑ and precision↓ as flag-rate↑; conservation of cohort counts). `npm run check` with `NODE_OPTIONS=--max-old-space-size=8192`; build/deploy outside sandbox.

## Sequencing & deploys

1. **Phase A** (realignment + mastheads + nav + route-mode fix) → deploy.
2. **Phase B** (co-visible layout, peek drawer, scenario clarity, half-wired finishes, perf/mobile) → deploy.
3. **Phase C** (engine: segments, pipeline, levers, economics, Method docs + tests) → deploy.
4. **Phase D** (NEET rebuild, triage simulator, estate/stakeholder maps, opportunity ladder, measurement layer) → deploy.

Each deploy verified live on strangeramblings.com before proceeding.

## Sources (key, full list goes to `sources.ts`)

ONS NEET bulletin May 2026; DfE NEET annual brief 2025; DfE *Risk factors for becoming NEET* (19 May 2026); Milburn *Young people and work* interim (May 2026); Resolution Foundation *False Starts* (Oct 2025) & *Lost in Transition* (Apr 2026); EPI *Five charts*; Impetus *Youth Jobs Gap*; YFF Youth Employment Toolkit + IFF/NatCen RONI research (Apr 2026); Gatsby/CEC benchmark analyses; Madia et al. 2022 (exclusions); IFS education spending 2025–26; Commons Library CBP-10827 (Youth Guarantee); DfE *Identifying and supporting young people at risk of NEET* (Jan 2025); Bristol CC NEET model ATRS record; Ada Lovelace *Critical Analytics?*; ECHILD/ADR UK/Data First/GUiE/LEO documentation; ATRS hub + ICO AI guidance; LGA predictive-analytics guidance.
