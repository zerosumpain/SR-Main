# The Whitehall Model — England Education Policy Simulation Engine

**Field Study №4** · `/projects/policy-engine` · design spec · 2026-06-06

## 1. What this is

An interactive, research-backed **policy-simulation engine** for the England schools system. A data
professional moves **policy levers** (sliders that mirror real, active and upcoming Department for
Education policies) and watches **outcomes evolve over time** (2010 calibration → 2025 base year →
2040 projection) through real calculations grounded in published evidence.

It is a *system-dynamics + cohort-projection hybrid* with elasticity-based response functions,
distributed lags, Monte-Carlo uncertainty, sensitivity (tornado) analysis, and cost-effectiveness
accounting. Every parameter is sourced or labelled an explicit assumption.

This is a **decision-support / sense-making tool**, not a forecast. Its value is showing *direction,
relative magnitude, interplay, and trade-offs* between policies — not point predictions.

## 2. The policies modelled (the live DfE landscape, mid-2026)

Grouped into seven lever families. Each maps to the legislation / white paper / review it represents.

1. **Early years** — the funded-childcare expansion (15→30 hours, Sept 2025), Best Start in Life,
   early years pupil premium. *Lever: disadvantaged early-education coverage; EY pupil premium £.*
2. **Disadvantage / poverty** — Pupil Premium, Free School Meals auto-enrolment & the Sept-2026
   extension to all Universal-Credit households, universal primary breakfast clubs (Children's
   Wellbeing & Schools Act). *Levers: pupil premium £/pupil; FSM eligibility; breakfast-club coverage;
   child-poverty trajectory (two-child-limit scenario).*
3. **SEND & EHCPs** — 2022 SEND Review → 2023 Improvement Plan → 2025/26 SEND White Paper & EHCP
   reform; the high-needs funding deficit and the DSG statutory override ending March 2026. *Levers:
   inclusive-mainstream investment; early SEND intervention; EHCP-reform intensity; high-needs uplift.*
4. **Workforce** — the 6,500 expert-teachers pledge, teacher pay (STRB), recruitment & retention.
   *Levers: additional teachers/yr; pay competitiveness.*
5. **Standards & accountability** — 2025 Schools White Paper, the Francis Curriculum & Assessment
   Review, Ofsted report cards, RISE regional-improvement teams. *Levers: curriculum/assessment reform
   intensity; RISE intervention intensity.*
6. **Attendance** — the post-pandemic absence crisis, attendance mentors/hubs. *Lever: attendance-
   support coverage.*
7. **Macro funding** — real-terms per-pupil school funding trajectory. *Lever: annual real funding growth.*

Full status table and citations live in `lib/params.ts` (each parameter carries `source` + `confidence`).

## 3. Model architecture

### 3.1 Population & cohort structure
- Pupils are split on the **disadvantage** axis (disadvantaged ≈ FSM-Ever6 vs the rest) — the core
  equity dimension — because almost every policy acts *differentially* on it.
- A **SEND** sub-system (no support / SEN support / EHCP) runs alongside as a stock-flow.
- **Phase cohorts** (early years 0–4, primary 5–10, secondary 11–16, post-16) let an early-years
  investment surface in KS4 results ~11 years later. We track a single representative cohort age
  index so lags are explicit, not hand-waved.

### 3.2 Stocks (state, updated each annual step)
Headline equity: **disadvantage attainment gap (months)** at 16.
Attainment: **Attainment 8**, **% grade 5+ English & Maths**, **KS2 reading+maths expected standard**,
**GLD at age 5** — each with a disadvantaged/all split.
SEND: **EHCP count & % of pupils**, **SEN-support count**, **cumulative high-needs (DSG) deficit £bn**.
System: **persistent-absence rate** (all / disadvantaged / SEND), **teacher shortfall (FTE)**,
**real per-pupil funding £**, **child-poverty rate**, **NEET rate (16–24)**.
Money: **annual programme cost £bn** and **cumulative**.

### 3.3 Response functions (lever → outcome)
Each lever contributes an outcome delta via:
- **Effect size / elasticity** from the evidence base (EEF months-progress, IFS/EPI elasticities,
  DfE dose-response), with a central value and a low/high range.
- **Diminishing returns** — saturating form `f(x)=Emax·(1−e^(−kx))` so doubling spend never doubles
  effect (matches the empirical flattening of pupil-premium / funding returns).
- **Distributed lag** — early years → KS2 (~6y) → KS4 (~11y); most in-school levers 1–3y; pay/
  recruitment 2–4y. Implemented as a geometric lag kernel per lever.
- **Distributional weighting** — disadvantage-targeted levers (PP, FSM, breakfast, EY coverage) load
  onto the *gap*; universal levers (curriculum, funding) lift the *level* with weak gap effect.

### 3.4 Mediation chain (the research-backed causal spine)
```
child poverty ─▶ home-learning environment ─▶ GLD gap (age 5) ─▶ KS2 gap ─▶ KS4 gap (the gap is
   "sticky": ≈40% of the age-16 gap is already present at school entry)
funding / teachers ─▶ provision quality ─▶ attainment            (weak, contested elasticity)
breakfast + attendance mentors ─▶ attendance ─▶ attainment        (strong dose-response)
early SEND intervention + inclusive mainstream ─▶ slows EHCP demand ─▶ shrinks high-needs deficit
attainment ─▶ NEET                                                 (inverse)
```
EHCP-reform intensity is deliberately **double-edged**: narrowing plans cuts the deficit but, without
matching mainstream investment, worsens SEND attainment & raises tribunal/appeal volume — so the model
can show the "cut-the-deficit-but-harm-outcomes" failure mode the sector warns about.

### 3.5 Techniques (the "data science" the brief asks for)
Cohort-component projection · elasticity response functions with diminishing returns · distributed
(geometric) lags · **Monte-Carlo** over parameter uncertainty → P10/P50/P90 fan charts · **sensitivity
/ tornado** ranking levers by KPI impact · scenario comparison · **cost-effectiveness** (£ per month
of gap closed, £ per extra grade-5+ pupil) · uncertainty surfaced as confidence bands, never hidden.

## 4. UI / components
- **Lever rail** — grouped slider accordions; each slider shows its assumed effect size + an evidence
  tooltip (source + confidence). Reset / randomise-within-uncertainty.
- **Outcome charts** — custom SVG line charts (no chart lib, mirroring data-convergence's bespoke
  renderer): gap-in-months, attainment, SEND/deficit, absence, workforce, NEET — disadvantaged vs all,
  with P10–P90 bands when Monte-Carlo is on. A vertical "today" (2025) marker separates history from
  projection.
- **Scorecard** — 2030 & 2040 outcomes vs the status-quo baseline (Δ, colour-coded good/bad).
- **Cost panel** — annual & cumulative £bn; cost-effectiveness per KPI.
- **Sensitivity tab** — tornado chart for a chosen KPI.
- **Scenario bar** — save/duplicate/compare; presets: *Status Quo*, *Full Reform Package*, *Austerity*,
  *Early-Years First*, *SEND Rescue*, *Standards Drive*.
- **Methodology & sources** — every parameter, value, source, confidence; model assumptions; explicit
  limitations.
- Persistence: localStorage scenario store + JSON import/export + PNG export (same pattern as Field
  Study №1).

## 5. Module layout (mirrors data-convergence isolation rule — never imported outside this route)
```
lib/types.ts      domain types (levers, outcomes, scenario, model result)
lib/params.ts     CALIBRATED parameters: baselines, effect sizes, lags, sources, confidence
lib/levers.ts     lever definitions (id, group, range, default, unit, evidence note)
lib/engine.ts     the simulator: step loop, response functions, lags, mediation, cost
lib/montecarlo.ts Monte-Carlo + sensitivity/tornado
lib/scenarios.ts  preset scenarios + scenario store + localStorage + import/export
lib/format.ts     number/label formatting
components/        LeverRail, OutcomeChart, Scorecard, CostPanel, Sensitivity, ScenarioBar,
                  Methodology, Tooltip
+page.svelte      composition + Svelte-5 reactive recompute on lever change
```

## 6. Honesty & limitations (stated in-product)
Single representative cohort (not full age structure); England only; effect sizes transported from
heterogeneous studies; many 2025/26 reforms have **no evaluation yet** so their effects are priors with
wide bands; deadweight/displacement only partially modelled; not a fiscal scorecard. The tool's claim is
**plausible relative dynamics under transparent assumptions**, not prediction.
