# Design — Milburn *Young People and Work* deep integration (policy-engine)

**Date:** 2026-06-11
**Route:** `src/routes/projects/policy-engine` (Field Study №6 — NEET, plus cross-cutting themes/memo)
**Status:** Awaiting user review of this spec.

---

## 1. Context & intent

The user asked to "update / reinforce all of the strands in the policy-engine focussed sections, themes, etc" with the **outputs of the Milburn review / *Young People and Work* report** as they flow through, calling out "what they suggest, expect, or need to change."

### What the research established (decisions locked with the user)

1. **One report, not two.** The "Milburn report" and "Young People and Work" report are the *same* document: Alan Milburn's DWP-commissioned review, whose **interim report** (gov.uk, published 28 May 2026, updated 8 June 2026) is titled *"Young People and Work: interim report."* No separate "Young People and Work" report exists. The current `sources.ts` line that conflates them will be **corrected**, not duplicated.
2. **It is a diagnosis, not a prescription.** Nine chapters; Chapter 9 is *"The fork in the road."* It explicitly **defers recommendations** to a later "solutions" phase (autumn 2026). So we integrate it as **diagnosis + neutrally-attributed *directional asks***, never as recommendations it has not made.
3. **Approach (user-chosen):** integrate the full diagnosis as prose + evidence; build a new honestly-labelled **"directions & asks" layer** paired with the **recommending companions already in the corpus** (Resolution Foundation, Youth Guarantee, YFF, Gatsby, EPI, IES); make the package **simulatable**.
4. **Surfacing (user-chosen):** NEET page + reinforce the existing themes + memo, **and add a 5th cross-cutting theme** — *"Participation by design"* (Milburn's "a system in name, not in design").
5. **New lever (user-chosen):** add a **demand-side `entry_level` lever** (employer entry-level + work-experience access), wired into the NEET engine — the one engine-touching change, faithful to Milburn's central diagnosis that the youth labour market itself collapsed.

### The honesty principle (non-negotiable, matches the engine's ethos)

- Milburn content is tagged **`status: 'diagnosis'`** with a `provenance` note; it is **never** rendered as a recommendation. Formal recommendations are flagged as **due autumn 2026**.
- The simulatable package is labelled *"a defensible response the diagnosis points toward — not the review's recommendations,"* carrying the engine's wide-uncertainty caveat (the youth levers, including `entry_level`, are **low confidence**).
- Every Milburn finding enters `evidence.ts` as a **neutral claim** ("X finds Y"), `lean: 'official'`; the genuine activation-vs-health tension enters `contradictions.ts`.

### Source facts (all from the gov.uk interim report + corroborating searches; cite verbatim where used)

- Nearly **1 million** 16–24 NEET (~1 in 8); without action **→ 1 in 6 (~1.25m) within five years**.
- **~£125bn** estimated annual cost ("more than we spend on education each year").
- In 2024/25, **£1 on youth employment support : ~£25 on benefits**.
- **6 in 10** NEETs today have never had a job (up from **4 in 10 in 2005**); **84%** want a job or training.
- Health-related NEET reasons **+70%** over a decade; mental health the primary condition for **>4 in 10** disabled NEETs; of those entering health-related inactivity 2017–19, **~8 in 10 still NEET 2+ years later**.
- By 2025 **only Romania** had a higher youth NEET rate in Europe; up to **£300k** lifetime earnings loss per young NEET.
- Nine chapters; five interlocking system failures: **the youth economy** (entry-level roles vanishing; recruitment "more remote, more automated, less human"), **health** ("configured for treatment, not participation"), **education & skills** ("the faltering foundation"), **welfare** ("not designed for participation"), **the architecture** ("a system in name, not in design").

---

## 2. Architecture overview

The policy-engine is a data-driven knowledge graph: `sources` → `evidence` (neutral analyses) → `themes` → `levers` → `stories`/`*Intel` prose → `outcomes` → `contradictions`, wired by query functions (`…ForLever/Theme/Outcome`). This change adds **one new node type** (`directions`), **one new theme**, **one new lever**, and threads Milburn through the existing nodes — re-using every existing pattern. No framework changes.

```
NEW: directions.ts  ──┐
evidence.ts (+3) ─────┤
contradictions.ts(+1)─┼─▶ themes.ts (+1 theme "participation-by-design"; reinforce 3 existing)
levers.ts (+entry_level)┤       │
params.ts (coeffs+cost)─┤       ▼
engine.ts (NEET terms)──┤   /neet (new "fork in the road" act) · /memo · /build preset
scenarios.ts (preset)───┘       │
sources.ts (correct line)       ▼
neet.ts (diagnosis data) ──▶ corpusIndex.json (regenerate)
```

---

## 3. File-by-file design

### 3.1 `lib/sources.ts` — correct the conflated line

Replace the single Milburn line (currently `Milburn review (DWP) … 'Young People and Work' interim report …` with a FE News URL) with an accurate entry:

```ts
{ org: 'Milburn review (DWP)', what: '"Young People and Work" — interim DIAGNOSTIC report (28 May 2026); 9 chapters on why ~1m young people are NEET. Recommendations deferred to the "solutions" phase, autumn 2026.', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
```

(The FE News framing URL is retained only inside the `mental_health` lever's `source`, where it already lives.)

### 3.2 `lib/directions.ts` — NEW FILE (the "what should change" layer)

Parallel to `evidence.ts`. Reuses `Lean` from `evidence.ts`.

```ts
import type { Lean } from './evidence';
import type { LeverState } from './types';
import { LEVERS_BY_ID } from './levers';

export type DirKind = 'diagnosis-direction' | 'recommendation';
export type DirStatus = 'diagnosis' | 'recommended' | 'announced';

export interface Direction {
  id: string;
  report: string;            // short, e.g. 'Milburn review'
  reportFull?: string;
  kind: DirKind;             // Milburn asks = 'diagnosis-direction'; companions = 'recommendation'
  status: DirStatus;         // 'diagnosis' (Milburn) | 'recommended' | 'announced'/funded
  lean: Lean;
  title: string;             // the ask, one line
  whatChanges: { research: string; eli5: string };
  expectedEffect: { research: string; eli5: string };
  provenance: string;        // honesty note (e.g. diagnosis vs recommendation)
  levers: string[];          // lever ids this ask maps to
  leverTargets?: Partial<Record<string, number>>; // for the simulatable package (absolute lever values)
  themes?: string[];
  outcomes?: string[];
  companions?: string[];     // evidence.ts analysis ids that RECOMMEND the same direction
  strength: 'strong' | 'moderate' | 'contested' | 'illustrative';
  url?: string;
}

export const DIRECTIONS: Direction[] = [ /* … */ ];
export const DIRECTIONS_BY_ID: Record<string, Direction> = Object.fromEntries(DIRECTIONS.map(d => [d.id, d]));

export function directionsForLever(id: string): Direction[] { /* filter */ }
export function directionsForTheme(id: string): Direction[] { /* filter */ }
export function directionsForOutcome(id: string): Direction[] { /* filter */ }

/** Compose the Milburn-aligned "response package" lever state from the diagnosis-directions'
 *  leverTargets (single source of truth shared with the scenarios.ts preset). */
export function milburnPackageLevers(base: LeverState): LeverState { /* apply leverTargets onto base, clamp */ }
```

**The five Milburn diagnosis-directions** (`kind: 'diagnosis-direction'`, `status: 'diagnosis'`, `lean: 'official'`), each anchored to one system failure and paired with companions:

| id | system failure | maps to levers (targets) | companions (evidence ids) |
|---|---|---|---|
| `milburn-youth-economy` | the youth economy: entry-level roles vanished | `entry_level`↑, `apprenticeships`↑ | `onward-course-correction`, `suttontrust-apprentice`, `ifs-growth-skills` |
| `milburn-health-participation` | health "configured for treatment, not participation" | `mental_health`↑, `camhs`↑ | `resolution-neet`, `resolution-neet-europe` |
| `milburn-skills-foundation` | education/skills "faltering foundation" | `post16_skills`↑, `post16_premium`↑, `careers_gatsby`↑ | `epi-neet`, `smf-skills`, `cep-vocational` |
| `milburn-welfare-participation` | welfare "not designed for participation" | `youth_guarantee`↑ | the **announced Youth Guarantee** itself, represented as a separate `kind: 'recommendation'`, `status: 'announced'` Direction (`youth-guarantee-policy`) rather than an `evidence.ts` id — the IES Youth Contract evidence stays in the `youth_guarantee` lever source |
| `milburn-architecture` | "a system in name, not in design" | (systems/data ask — links to `participation-by-design` theme + monitor; no spend lever) | `ifg-data`, `adalovelace-data` |

Each carries `whatChanges`/`expectedEffect` in research + ELI5, and a `provenance` line ("Milburn's interim report is diagnostic; this is the direction the diagnosis points toward — formal recommendations follow in autumn 2026"). Companion entries may also be added as `kind: 'recommendation'` Directions where the companion makes a concrete proposal (e.g. EPI's 16–19 premium = `recommended`; the Youth Guarantee = `announced`/funded), so the layer shows "diagnosis → who actually recommends a fix → is it funded."

### 3.3 `lib/evidence.ts` — +3 neutral Milburn analyses

Append (schema unchanged; `lean: 'official'`):

- `milburn-neet-2026` — *Young People and Work (interim)*, 2026: "~1m 16–24 NEET, projected to ~1.25m within five years; the review estimates a ~£125bn annual cost and finds £1 of youth employment support spent for every ~£25 on benefits." area `['neet']`, themes `['early-identification','equity-not-money','participation-by-design']`, levers `['mental_health','youth_guarantee','entry_level','post16_premium']`, outcomes `['neet','neetInactiveHealth']`, strength `moderate`.
- `milburn-youth-economy` — "The youth share of the labour market has fallen even as overall employment rose; entry-level roles have become fewer and more demanding, and recruitment more automated; 6 in 10 NEETs have never had a job (up from 4 in 10 in 2005)." area `['neet']`, themes `['participation-by-design']`, levers `['entry_level','apprenticeships']`, outcomes `['neetUnemployed','neet']`, strength `moderate`.
- `milburn-health-driver` — "Health-related reasons for youth NEET rose ~70% over a decade; mental health is the primary condition for >4 in 10 disabled NEETs; ~8 in 10 of those entering health-related inactivity remain NEET 2+ years on." area `['neet']`, themes `['early-identification','participation-by-design']`, levers `['mental_health','camhs']`, outcomes `['neetInactiveHealth']`, strength `moderate`.

### 3.4 `lib/contradictions.ts` — +1 live contradiction

`neet-activation-health` — *"Will work-first activation move the health-driven NEET segment?"*
- **campA** "Activation works" — DWP Youth/Jobs Guarantee tradition; 84% of NEETs want work; job-matching + keyworker re-engagement (Youth Contract ≈ +1.8pp).
- **campB** "Health-driven and sticky" — Milburn/Resolution: inactivity is increasingly ill-health-driven; ~8 in 10 still NEET 2+ years on; a job opening does not fix a health condition.
- **engineAssumes**: the model already encodes the cautious reading — `youth_guarantee` has *no* effect on `neetInactiveHealth`; only `mental_health`/`camhs` do.
- themes `['early-identification','participation-by-design']`, levers `['youth_guarantee','mental_health','camhs']`, outcomes `['neetInactiveHealth','neet']`, confidence `contested`.

### 3.5 `lib/themes.ts` — +1 theme; reinforce 3 existing

**New theme** (`no: 5`):
```ts
{
  id: 'participation-by-design', no: 5, title: 'Participation by design',
  tagline: 'A system in name, not in design: education, health, welfare and the labour market each configured for something other than getting a young person into work.',
  summary: /* Milburn's architecture thesis: the youth economy lost its entry rungs; health is configured for treatment not participation; welfare is not built for participation; and the join across DfE, DWP, NHS and employers is nobody's job. One structural failure showing up across NEET, the data estate and the safeguarding jigsaw. */,
  summaryEli5: /* plain English */,
  recurs: [ {neet}, {monitor}, {jigsaw}, {send} ],
  levers: ['entry_level','youth_guarantee','mental_health','camhs','careers_gatsby'],
  outcomes: ['neet','neetInactiveHealth','neetUnemployed'],
  analyses: ['milburn-neet-2026','milburn-youth-economy','resolution-neet-europe','ifg-data'],
  contradictions: ['neet-activation-health'],
  dataAsk: /* a child/young-person record joined across DfE↔DWP↔NHS↔employers, and spend-per-stage accounting so the £1:£25 ratio is visible */,
  color: '#4b5a8a', // indigo — distinct from the four existing theme hues (green/blue/orange/purple) and from the lean palette
}
```
**Reinforce existing:** add `milburn-health-driver` to `early-identification.analyses` (the health signal precedes the NEET outcome) and `milburn-neet-2026` to `equity-not-money.analyses` (money spent at the wrong end of the pipeline); add `neet-activation-health` to `early-identification.contradictions`.

### 3.6 `lib/levers.ts` — +`entry_level` lever (group `post16`)

```ts
{
  id: 'entry_level', group: 'post16', label: 'Entry-level & work-experience access', unit: 'index',
  min: 0, max: 100, step: 5, baseline: 25, policy: 40,
  blurb: 'Employer-side demand for young workers — entry-level roles, work experience, the "Saturday job" ladder and wage incentives. The one DEMAND-side lever; every other NEET lever acts on the young person, not the labour market.',
  evidence: 'Milburn (2026) makes the youth labour market the #1 diagnosis: the youth share of employment has fallen, entry-level roles are fewer and more automated, and 6 in 10 NEETs have never had a job. The YFF toolkit rates wage subsidies and work-experience schemes LOW average impact, so the band is deliberately wide and confidence low; acts on the unemployed-active segment and (less) the discouraged "other" segment — not the health segment.',
  source: 'Milburn interim review 2026; Youth Futures Foundation Youth Employment Toolkit', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  confidence: 'low', policyRef: 'Youth Guarantee / employer-incentive measures (demand side)',
}
```
- `LEVER_META.entry_level = { drives: ['neet'], modelNote: 'The only DEMAND-side NEET lever: employer entry-level + work-experience access. Cuts unemployed-NEET inflow and persistence, lightly cuts the discouraged segment, and has NO effect on the health segment — a vacancy does not fix a health condition. Milburn's central diagnosis; low evidence security (YFF: wage subsidies/work experience low average impact).' }`
- `LEVER_ELI5_NAME.entry_level = 'More entry-level jobs & work experience'`
- `GROUP_ORDER` already includes `post16`; no change. Place the def in the post-16 cluster (after `apprenticeships`).

### 3.7 `lib/params.ts` — coefficients + cost for `entry_level`

- `POST16.entryLevelMax = band(0.2, 0.7, 1.6)` — pp off **unemployed** NEET at full deployment (YFF low-security ⇒ wide band, central below `apprenticeships`).
- `NEETSEG.entryLevelPersistCutU = band(0.02, 0.06, 0.12)` — absolute cut in unemployed persistence (entry jobs let the existing stock exit; smaller than the keyworker `persistCutU`).
- `CH.lag.entry_level = 2` (labour-demand measures act relatively fast).
- `COST.entryLevelFullBn = 0.5` — illustrative full-deployment cost (wage subsidies / work-experience funding); flag ASSUMPTION.

### 3.8 `lib/engine.ts` — NEET terms for `entry_level`

In the three-segment block:
- **`neetUnemployed`** `survive([...])`: add `R(POST16.entryLevelMax) * concave(depPos('entry_level')) * ramp(ys, 2)`.
- **`neetInactiveOther`** `survive([...])`: add `0.4 * R(POST16.entryLevelMax) * concave(depPos('entry_level')) * ramp(ys, 2)` (the discouraged / Saturday-job ladder).
- **`neetInactiveHealth`**: unchanged (no term — the honest "vacancies don't fix health" choice).
- **Persistence `pU`**: add `- R(NEETSEG.entryLevelPersistCutU) * concave(depPos('entry_level')) * ramp(ys, 2)`.
- **Trace**: add `'entry_level'` to the `neetUnemployed` trace term's `leverIds`.
- **`annualCost`**: add `+ Math.max(0, val('entry_level') - 25) / 75 * COST.entryLevelFullBn`.

Baseline reproduction is preserved: all terms use `depPos`/`dep` (= 0 at the lever's baseline), so the 2025 baseline and the no-`entry_level` runs are bit-identical to today.

### 3.9 `lib/scenarios.ts` — the simulatable "Milburn-aligned response" preset

Append to `PRESETS`:
```ts
{
  name: 'Milburn-aligned response',
  eli5Name: 'A response to the youth-NEET crisis',
  description: 'A defensible participation-first package the Milburn diagnosis points toward — NOT the review\'s recommendations (those follow in autumn 2026). Lifts the demand-side entry-level lever, the Youth/Jobs Guarantee, apprenticeships, careers, post-16 retention AND youth mental-health/CAMHS, hitting all three NEET segments. Subject to the engine\'s wide uncertainty: the youth levers are low-confidence.',
  eli5Desc: 'Tries the mix the Milburn review\'s diagnosis points to: more entry-level jobs, guaranteed training or work, apprenticeships, careers help and mental-health support. The model is unsure how big the effect is.',
  levers: /* milburnPackageLevers(policyLevers()) — composed from directions' leverTargets */,
}
```
Targets sourced from `directions.ts` `leverTargets` so the preset and the NEET-page asks never drift.

### 3.10 `lib/neet.ts` + `neet/+page.svelte` — the "fork in the road" act

`neet.ts`: add structured data —
- `MILBURN_DIAGNOSIS`: the 5 system failures (each `{ title, research, eli5, chapter }`), the new headline stats (`£125bn`, `£1:£25`, `6 in 10`, `+70%`, `only Romania`, `£300k`), each with a primary URL.
- A small selector pulling the Milburn directions from `directions.ts` for render.

`neet/+page.svelte`: a new `StorySection`-pattern act, *"The fork in the road"* — renders the diagnosis (5 failures + stats), the directional asks with their companion recommendations + status badges (diagnosis / recommended / announced), and a **"Load the response package →"** CTA that applies the preset and links to `/outcomes`. Dual research/ELI5 via the existing `app.narrative` toggle.

### 3.11 `lib/memo.ts` — Milburn-anchored ask

- Extend the existing NEET `MEMO_CASE` finding to name Milburn's "fork in the road" and the demand-side gap, and add one `INSTRUMENT` row: *"Cross-department youth-participation view"* — today: NEET status fragments across DfE/DWP/HMRC and the labour-demand side is unmeasured; target: a joined 16–24 EET + entry-level-vacancy signal (the `participation-by-design` data ask). Keep edits light and in the existing schema.

### 3.12 `lib/corpusIndex.json` — regenerate

After prose lands, regenerate the BM25 index so the new content is searchable (the `milburn` synonym already exists in `retrieval.server.ts`). Locate the generator (npm script / `scripts/`) during implementation; if none exists, the index is hand-updated following its existing shape. Non-blocking for the feature; do last.

---

## 4. Test plan (TDD — engine first)

Extend `lib/engine.neet.test.ts` (write tests first, watch fail, implement):

1. `entry_level` at max **reduces** `neetUnemployed` and headline `neet` at 2035 (Δ > 0.2pp).
2. `entry_level` at max has **~no effect** on `neetInactiveHealth` (`|Δ| < 0.05`).
3. `entry_level` reduces `neetInactiveOther` **modestly** (Δ > 0, and < the unemployed Δ).
4. `entry_level` **carries cost** (add `'entry_level'` to the existing cost-list test).
5. Segments still sum to the headline; **2025 baseline composition unchanged** (regression — baseline run identical to before).
6. The `'Milburn-aligned response'` preset yields **lower headline `neet`** than `policyLevers()` at 2035.

Also run the full existing suite (`engine.trace.test.ts`, `engine.earlyyears.test.ts`, `triage.test.ts`, `uplift.test.ts`, `retrieval.test.ts`) to confirm no regressions.

## 5. Verification (per project CLAUDE.md)

- `cd ~/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run check` (svelte-check; OOMs without the flag).
- `npx vitest run src/routes/projects/policy-engine/lib` (engine + NEET + trace tests green).
- `npm run build` **with the Bash sandbox disabled** (adapter-node step fails under sandbox).
- Deploy via `~/strange_rambling_svelte/scripts/deploy.sh` after pushing, then verify `/projects/policy-engine/neet` live (curl/screenshot) — per the deployment-verification discipline.

## 6. Non-goals / out of scope

- No second/duplicate source for "Young People and Work" (it is one report).
- No invented Milburn *recommendations* (interim report makes none; solutions phase is autumn 2026).
- No sitewide refresh of non-NEET sections beyond the theme reinforcement above.
- No new outcome variable in `YearResult` (the `entry_level` lever acts on existing NEET segments).
- No engine recalibration of other levers (only additive `entry_level` terms + overlap is handled by the existing multiplicative `survive()`).

## 7. Open calibration choices (to set during implementation, flagged as assumptions)

- `entry_level` `baseline`/`policy` (25/40), `POST16.entryLevelMax` central (0.7), `entryLevelPersistCutU`, `COST.entryLevelFullBn` — all low-confidence priors; documented inline as ASSUMPTION with the YFF low-evidence-security rationale, consistent with how `youth_guarantee`/`apprenticeships` are treated.
- The `leverTargets` for the Milburn package (how high each lever goes) — default to each lever's `policy` value, raised toward `max` only for the levers Milburn centres (`entry_level`, `mental_health`, `youth_guarantee`).
