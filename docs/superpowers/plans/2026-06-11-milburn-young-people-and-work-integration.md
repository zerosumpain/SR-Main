# Milburn *Young People and Work* Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deeply integrate Alan Milburn's DWP *Young People and Work* interim review into the policy-engine — its diagnosis as prose + neutral evidence, a new honestly-labelled "directions & asks" layer, a 5th cross-cutting theme, a new demand-side `entry_level` NEET lever, and a loadable/simulatable "Milburn-aligned response" package — surfaced on `/neet`, the themes and the memo.

**Architecture:** The engine is a data-driven knowledge graph (`sources → evidence → themes → levers → stories/prose → outcomes → contradictions`, wired by `…ForLever/Theme/Outcome` query functions). This adds one new node type (`directions.ts`), one theme, one lever (wired into the 3-segment NEET engine with no new outcome variable), and threads Milburn through existing nodes. All effects are deviations from each lever's baseline, so the 2025 baseline reproduces bit-identically.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, Vitest. Route: `src/routes/projects/policy-engine`. The engine, params, levers and tests are pure TS in `lib/`.

**Working directory for all commands:** `~/strange_rambling_svelte`
**Test runner:** `npx vitest run src/routes/projects/policy-engine/lib/<file>` (single file) or `... lib` (all).

**Spec:** `docs/superpowers/specs/2026-06-11-milburn-young-people-and-work-integration-design.md`

**Honesty guardrails (apply throughout):** Milburn content is `status: 'diagnosis'` with a provenance note, never a "recommendation" (the interim report makes none; solutions phase = autumn 2026). The package is "a defensible response the diagnosis points toward," not Milburn's recommendation, carrying the engine's wide-uncertainty caveat (the youth levers are low-confidence).

---

## File map

| File | Change |
|---|---|
| `lib/sources.ts` | Correct the conflated Milburn line (Task 1) |
| `lib/levers.ts` | +`entry_level` LeverDef, LEVER_META, ELI5 (Task 2) |
| `lib/params.ts` | +`COST.entryLevelFullBn` (T2); +`POST16.entryLevelMax`, `NEETSEG.entryLevelPersistCutU`, `CH.lag.entry_level` (Task 3) |
| `lib/engine.ts` | +cost term (T2); +NEET segment & persistence terms (Task 3) |
| `lib/engine.neet.test.ts` | +cost test (T2); +engine-effect tests (Task 3); +preset test (Task 8) |
| `lib/evidence.ts` | +3 neutral Milburn analyses (Task 4) |
| `lib/contradictions.ts` | +1 contradiction (Task 5) |
| `lib/themes.ts` | +`participation-by-design` theme; reinforce 3 existing (Task 6) |
| `lib/directions.ts` | **NEW** layer + query fns + `milburnPackageLevers` (Task 7) |
| `lib/directions.test.ts` | **NEW** referential-integrity + composer tests (Task 7) |
| `lib/scenarios.ts` | +"Milburn-aligned response" preset (Task 8) |
| `lib/neet.ts` | +`MILBURN_DIAGNOSIS` data (Task 9) |
| `neet/+page.svelte` | +"The fork in the road" act + CTA (Task 9) |
| `lib/memo.ts` | extend NEET finding + add instrument (Task 10) |
| `lib/corpusIndex.json` | regenerate (Task 11) |

---

## Task 1: Correct the Milburn source line

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/sources.ts:21`

- [ ] **Step 1: Replace the conflated line**

Find (line 21):
```ts
  { org: 'Milburn review (DWP)', what: '"Young People and Work" interim report, May 2026 (youth NEET & mental health)', url: 'https://www.fenews.co.uk/fe-voices/milburn-interim-review-warns-of-generational-fault-line-as-neet-numbers-could-hit-1-25-million-without-reform/' },
```
Replace with:
```ts
  { org: 'Milburn review (DWP)', what: '"Young People and Work" — interim DIAGNOSTIC report (28 May 2026, updated 8 June 2026): 9 chapters on why ~1m young people are NEET (£125bn/yr cost; £1 of youth employment support per ~£25 of benefits). Recommendations deferred to the "solutions" phase, autumn 2026.', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
```

- [ ] **Step 2: Type-check the file compiles**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts`
Expected: PASS (sources.ts is imported transitively; no behaviour change).

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/sources.ts
git commit -m "policy-engine: correct the Milburn 'Young People and Work' source (one diagnostic report, gov.uk primary)"
```

---

## Task 2: Add the `entry_level` lever (definition + cost, no engine effect yet)

This makes the lever exist and cost money. The NEET *effect* is added under TDD in Task 3.

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/levers.ts`
- Modify: `src/routes/projects/policy-engine/lib/params.ts`
- Modify: `src/routes/projects/policy-engine/lib/engine.ts`
- Test: `src/routes/projects/policy-engine/lib/engine.neet.test.ts`

- [ ] **Step 1: Add the LeverDef** (`levers.ts`, immediately after the `apprenticeships` lever object, before `mental_health`)

```ts
  {
    id: 'entry_level', group: 'post16', label: 'Entry-level & work-experience access', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 25, policy: 40,
    blurb: 'Employer demand for young workers — entry-level roles, work experience, the "Saturday job" ladder and wage incentives. The one DEMAND-side lever: every other NEET lever acts on the young person, not the labour market.',
    evidence: 'Milburn (2026) makes the youth labour market the #1 diagnosis: the youth share of employment has fallen even as employment rose, entry-level roles are fewer and more automated ("a portal, a test, a recorded interview or an algorithm"), and 6 in 10 NEETs have never had a job (up from 4 in 10 in 2005). The YFF toolkit rates wage subsidies and work-experience schemes LOW average impact, so the band is deliberately wide and confidence low — it acts on the unemployed-active segment and (less) the discouraged "other" segment, NOT the health segment.',
    source: 'Milburn interim review 2026; Youth Futures Foundation Youth Employment Toolkit', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
    confidence: 'low', policyRef: 'Youth Guarantee / employer-incentive measures (demand side)',
  },
```

- [ ] **Step 2: Add LEVER_META** (`levers.ts`, in the `LEVER_META` object, after the `post16_premium` entry)

```ts
  entry_level:    { drives: ['neet'], modelNote: 'The only DEMAND-side NEET lever: employer entry-level + work-experience access. Cuts unemployed-NEET inflow and persistence and lightly the discouraged "other" segment; NO effect on the health segment — a vacancy does not fix a health condition. Milburn\'s central diagnosis; low evidence security (YFF: wage subsidies / work experience low average impact).' },
```

- [ ] **Step 3: Add the ELI5 name** (`levers.ts`, in `LEVER_ELI5_NAME`, in the post-16 line)

Append to the object:
```ts
  entry_level: 'More entry-level jobs & work experience',
```

- [ ] **Step 4: Add the cost constant** (`params.ts`, in the `COST` object, after `apprenticeshipsFullBn`)

```ts
  entryLevelFullBn: 0.5,                      // £bn full demand-side effort (wage subsidies + work-experience funding) [ASSUMPTION — no costed programme]
```

- [ ] **Step 5: Write the failing cost test** (`engine.neet.test.ts`, inside `describe('NEET segments', …)`, extend the existing `'new levers carry cost'` test's id list)

Change:
```ts
    for (const id of ['youth_guarantee', 'careers_gatsby', 'apprenticeships', 'post16_premium']) {
```
to:
```ts
    for (const id of ['youth_guarantee', 'careers_gatsby', 'apprenticeships', 'post16_premium', 'entry_level']) {
```

- [ ] **Step 6: Run the test — expect FAIL**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts -t "new levers carry cost"`
Expected: FAIL — `entry_level` at max produces `cumulativeCost` 0 (no cost term yet).

- [ ] **Step 7: Add the cost term** (`engine.ts`, in the `annualCost` sum, after the `apprenticeships` line — `+ Math.max(0, val('apprenticeships') - 30) / 70 * COST.apprenticeshipsFullBn`)

```ts
      + Math.max(0, val('entry_level') - 25) / 75 * COST.entryLevelFullBn
```

- [ ] **Step 8: Run the test — expect PASS**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts -t "new levers carry cost"`
Expected: PASS.

- [ ] **Step 9: Run the full NEET suite — expect PASS (no regressions)**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts`
Expected: PASS — `entry_level` at baseline (25) has zero effect, so segments still sum and the 2025 baseline composition is unchanged.

- [ ] **Step 10: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/levers.ts src/routes/projects/policy-engine/lib/params.ts src/routes/projects/policy-engine/lib/engine.ts src/routes/projects/policy-engine/lib/engine.neet.test.ts
git commit -m "policy-engine: add demand-side entry_level NEET lever (definition + cost)"
```

---

## Task 3: Wire `entry_level` into the NEET engine (TDD)

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/params.ts`
- Modify: `src/routes/projects/policy-engine/lib/engine.ts`
- Test: `src/routes/projects/policy-engine/lib/engine.neet.test.ts`

- [ ] **Step 1: Write the failing tests** (`engine.neet.test.ts`, add inside `describe('NEET segments', …)`)

```ts
  it('entry_level acts on the unemployed segment, lightly on "other", and NOT on health', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const el = at(runSim(maxed(baselineLevers(), 'entry_level')).years, 2035);
    const dU = base.neetUnemployed - el.neetUnemployed;
    const dIO = base.neetInactiveOther - el.neetInactiveOther;
    const dIH = base.neetInactiveHealth - el.neetInactiveHealth;
    expect(dU).toBeGreaterThan(0.2);                 // demand-side cuts unemployed-NEET inflow
    expect(dIO).toBeGreaterThan(0);                  // the "Saturday job ladder" helps the discouraged a little
    expect(dIO).toBeLessThan(dU);                    // ...but less than the unemployed segment
    expect(Math.abs(dIH)).toBeLessThan(0.05);        // a vacancy does not fix a health condition
  });

  it('entry_level cuts unemployed persistence (long-term share falls)', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const el = at(runSim(maxed(baselineLevers(), 'entry_level')).years, 2035);
    expect(el.neetLongTerm / el.neet).toBeLessThan(base.neetLongTerm / base.neet);
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts -t "entry_level"`
Expected: FAIL — `entry_level` has no engine effect, so all deltas ≈ 0.

- [ ] **Step 3: Add the params coefficients** (`params.ts`)

In `POST16`, after `post16PremiumMax`:
```ts
  entryLevelMax: band(0.2, 0.7, 1.6),       // pp off UNEMPLOYED NEET at full demand-side effort [Milburn #1 diagnosis; YFF low evidence-security ⇒ wide band]
```
In `NEETSEG`, after `persistCutIH`:
```ts
  entryLevelPersistCutU: band(0.02, 0.06, 0.12), // absolute cut in unemployed persistence (entry jobs let the existing stock exit) [ASSUMPTION]
```
In `CH.lag`, add to the `youth_guarantee, careers_gatsby, apprenticeships, post16_premium` line:
```ts
    youth_guarantee: 2, careers_gatsby: 3, apprenticeships: 3, post16_premium: 3, entry_level: 2,
```

- [ ] **Step 4: Add the segment terms** (`engine.ts`)

In `neetUnemployed`'s `survive([...])` array, after the `apprenticeships` term (`R(POST16.apprenticeshipsMax) * concave(depPos('apprenticeships')) * ramp(ys, 3),`):
```ts
      R(POST16.entryLevelMax) * concave(depPos('entry_level')) * ramp(ys, 2),
```
In `neetInactiveOther`'s `survive([...])` array, after the `post16_premium` term:
```ts
      0.4 * R(POST16.entryLevelMax) * concave(depPos('entry_level')) * ramp(ys, 2),
```
In the persistence block, change `pU` to subtract an entry-level term. Replace:
```ts
    const pU = clamp(R(NEETSEG.persist.unemployed)
      - R(NEETSEG.persistCutU) * concave(depPos('youth_guarantee')) * ramp(ys, 2), 0.10, 0.95);
```
with:
```ts
    const pU = clamp(R(NEETSEG.persist.unemployed)
      - R(NEETSEG.persistCutU) * concave(depPos('youth_guarantee')) * ramp(ys, 2)
      - R(NEETSEG.entryLevelPersistCutU) * concave(depPos('entry_level')) * ramp(ys, 2), 0.10, 0.95);
```

- [ ] **Step 5: Add `entry_level` to the NEET trace metadata** (`engine.ts`, the `neet` trace `terms`, the "Unemployed-active" term's `leverIds`)

Change:
```ts
        { label: 'Unemployed-active', symbol: 'cyclical segment', value: neetUnemployed, leverIds: ['youth_guarantee', 'apprenticeships', 'careers_gatsby', 'post16_skills'], note: '...' },
```
to add `'entry_level'`:
```ts
        { label: 'Unemployed-active', symbol: 'cyclical segment', value: neetUnemployed, leverIds: ['youth_guarantee', 'apprenticeships', 'careers_gatsby', 'post16_skills', 'entry_level'], note: 'Moved by work-route levers (incl. the demand-side entry_level); cuts act multiplicatively (proportional hazards) so overlapping programmes saturate.' },
```

- [ ] **Step 6: Run the entry_level tests — expect PASS**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts -t "entry_level"`
Expected: PASS.

- [ ] **Step 7: Run the whole engine test set — expect PASS (no regressions)**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts src/routes/projects/policy-engine/lib/engine.trace.test.ts src/routes/projects/policy-engine/lib/engine.earlyyears.test.ts`
Expected: PASS (baseline reproduction + trace reconciliation intact; `entry_level` is additive and zero at baseline).

- [ ] **Step 8: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/params.ts src/routes/projects/policy-engine/lib/engine.ts src/routes/projects/policy-engine/lib/engine.neet.test.ts
git commit -m "policy-engine: wire entry_level into the NEET engine (unemployed + other segments, persistence)"
```

---

## Task 4: Add 3 neutral Milburn analyses to the evidence registry

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/evidence.ts`
- Test: `src/routes/projects/policy-engine/lib/evidence.test.ts` (NEW — small)

- [ ] **Step 1: Append the analyses** (`evidence.ts`, in the `ANALYSES` array, after the `adalovelace-ai-schools` entry — the last one before `];`)

```ts
  // ---- Milburn review (DWP) — "Young People and Work" (diagnostic, May 2026) ----
  { id: 'milburn-neet-2026', org: 'Milburn review', orgFull: 'Milburn review (DWP) — Young People and Work (interim)', lean: 'official',
    title: 'Young People and Work — interim diagnostic report', year: 2026,
    claim: 'About 1m 16–24-year-olds are NEET (~1 in 8), projected to ~1.25m (1 in 6) within five years without reform; the review estimates a ~£125bn annual cost ("more than we spend on education each year") and finds about £1 spent on youth employment support for every ~£25 on benefits.',
    area: ['neet'], themes: ['early-identification', 'equity-not-money', 'participation-by-design'], levers: ['mental_health', 'youth_guarantee', 'entry_level', 'post16_premium'], outcomes: ['neet', 'neetInactiveHealth'], strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { id: 'milburn-youth-economy', org: 'Milburn review', orgFull: 'Milburn review (DWP) — Young People and Work (interim)', lean: 'official',
    title: 'The youth economy — how the labour market produces detachment', year: 2026,
    claim: 'The youth share of the labour market has fallen even as overall employment rose; entry-level roles have become fewer and more demanding and recruitment "more remote, more automated and less human"; 6 in 10 NEETs have never had a job, up from 4 in 10 in 2005.',
    area: ['neet'], themes: ['participation-by-design'], levers: ['entry_level', 'apprenticeships'], outcomes: ['neetUnemployed', 'neet'], strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { id: 'milburn-health-driver', org: 'Milburn review', orgFull: 'Milburn review (DWP) — Young People and Work (interim)', lean: 'official',
    title: 'Health — configured for treatment, not participation', year: 2026,
    claim: 'Health-related reasons for youth NEET rose ~70% over a decade; mental health is the primary condition for more than 4 in 10 disabled NEETs; of those entering health-related inactivity 2017–19, ~8 in 10 were still NEET 2+ years later — making the inactivity sticky rather than cyclical.',
    area: ['neet'], themes: ['early-identification', 'participation-by-design'], levers: ['mental_health', 'camhs'], outcomes: ['neetInactiveHealth'], strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
```

- [ ] **Step 2: Write the wiring test** (NEW file `evidence.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { ANALYSES_BY_ID, analysesForLever, analysesForTheme } from './evidence';

describe('Milburn analyses', () => {
  it('the three Milburn analyses exist', () => {
    for (const id of ['milburn-neet-2026', 'milburn-youth-economy', 'milburn-health-driver']) {
      expect(ANALYSES_BY_ID[id]).toBeDefined();
    }
  });
  it('wire to the entry_level lever and the participation-by-design theme', () => {
    expect(analysesForLever('entry_level').map((a) => a.id)).toContain('milburn-youth-economy');
    expect(analysesForTheme('participation-by-design').map((a) => a.id)).toContain('milburn-neet-2026');
  });
});
```

- [ ] **Step 3: Run — expect PASS for "exist", FAIL for the theme wiring**

Run: `npx vitest run src/routes/projects/policy-engine/lib/evidence.test.ts`
Expected: the "exist" test PASSES; the "wire to" test PASSES for `analysesForLever` but the `analysesForTheme('participation-by-design')` half will pass too because the analyses already declare that theme id — it does not require the theme to exist in `themes.ts` (the query only filters `a.themes`). So expect PASS. If it FAILS, the analyses' `themes` arrays are wrong — fix them.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/evidence.ts src/routes/projects/policy-engine/lib/evidence.test.ts
git commit -m "policy-engine: add 3 neutral Milburn analyses to the evidence registry"
```

---

## Task 5: Add the activation-vs-health contradiction

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/contradictions.ts`

- [ ] **Step 1: Confirm the schema** by opening `contradictions.ts` and reading the `Contradiction`/`Camp` interfaces and the `CONTRADICTIONS` array tail.

Run: `sed -n '1,40p' src/routes/projects/policy-engine/lib/contradictions.ts`
(Use the fields you find. The expected shape, per the spec: `Camp { label; who[]; claim; evidence }`, `Contradiction { id; question; short; campA; campB; engineAssumes; whatWouldResolve; confidence; themes?; levers?; outcomes? }`.)

- [ ] **Step 2: Append the contradiction** (`contradictions.ts`, in the `CONTRADICTIONS` array, after the last entry)

```ts
  {
    id: 'neet-activation-health',
    question: 'Will work-first activation move the health-driven NEET segment?',
    short: 'Activation vs health-driven',
    campA: {
      label: 'Activation works',
      who: ['DWP (Youth Guarantee / Jobs Guarantee)', 'Get Britain Working'],
      claim: 'Most NEETs want to work (84% per Milburn); keyworker-led re-engagement, job-matching and a guaranteed offer move young people into work or training.',
      evidence: 'The 2012–14 Youth Contract keyworker model produced ≈ +1.8pp re-engagement; the Youth Guarantee funds £820m over 2026/27–28/29 plus an 18–24 Jobs Guarantee.',
    },
    campB: {
      label: 'Health-driven and sticky',
      who: ['Milburn review (DWP)', 'Resolution Foundation'],
      claim: 'Youth inactivity is increasingly driven by ill-health, not cyclical unemployment, so job-matching schemes do not reach the largest, growing segment — a vacancy does not fix a health condition.',
      evidence: 'Health-related NEET reasons rose ~70% in a decade; ~8 in 10 of those entering health-related inactivity are still NEET 2+ years later; mental health is the primary condition for >4 in 10 disabled NEETs.',
    },
    engineAssumes: 'The cautious reading: the Youth/Jobs Guarantee and entry-level levers act on the unemployed-active (and lightly the "other") segment but have NO effect on the health segment, which responds only to mental_health/CAMHS. So a work-first-only package leaves the fastest-growing segment largely untouched.',
    whatWouldResolve: 'A randomised or quasi-experimental evaluation of the Youth Guarantee that reports effects separately for the health-inactive segment, linked to administrative health and earnings outcomes.',
    confidence: 'contested',
    themes: ['early-identification', 'participation-by-design'],
    levers: ['youth_guarantee', 'mental_health', 'camhs', 'entry_level'],
    outcomes: ['neetInactiveHealth', 'neet'],
  },
```

- [ ] **Step 3: Type-check** (the contradictions file is imported by the NEET/themes pages)

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts`
Expected: PASS (compiles; no behaviour change).

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/contradictions.ts
git commit -m "policy-engine: add the activation-vs-health-driven NEET contradiction"
```

---

## Task 6: Add the "Participation by design" theme + reinforce existing themes

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/themes.ts`
- Test: `src/routes/projects/policy-engine/lib/themes.test.ts` (NEW)

- [ ] **Step 1: Append the new theme** (`themes.ts`, in the `THEMES` array, after the `measurement-validity` theme — the last entry)

```ts
  {
    id: 'participation-by-design',
    no: 5,
    title: 'Participation by design',
    tagline: 'A system in name, not in design: education, health, welfare and the labour market each configured for something other than getting a young person into work.',
    summary: 'Milburn\'s interim review diagnoses youth NEET as one interlocked failure showing up in four places: the youth economy lost its entry rungs (the youth share of employment fell; recruitment became automated); health services are "configured for treatment, not participation"; the welfare state is "not designed for participation"; and the architecture is "a system in name, not in design" — the join across DfE, DWP, NHS and employers is nobody\'s job. The same coordination failure recurs in the data estate and the safeguarding jigsaw: the picture of a young person is distributed by design and the joins fail.',
    summaryEli5: 'A million young people are out of work or training, and the Milburn review\'s answer is that the whole system around them is built for the wrong job: there are fewer first jobs, health services treat illness rather than help people back to work, benefits aren\'t set up to ease people into work, and no one owns joining it all up.',
    recurs: [
      { route: '/projects/policy-engine/neet', label: 'NEET', note: 'the youth economy, health and welfare each work against participation' },
      { route: '/projects/policy-engine/monitor', label: 'Monitoring', note: 'the DfE↔DWP↔NHS join that would make the £1:£25 ratio visible is nobody\'s job' },
      { route: '/projects/policy-engine/jigsaw', label: 'Jigsaw', note: 'the picture of a young person fragments across services by design' },
      { route: '/projects/policy-engine/send', label: 'SEND', note: 'the transition from EHCP support to work is the weakest join' },
    ],
    levers: ['entry_level', 'youth_guarantee', 'mental_health', 'camhs', 'careers_gatsby'],
    outcomes: ['neet', 'neetInactiveHealth', 'neetUnemployed'],
    analyses: ['milburn-neet-2026', 'milburn-youth-economy', 'resolution-neet-europe', 'ifg-data'],
    contradictions: ['neet-activation-health'],
    dataAsk: 'A young-person record joined across DfE, DWP, NHS and employers, and spend-per-stage accounting so the £1-support-to-£25-benefits ratio is visible — the join that is currently nobody\'s job.',
    color: '#4b5a8a',
  },
```

- [ ] **Step 2: Reinforce the early-identification theme** (`themes.ts`, the `early-identification` object)

Add `'milburn-health-driver'` to its `analyses` array and `'neet-activation-health'` to its `contradictions` array:
```ts
    analyses: ['epi-early-gap', 'epi-annual-2025', 'isos-send', 'resolution-neet', 'ippr-send', 'milburn-health-driver'],
    contradictions: ['send-cost-driver', 'attendance-enforcement', 'neet-activation-health'],
```

- [ ] **Step 3: Reinforce the equity-not-money theme** (`themes.ts`, the `equity-not-money` object)

Add `'milburn-neet-2026'` to its `analyses` array:
```ts
    analyses: ['oecd-pisa', 'nao-send-2024', 'suttontrust-ey', 'cep-teachers', 'ifs-spend-2025', 'gorard-pp', 'localtrust-lbn', 'milburn-neet-2026'],
```

- [ ] **Step 4: Write the test** (NEW `themes.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { THEMES, THEMES_BY_ID, themesForRoute } from './themes';
import { ANALYSES_BY_ID } from './evidence';
import { CONTRADICTIONS_BY_ID } from './contradictions';
import { LEVERS_BY_ID } from './levers';

describe('participation-by-design theme', () => {
  it('exists as the 5th theme and recurs on /neet', () => {
    expect(THEMES_BY_ID['participation-by-design']).toBeDefined();
    expect(THEMES.length).toBe(5);
    expect(themesForRoute('/projects/policy-engine/neet').map((t) => t.id)).toContain('participation-by-design');
  });
  it('every referenced analysis, contradiction and lever id resolves (all themes)', () => {
    for (const t of THEMES) {
      for (const a of t.analyses) expect(ANALYSES_BY_ID[a], `analysis ${a} in theme ${t.id}`).toBeDefined();
      for (const c of t.contradictions) expect(CONTRADICTIONS_BY_ID[c], `contradiction ${c} in theme ${t.id}`).toBeDefined();
      for (const l of t.levers) expect(LEVERS_BY_ID[l], `lever ${l} in theme ${t.id}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run src/routes/projects/policy-engine/lib/themes.test.ts`
Expected: PASS. (If a referential check fails, an id is mistyped — fix it.)

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/themes.ts src/routes/projects/policy-engine/lib/themes.test.ts
git commit -m "policy-engine: add 'Participation by design' theme + reinforce early-id & equity themes with Milburn"
```

---

## Task 7: Create the `directions.ts` "what should change" layer

**Files:**
- Create: `src/routes/projects/policy-engine/lib/directions.ts`
- Create: `src/routes/projects/policy-engine/lib/directions.test.ts`

- [ ] **Step 1: Create `directions.ts`**

```ts
// directions.ts — the "what should change" layer. Where evidence.ts holds NEUTRAL findings,
// this holds report-attributed DIRECTIONS and RECOMMENDATIONS: what a report says must change,
// what effect it expects, and which engine levers/themes/outcomes it bears on. Milburn's interim
// report is DIAGNOSTIC (it makes no recommendations until autumn 2026), so its entries are tagged
// 'diagnosis-direction' / status 'diagnosis' and paired with the recommending companions already
// in the corpus. Self-contained.

import type { Lean } from './evidence';
import type { LeverState } from './types';
import { LEVERS_BY_ID } from './levers';

export type DirKind = 'diagnosis-direction' | 'recommendation';
export type DirStatus = 'diagnosis' | 'recommended' | 'announced';

export const DIR_STATUS_META: Record<DirStatus, { label: string; eli5: string; colour: string }> = {
  diagnosis:   { label: 'Diagnosis points here', eli5: 'What the problem suggests', colour: '#4b5a8a' },
  recommended: { label: 'Recommended', eli5: 'Someone has proposed it', colour: '#b4632e' },
  announced:   { label: 'Announced / funded', eli5: 'Already government policy', colour: '#2f7d4f' },
};

export interface Direction {
  id: string;
  report: string;
  reportFull?: string;
  kind: DirKind;
  status: DirStatus;
  lean: Lean;
  title: string;
  whatChanges: { research: string; eli5: string };
  expectedEffect: { research: string; eli5: string };
  provenance: string;
  levers: string[];
  leverTargets?: Partial<Record<string, number>>;
  themes?: string[];
  outcomes?: string[];
  companions?: string[]; // evidence.ts analysis ids that recommend the same direction
  strength: 'strong' | 'moderate' | 'contested' | 'illustrative';
  url?: string;
}

const MILBURN_PROVENANCE =
  'Milburn\'s interim report is explicitly diagnostic ("the fork in the road") and makes no formal recommendations — those follow in the "solutions" phase, autumn 2026. This is the direction the diagnosis points toward, stated as an attributed ask, not a recommendation.';

export const DIRECTIONS: Direction[] = [
  // ---- Milburn's five system failures, as diagnosis-directions ----
  {
    id: 'milburn-youth-economy',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Rebuild the youth labour market: restore the entry-level rungs',
    whatChanges: {
      research: 'The youth share of employment has fallen and entry-level roles have become fewer and more automated; the diagnosis points to demand-side action — entry-level routes, work experience, the "Saturday job" ladder and employer incentives — alongside apprenticeship recovery.',
      eli5: 'There are simply fewer first jobs for young people, and getting one now means passing portals and automated tests instead of meeting a manager. The fix points at making more genuine entry-level openings and work experience.',
    },
    expectedEffect: {
      research: 'Acts on the unemployed-active NEET segment (and lightly the discouraged "other" segment); no effect on the health segment. Low evidence security (YFF rates wage subsidies / work experience low average impact), so the modelled band is wide.',
      eli5: 'Mostly helps young people who are looking for work; it does not help those who are NEET because they are unwell.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['entry_level', 'apprenticeships'],
    leverTargets: { entry_level: 70, apprenticeships: 75 },
    themes: ['participation-by-design'], outcomes: ['neetUnemployed', 'neet'],
    companions: ['onward-course-correction', 'suttontrust-apprentice', 'ifs-growth-skills'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-health-participation',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Reconfigure youth health support for participation, not just treatment',
    whatChanges: {
      research: 'Health services are "configured for treatment, not participation"; with health-related inactivity now the sticky, fastest-growing driver, the diagnosis points to mental-health and CAMHS capacity built around getting young people back to work or learning.',
      eli5: 'Health care for young people is set up to treat illness, not to help them back into work or study. The fix points at mental-health support that does both.',
    },
    expectedEffect: {
      research: 'Acts on the inactive-health segment — the one segment work-first schemes do not reach. Slow-acting: the stock is sticky (~8 in 10 still NEET 2+ years on).',
      eli5: 'Targets the group that job schemes miss — but slowly, because this group is the hardest to move.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['mental_health', 'camhs'],
    leverTargets: { mental_health: 80, camhs: 75 },
    themes: ['early-identification', 'participation-by-design'], outcomes: ['neetInactiveHealth'],
    companions: ['resolution-neet', 'resolution-neet-europe'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-skills-foundation',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Repair the education-and-skills foundation through the post-16 transition',
    whatChanges: {
      research: 'Education and skills are "the faltering foundation"; the diagnosis points to stronger post-16 study programmes, careers guidance and disadvantage funding that does not stop dead at 16.',
      eli5: 'School and college do not set enough young people up for work, and support stops at 16 just as the risk peaks. The fix points at better post-16 courses, careers help and money that follows poorer students past 16.',
    },
    expectedEffect: {
      research: 'Acts on NEET inflow at the post-16 boundary across segments (qualifications move employability most). Correlational evidence (Gatsby) and an untested proposal (EPI 16–19 premium), so bands are wide.',
      eli5: 'Reduces how many young people fall out after 16, but the evidence is indirect.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['post16_skills', 'post16_premium', 'careers_gatsby'],
    leverTargets: { post16_skills: 80, post16_premium: 600, careers_gatsby: 75 },
    themes: ['early-identification', 'participation-by-design'], outcomes: ['neet'],
    companions: ['epi-neet', 'smf-skills', 'cep-vocational'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-welfare-participation',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Redesign the welfare offer around participation',
    whatChanges: {
      research: 'The welfare state is "not designed for participation" and spends ~£25 on benefits for every £1 on youth employment support; the diagnosis points to a keyworker-led, employer-proximate guarantee that re-engages young people rather than parking them on benefits.',
      eli5: 'The benefits system spends far more keeping young people on benefits than helping them into work. The fix points at a guarantee of training or a job, with a real person to help.',
    },
    expectedEffect: {
      research: 'Acts on the unemployed-active segment twice: cuts inflow AND re-engages the existing stock (the Youth Contract keyworker analogue ≈ +1.8pp). No effect on the health segment.',
      eli5: 'Helps young people looking for work both by reducing how many become NEET and by getting those already stuck back into work.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: ['youth_guarantee'],
    leverTargets: { youth_guarantee: 80 },
    themes: ['participation-by-design'], outcomes: ['neetUnemployed', 'neet'],
    companions: [],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },
  {
    id: 'milburn-architecture',
    report: 'Milburn review', reportFull: 'Milburn review (DWP) — Young People and Work (interim)',
    kind: 'diagnosis-direction', status: 'diagnosis', lean: 'official',
    title: 'Make the architecture a system in design, not just in name',
    whatChanges: {
      research: '"A system in name, not in design": the join across DfE, DWP, NHS and employers is nobody\'s job, so no one can see the whole young person or the £1:£25 spend split. The diagnosis points to a cross-department participation view and spend-per-stage accounting — a stewardship ask, not a spend lever.',
      eli5: 'No single body joins up education, benefits, health and employers, so nobody sees the whole picture or where the money really goes. The fix is about joining the system up, not spending more.',
    },
    expectedEffect: {
      research: 'A data/coordination ask rather than a modelled lever — it makes the rest measurable and accountable. Surfaced through the Participation-by-design theme and the Monitoring data spine.',
      eli5: 'Doesn\'t directly change the numbers in the model — it\'s what would let anyone see whether the rest worked.',
    },
    provenance: MILBURN_PROVENANCE,
    levers: [],
    themes: ['participation-by-design'], outcomes: ['neet'],
    companions: ['ifg-data', 'adalovelace-data'],
    strength: 'moderate',
    url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report',
  },

  // ---- Companion responses already in the policy debate (recommendation / announced) ----
  {
    id: 'youth-guarantee-policy',
    report: 'Youth Guarantee', reportFull: 'Get Britain Working / Youth Guarantee (Commons Library CBP-10827)',
    kind: 'recommendation', status: 'announced', lean: 'official',
    title: 'The Youth Guarantee & 18–24 Jobs Guarantee (funded response)',
    whatChanges: {
      research: 'A guaranteed offer of further learning, an apprenticeship or help into work for 18–21s, plus a paid 6-month Jobs Guarantee for young UC claimants — £820m over 2026/27–28/29.',
      eli5: 'The government\'s actual answer so far: a promise of training or a job for young people, with money behind it.',
    },
    expectedEffect: {
      research: 'The evaluated analogue (2012–14 Youth Contract) produced ≈ +1.8pp re-engagement; national-scale effects unproven. Maps to the youth_guarantee lever.',
      eli5: 'Past versions helped a bit; nobody knows yet how well this one will work at scale.',
    },
    provenance: 'A real, funded government programme — shown as the announced response that answers Milburn\'s welfare-participation diagnosis.',
    levers: ['youth_guarantee'], themes: ['participation-by-design'], outcomes: ['neetUnemployed', 'neet'],
    companions: [], strength: 'moderate',
    url: 'https://commonslibrary.parliament.uk/research-briefings/cbp-10827/',
  },
  {
    id: 'epi-16-19-premium',
    report: 'EPI', reportFull: 'Education Policy Institute — Five charts that explain the rise in NEET rates',
    kind: 'recommendation', status: 'recommended', lean: 'centre',
    title: 'A 16–19 disadvantage premium (EPI proposal)',
    whatChanges: {
      research: 'Disadvantage funding largely stops at 16 even though the NEET cliff is at 16–18; EPI proposes a Pupil-Premium-style premium following the student past 16 as the most direct funding response.',
      eli5: 'Extra money for poorer pupils stops at 16, right when the risk is highest. EPI says extend it.',
    },
    expectedEffect: {
      research: 'No causal estimate exists; modelled via post-16 retention (the post16_premium lever) with a wide band.',
      eli5: 'Could help keep poorer young people in education after 16, but it is untested.',
    },
    provenance: 'A concrete recommendation from a recommending companion — what Milburn\'s skills-foundation diagnosis points toward, costed.',
    levers: ['post16_premium'], leverTargets: { post16_premium: 600 },
    themes: ['equity-not-money', 'participation-by-design'], outcomes: ['neet'],
    companions: ['epi-neet'], strength: 'moderate',
    url: 'https://epi.org.uk/publications-and-research/five-charts-that-explain-the-rise-in-neet-rates/',
  },
];

export const DIRECTIONS_BY_ID: Record<string, Direction> = Object.fromEntries(DIRECTIONS.map((d) => [d.id, d]));

export function directionsForLever(id: string): Direction[] {
  return DIRECTIONS.filter((d) => d.levers.includes(id));
}
export function directionsForTheme(id: string): Direction[] {
  return DIRECTIONS.filter((d) => d.themes?.includes(id));
}
export function directionsForOutcome(id: string): Direction[] {
  return DIRECTIONS.filter((d) => d.outcomes?.includes(id));
}

/** Compose the Milburn-aligned "response package" lever state from the diagnosis-directions'
 *  leverTargets (single source of truth shared with the scenarios.ts preset). Targets are clamped
 *  to each lever's [min, max]; levers without a target keep their value from `base`. */
export function milburnPackageLevers(base: LeverState): LeverState {
  const out: LeverState = { ...base };
  for (const d of DIRECTIONS) {
    if (d.kind !== 'diagnosis-direction' || !d.leverTargets) continue;
    for (const [id, target] of Object.entries(d.leverTargets)) {
      const L = LEVERS_BY_ID[id];
      if (!L || target == null) continue;
      out[id] = Math.min(L.max, Math.max(L.min, target));
    }
  }
  return out;
}
```

- [ ] **Step 2: Create `directions.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { DIRECTIONS, DIRECTIONS_BY_ID, directionsForLever, milburnPackageLevers } from './directions';
import { ANALYSES_BY_ID } from './evidence';
import { THEMES_BY_ID } from './themes';
import { LEVERS_BY_ID, baselineLevers, policyLevers } from './levers';
import { runSim } from './engine';

// the set of valid outcome ids = the numeric keys of a YearResult
const OUTCOME_IDS = new Set(Object.keys(runSim(baselineLevers()).years[0]));

describe('directions referential integrity', () => {
  it('every lever, theme, outcome and companion id resolves', () => {
    for (const d of DIRECTIONS) {
      for (const l of d.levers) expect(LEVERS_BY_ID[l], `lever ${l} in ${d.id}`).toBeDefined();
      for (const t of d.themes ?? []) expect(THEMES_BY_ID[t], `theme ${t} in ${d.id}`).toBeDefined();
      for (const o of d.outcomes ?? []) expect(OUTCOME_IDS.has(o), `outcome ${o} in ${d.id}`).toBe(true);
      for (const c of d.companions ?? []) expect(ANALYSES_BY_ID[c], `companion ${c} in ${d.id}`).toBeDefined();
      for (const id of Object.keys(d.leverTargets ?? {})) expect(LEVERS_BY_ID[id], `target ${id} in ${d.id}`).toBeDefined();
    }
  });
  it('the five Milburn diagnosis-directions exist', () => {
    for (const id of ['milburn-youth-economy', 'milburn-health-participation', 'milburn-skills-foundation', 'milburn-welfare-participation', 'milburn-architecture']) {
      expect(DIRECTIONS_BY_ID[id]?.kind).toBe('diagnosis-direction');
    }
  });
  it('directionsForLever finds entry_level', () => {
    expect(directionsForLever('entry_level').map((d) => d.id)).toContain('milburn-youth-economy');
  });
});

describe('milburnPackageLevers', () => {
  it('raises the youth/health levers above announced policy and clamps to range', () => {
    const pkg = milburnPackageLevers(policyLevers());
    expect(pkg.entry_level).toBe(70);
    expect(pkg.mental_health).toBe(80);
    expect(pkg.youth_guarantee).toBe(80);
    for (const id of Object.keys(pkg)) {
      const L = LEVERS_BY_ID[id];
      if (L) { expect(pkg[id]).toBeLessThanOrEqual(L.max); expect(pkg[id]).toBeGreaterThanOrEqual(L.min); }
    }
  });
  it('projects lower NEET than announced policy at 2035', () => {
    const pol = runSim(policyLevers()).years.find((y) => y.year === 2035)!;
    const pkg = runSim(milburnPackageLevers(policyLevers())).years.find((y) => y.year === 2035)!;
    expect(pkg.neet).toBeLessThan(pol.neet);
  });
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx vitest run src/routes/projects/policy-engine/lib/directions.test.ts`
Expected: PASS. (A failing referential check means an id is mistyped — fix it in `directions.ts`.)

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/directions.ts src/routes/projects/policy-engine/lib/directions.test.ts
git commit -m "policy-engine: add directions.ts (Milburn diagnosis-directions + companions + package composer)"
```

---

## Task 8: Add the "Milburn-aligned response" preset

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/scenarios.ts`
- Test: `src/routes/projects/policy-engine/lib/engine.neet.test.ts`

- [ ] **Step 1: Import the composer** (`scenarios.ts`, top, extend the levers import)

Change:
```ts
import { baselineLevers, policyLevers, LEVERS } from './levers';
```
to:
```ts
import { baselineLevers, policyLevers, LEVERS } from './levers';
import { milburnPackageLevers } from './directions';
```

- [ ] **Step 2: Append the preset** (`scenarios.ts`, in the `PRESETS` array, after the `Best value` preset)

```ts
  {
    name: 'Milburn-aligned response',
    eli5Name: 'A response to the youth-NEET crisis',
    eli5Desc: 'Tries the mix the Milburn review\'s diagnosis points to: more entry-level jobs, guaranteed training or work, apprenticeships, careers help, post-16 support and youth mental-health care. The model is genuinely unsure how big the effect is.',
    description: 'A defensible participation-first package the Milburn diagnosis points toward — NOT the review\'s recommendations (those follow in autumn 2026). Lifts the demand-side entry-level lever, the Youth/Jobs Guarantee, apprenticeships, careers, post-16 retention AND youth mental-health/CAMHS, hitting all three NEET segments. Subject to the engine\'s wide uncertainty: every youth lever here is low-confidence.',
    levers: milburnPackageLevers(policyLevers()),
  },
```

- [ ] **Step 3: Write the test** (`engine.neet.test.ts`)

First add the import at the **top of the file** with the other imports (imports must be top-level — do NOT place it inside the describe):
```ts
import { PRESETS } from './scenarios';
```
Then add a new `describe` block at the end of the file:
```ts
describe('Milburn-aligned response preset', () => {
  it('is registered and projects lower NEET than announced policy', () => {
    const preset = PRESETS.find((p) => p.name === 'Milburn-aligned response');
    expect(preset).toBeDefined();
    const pol = at(runSim(policyLevers()).years, 2035);
    const milburn = at(runSim(preset!.levers).years, 2035);
    expect(milburn.neet).toBeLessThan(pol.neet);
  });
});
```
(Add `policyLevers` to the existing `from './levers'` import if not already present — it is imported at the top of the file.)

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts -t "Milburn-aligned"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/scenarios.ts src/routes/projects/policy-engine/lib/engine.neet.test.ts
git commit -m "policy-engine: add the loadable 'Milburn-aligned response' preset (composed from directions)"
```

---

## Task 9: Add the "fork in the road" act to the NEET page

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/neet.ts`
- Modify: `src/routes/projects/policy-engine/neet/+page.svelte`

- [ ] **Step 1: Add the diagnosis data** (`neet.ts`, append at end of file)

```ts
// ---------------------------------------------------------------------------
// The Milburn review ("Young People and Work", interim DIAGNOSTIC report, May 2026):
// the five interlocking system failures and the new headline numbers. DIAGNOSIS ONLY —
// the review makes no recommendations until the "solutions" phase, autumn 2026; the
// directional asks live in directions.ts (tagged status:'diagnosis'). [gov.uk interim report]
// ---------------------------------------------------------------------------
export interface MilburnFailure { chapter: string; title: string; research: string; eli5: string; }

export const MILBURN_FAILURES: MilburnFailure[] = [
  { chapter: 'Ch.3', title: 'The youth economy',
    research: 'The youth share of the labour market has fallen even as overall employment rose; entry-level roles are fewer and more demanding, and recruitment is "more remote, more automated and less human" — "a portal, a test, a recorded interview or an algorithm".',
    eli5: 'There are fewer first jobs, and getting one now means passing online portals and automated tests instead of meeting a manager.' },
  { chapter: 'Ch.5', title: 'Health — configured for treatment, not participation',
    research: 'Health-related reasons for youth NEET rose ~70% in a decade and mental health is the primary condition for >4 in 10 disabled NEETs; the system treats illness rather than supporting a route back to work or learning.',
    eli5: 'Health care for young people is set up to treat illness, not to help them back into work or study.' },
  { chapter: 'Ch.4', title: 'Education & skills — the faltering foundation',
    research: 'Too many young people leave education without the qualifications or support to make the transition to work, and disadvantage funding largely stops at 16 even though the NEET cliff is at 16–18.',
    eli5: 'School and college do not set enough young people up for work, and the extra help stops at 16.' },
  { chapter: 'Ch.6', title: 'A welfare state not designed for participation',
    research: 'In 2024/25 about £1 was spent on employment support for young people for every ~£25 on benefits; the system parks young people rather than re-engaging them, and ~7 in 10 claiming a health/disability benefit are still claiming a decade later.',
    eli5: 'The benefits system spends far more keeping young people on benefits than helping them into work.' },
  { chapter: 'Ch.7', title: 'The architecture — a system in name, not in design',
    research: 'Responsibility for young people is split across education, health, welfare and employers with no one owning the join — "a system in name, not in design" — so no one sees the whole young person or the £1:£25 spend split.',
    eli5: 'No single body joins up education, benefits, health and employers, so nobody sees the whole picture.' },
];

export const MILBURN_STATS = [
  { big: '~£125bn', label: 'estimated annual cost of ~1m young NEETs — "more than we spend on education each year"', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: '£1 : £25', label: 'spent on youth employment support vs on benefits (2024/25)', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: '6 in 10', label: 'NEETs today have never had a job — up from 4 in 10 in 2005', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: '+70%', label: 'rise in health-related reasons for being NEET over a decade', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
  { big: 'only Romania', label: 'had a higher youth NEET rate in Europe by 2025', url: 'https://www.gov.uk/government/publications/young-people-and-work-interim-report' },
];
```

- [ ] **Step 2: Add imports** (`neet/+page.svelte`, in the `<script>` block)

After the existing `import { STORIES } from '../lib/stories';`:
```ts
  import { goto } from '$app/navigation';
  import { PRESETS } from '../lib/scenarios';
  import { DIRECTIONS, DIR_STATUS_META } from '../lib/directions';
```
Extend the `from '../lib/neet'` import list to also pull the new exports:
```ts
    TOOLING_LADDER, FAILURE_GALLERY, OPPORTUNITY_LADDER, GOVERNANCE_CHECKLIST,
    MILBURN_FAILURES, MILBURN_STATS,
  } from '../lib/neet';
```

- [ ] **Step 3: Add the CTA handler + selected directions** (`neet/+page.svelte`, in the `<script>`, after `const eli = $derived(...)`)

```ts
  const milburnDirections = DIRECTIONS.filter((d) => d.kind === 'diagnosis-direction');
  function loadMilburnPackage() {
    const preset = PRESETS.find((p) => p.name === 'Milburn-aligned response');
    if (preset) app.applyPreset(preset);
    goto('/projects/policy-engine/outcomes');
  }
```

- [ ] **Step 4: Add the section markup** (`neet/+page.svelte`, immediately after the closing `</div>` of the `<div class="pe-prose lede">` block — i.e. after line ~101, before `<!-- ===================== 1 · the scale ===================== -->`)

```svelte
  <!-- ===================== The fork in the road (Milburn) ===================== -->
  <section class="block milburn">
    <p class="kick">The Milburn review · "Young People and Work" (interim, May 2026)</p>
    <h2 class="pe-h2">The fork in the road — what the diagnosis says must change</h2>
    <p class="cap">
      {eli
        ? 'A major government review set out WHY a million young people are NEET. It is a diagnosis, not a plan — its recommendations come in autumn 2026. Here is what it found, and the directions it points to.'
        : 'Alan Milburn’s DWP review diagnoses why ~1m young people are NEET across five interlocking failures. It is explicitly diagnostic — Chapter 9 is "the fork in the road" — with recommendations deferred to the solutions phase (autumn 2026). Below: the diagnosis, the directions it points toward, and the response package the engine can project.'}
    </p>

    <div class="mstats">
      {#each MILBURN_STATS as s (s.big)}
        <a class="mstat" href={s.url} target="_blank" rel="noopener">
          <span class="mstat-big">{s.big}</span><span class="mstat-lab">{s.label}</span>
        </a>
      {/each}
    </div>

    <div class="mfails">
      {#each MILBURN_FAILURES as f (f.title)}
        <div class="mfail">
          <span class="mfail-ch">{f.chapter}</span>
          <h3 class="mfail-t">{f.title}</h3>
          <p class="mfail-b">{eli ? f.eli5 : f.research}</p>
        </div>
      {/each}
    </div>

    <h3 class="pe-h3">The directions the diagnosis points to</h3>
    <p class="cap">
      {eli
        ? 'These are NOT the review’s recommendations (those come later) — they are the directions its diagnosis points to, each paired with what the model can simulate.'
        : 'Directions, not recommendations: each Milburn ask is tagged as diagnosis-led and mapped to the engine’s levers, so the package below can be projected. Formal recommendations follow in autumn 2026.'}
    </p>
    <div class="mdirs">
      {#each milburnDirections as d (d.id)}
        <div class="mdir">
          <span class="mdir-badge" style="--c:{DIR_STATUS_META[d.status].colour}">
            {eli ? DIR_STATUS_META[d.status].eli5 : DIR_STATUS_META[d.status].label}
          </span>
          <h4 class="mdir-t">{d.title}</h4>
          <p class="mdir-b">{eli ? d.whatChanges.eli5 : d.whatChanges.research}</p>
          <p class="mdir-eff"><b>{eli ? 'In the model:' : 'Expected effect:'}</b> {eli ? d.expectedEffect.eli5 : d.expectedEffect.research}</p>
        </div>
      {/each}
    </div>

    <div class="mcta">
      <button class="mcta-btn" onclick={loadMilburnPackage}>
        {eli ? 'See what this mix does →' : 'Load the "Milburn-aligned response" package →'}
      </button>
      <p class="mcta-note">
        {eli
          ? 'Loads a ready-made mix of these policies and shows the projection. It’s a fair attempt, not the review’s plan — and the model is unsure of the size.'
          : 'Applies a defensible participation-first package (entry-level, Youth Guarantee, apprenticeships, careers, post-16 and youth mental-health) and opens the Outcomes projection. Not the review’s recommendations; subject to the engine’s wide uncertainty (the youth levers are low-confidence).'}
      </p>
    </div>
  </section>
```

- [ ] **Step 5: Add minimal styles** (`neet/+page.svelte`, in the `<style>` block — match existing token usage; reuse the page's CSS variables)

```css
  .milburn { border-left: 3px solid #4b5a8a; padding-left: 1.1rem; }
  .milburn .kick { font: 600 0.72rem/1.3 var(--font-label, 'JetBrains Mono', monospace); letter-spacing: 0.04em; text-transform: uppercase; color: #4b5a8a; margin: 0 0 0.2rem; }
  .mstats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin: 0.9rem 0; }
  .mstat { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.6rem 0.7rem; background: var(--card-bg, rgba(28,22,17,0.04)); border-radius: 6px; text-decoration: none; color: inherit; }
  .mstat-big { font: 800 1.25rem/1 var(--font-display, 'Archivo Black', system-ui); color: #4b5a8a; }
  .mstat-lab { font-size: 0.78rem; line-height: 1.3; opacity: 0.85; }
  .mfails { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.7rem; margin: 0.9rem 0; }
  .mfail { padding: 0.7rem 0.8rem; background: var(--card-bg, rgba(28,22,17,0.04)); border-radius: 6px; }
  .mfail-ch { font: 600 0.7rem var(--font-label, 'JetBrains Mono', monospace); opacity: 0.6; }
  .mfail-t { font-size: 0.95rem; margin: 0.2rem 0 0.3rem; }
  .mfail-b { font-size: 0.82rem; line-height: 1.4; margin: 0; opacity: 0.9; }
  .mdirs { display: grid; gap: 0.7rem; margin: 0.7rem 0; }
  .mdir { padding: 0.7rem 0.9rem; border: 1px solid rgba(28,22,17,0.12); border-radius: 6px; }
  .mdir-badge { display: inline-block; font: 600 0.66rem var(--font-label, 'JetBrains Mono', monospace); text-transform: uppercase; letter-spacing: 0.03em; color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 0.1rem 0.5rem; margin-bottom: 0.35rem; }
  .mdir-t { font-size: 0.98rem; margin: 0 0 0.3rem; }
  .mdir-b { font-size: 0.85rem; line-height: 1.45; margin: 0 0 0.3rem; }
  .mdir-eff { font-size: 0.8rem; line-height: 1.4; margin: 0; opacity: 0.85; }
  .mcta { margin-top: 1rem; }
  .mcta-btn { font: 600 0.9rem var(--font-body, system-ui); background: #4b5a8a; color: #fff; border: none; border-radius: 6px; padding: 0.6rem 1rem; cursor: pointer; }
  .mcta-btn:hover { filter: brightness(1.08); }
  .mcta-note { font-size: 0.78rem; line-height: 1.4; opacity: 0.8; margin: 0.45rem 0 0; }
  .pe-h3 { font-size: 1.05rem; margin: 1.1rem 0 0.2rem; }
```

- [ ] **Step 6: Type-check the route**

Run: `cd ~/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -A3 "policy-engine/neet" || echo "no neet errors"`
Expected: no errors referencing `neet/+page.svelte` or `lib/neet.ts`.

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/neet.ts src/routes/projects/policy-engine/neet/+page.svelte
git commit -m "policy-engine: add the Milburn 'fork in the road' act + load-package CTA to /neet"
```

---

## Task 10: Thread Milburn into the policy memo

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/memo.ts`

- [ ] **Step 1: Extend the NEET finding** (`memo.ts`, the `MEMO_CASE` entry whose `point` is "The predictors are already in the Department's own data, years early.")

Replace its `research` value with:
```ts
    research: 'Absence, prior attainment and EHCP status — visible at age 13–14 in data DfE already holds — are the strongest predictors of the million-young-person NEET outcome. The Milburn review (2026) reframes the scale ("the fork in the road": ~£125bn/yr, £1 of youth support per ~£25 of benefits) and locates the failure across the youth economy, health, welfare and an architecture that is "a system in name, not in design". England runs a deterministic checklist (RONI) with no published error rates; the question is not whether to build early warning, but whether to do it credibly — and whether anyone owns the cross-department join.',
```

- [ ] **Step 2: Add an instrument** (`memo.ts`, in the `INSTRUMENTS` array, after the "Post-16 participation signal & NEET nowcast" entry)

```ts
  {
    name: 'Cross-department youth-participation view',
    today: 'NEET status fragments across DfE, DWP, HMRC and NHS; the labour-DEMAND side (entry-level vacancies, work experience) is unmeasured, so the £1:£25 support-vs-benefits split is invisible',
    target: 'A joined 16–24 EET + entry-level-vacancy signal and spend-per-stage accounting — the participation-by-design data ask (Milburn ch.7: "a system in name, not in design")',
    owner: 'DfE + DWP + HMRC + NHSE', cost: '££', study: { label: 'NEET', href: '/projects/policy-engine/neet' },
  },
```

- [ ] **Step 3: Type-check**

Run: `npx vitest run src/routes/projects/policy-engine/lib/engine.neet.test.ts`
Expected: PASS (memo.ts compiles; imported by the memo route).

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/memo.ts
git commit -m "policy-engine: thread the Milburn diagnosis into the policy memo (finding + instrument)"
```

---

## Task 11: Regenerate the search corpus

**Files:**
- Modify: `src/routes/projects/policy-engine/lib/corpusIndex.json`

- [ ] **Step 1: Find the generator**

Run:
```bash
cd ~/strange_rambling_svelte
grep -rl "corpusIndex" scripts src --include=*.ts --include=*.mjs --include=*.js 2>/dev/null | grep -iv "retrieval"
cat package.json | grep -iE "corpus|index" || true
```
Expected: a generator script path (e.g. `scripts/build-policy-corpus.ts`) and/or an npm script.

- [ ] **Step 2: Run the generator (if one exists)**

If an npm script exists: `npm run <that-script>`.
If a standalone TS script exists: `npx tsx <path-to-script>`.
Expected: `lib/corpusIndex.json` is rewritten; `git diff --stat` shows it changed.

- [ ] **Step 3: If NO generator exists, skip regeneration**

The corpus is a pre-built optimisation, not required for the feature to work, and the `milburn` synonym already exists in `retrieval.server.ts`. Note this in the commit and move on — do NOT hand-edit the 1.4MB JSON.

- [ ] **Step 4: Run retrieval tests**

Run: `npx vitest run src/routes/projects/policy-engine/lib/retrieval.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (only if the index changed)**

```bash
cd ~/strange_rambling_svelte
git add src/routes/projects/policy-engine/lib/corpusIndex.json
git commit -m "policy-engine: regenerate search corpus with Milburn content" || echo "no corpus change to commit"
```

---

## Task 12: Full verification + deploy

**Files:** none (verification only).

- [ ] **Step 1: Run the entire policy-engine test suite**

Run: `npx vitest run src/routes/projects/policy-engine/lib`
Expected: ALL PASS (engine, NEET, trace, early-years, triage, uplift, retrieval, evidence, themes, directions).

- [ ] **Step 2: Type-check the whole project**

Run: `cd ~/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run check`
Expected: 0 errors. (This flag is required or svelte-check OOMs — see project memory.)

- [ ] **Step 3: Build (sandbox disabled)**

Run the build with the Bash sandbox **disabled** (the adapter-node step fails under the sandbox — see project memory):
`npm run build`
Expected: build succeeds. If it fails at `.svelte-kit/output`, do a clean rebuild: `rm -rf .svelte-kit/output && npm run build`.

- [ ] **Step 4: Deploy**

Run: `~/strange_rambling_svelte/scripts/deploy.sh`
(Per project CLAUDE.md: always deploy after pushing UI/UX changes; push first if the deploy script expects it.)

- [ ] **Step 5: Verify live**

After deploy, confirm the new act is live:
`curl -s https://strangeramblings.com/projects/policy-engine/neet | grep -c "fork in the road"`
Expected: ≥ 1. Also load `/projects/policy-engine/neet` in a browser, toggle research/ELI5, click "Load the Milburn-aligned response package", and confirm `/outcomes` shows a lower NEET line than "Announced policy".

- [ ] **Step 6: Final commit / push** (if anything outstanding)

```bash
cd ~/strange_rambling_svelte
git status
git push
```

---

## Self-review notes (for the executor)

- **Baseline safety:** every `entry_level` term uses `depPos`/`dep` (0 at the lever's baseline of 25), so the 2025 baseline and any run without `entry_level` reproduce bit-identically. The existing "reproduces the 2025 baseline composition" test guards this.
- **No new outcome variable:** `entry_level` acts on the existing `neetUnemployed`/`neetInactiveOther` stocks and `pU` persistence; `YearResult` is unchanged.
- **Honesty:** Milburn entries are `status: 'diagnosis'` with `MILBURN_PROVENANCE`; the preset description and CTA note both state it is not the review's recommendation and carry the uncertainty caveat.
- **Single source of truth:** the preset's lever values come from `milburnPackageLevers()`, which reads `directions.ts` `leverTargets`, so the `/neet` asks and the loadable package can never drift.
- **If `contradictionsForLever`/`THEMES_BY_ID`/`CONTRADICTIONS_BY_ID` names differ from those assumed here**, adjust the test imports to the actual exports (confirm by reading the file head in Task 5 Step 1 and `themes.ts`/`contradictions.ts`).
