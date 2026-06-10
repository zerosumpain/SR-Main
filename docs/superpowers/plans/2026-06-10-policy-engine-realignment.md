# Policy Engine Realignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/projects/policy-engine` into a Briefing + Field Studies strategic-intelligence toolset: realigned narrative, co-visible story/data UI, a 3-segment evidence-calibrated NEET engine, and a NEET data/AI intelligence story with a calibrated triage simulator.

**Architecture:** Four independently-deployable phases (A narrative, B UI, C engine, D intelligence). All work stays inside `src/routes/projects/policy-engine/` (self-contained route folder: bespoke SVG charts, baked-in data constants with sources, Svelte 5 runes via the shared `app` store). No new dependencies, no DB.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript, vitest (already configured: `npm test`), bespoke SVG charts.

**Spec:** `docs/superpowers/specs/2026-06-10-policy-engine-realignment-design.md`

**Conventions for every task:**
- Root: `/home/john/strange_rambling_svelte`; all paths below relative to `src/routes/projects/policy-engine/` unless prefixed.
- Type check: `NODE_OPTIONS=--max-old-space-size=8192 npm run check` (OOMs otherwise — see memory).
- Tests: `npm test -- policy-engine` (vitest run, filtered).
- Build/deploy must run with the Bash sandbox disabled (adapter-node step fails sandboxed).
- Each phase ends with the `/ship` skill (check → build → commit → deploy → verify live on strangeramblings.com).
- All prose written in BOTH narrative registers (research + ELI5) — follow the existing pattern (`app.narrative === 'eli5' ? … : …`).
- Visual language: existing `pe-*` classes, Fraunces/DM Sans/JetBrains Mono, paper palette (`--ink`, `--paper`), accent colours from `GROUP_META`.

---

## Phase A — Narrative realignment (deploy 1)

### Task A1: `lib/stories.ts` — Field Study mastheads data

**Files:** Create `lib/stories.ts`

- [ ] Create the module with this shape (full copy authored here, both registers):

```ts
// stories.ts — Field Study mastheads: each themed page declares its theme, driving
// question, thesis and "what data would we need to monitor this?" — the thread that
// ties every story back to the data-strategy purpose. Self-contained.

export interface Story {
  no: number;                 // Field Study number within the engine
  route: string;              // absolute href
  theme: string;              // one-line theme name
  question: string;           // the driving question (rendered as the h1)
  thesis: string;             // 1–2 sentence answer the page argues (research register)
  thesisEli5: string;         // same in plain English
  dataAsk: string[];          // bullets: what data we'd need to monitor this
}

export const STORIES: Record<string, Story> = {
  population: {
    no: 1, route: '/projects/policy-engine/population',
    theme: 'The human scale',
    question: 'What do these percentages mean in real children?',
    thesis: 'Rates hide magnitudes. Re-expressed as a synthetic cohort, a half-month change in the gap is tens of thousands of children — and, via LEO earnings linkage, a quantifiable lifetime economic return.',
    thesisEli5: 'Percentages hide how many real children are involved. This page turns every rate into actual kids — and into money the country gains or loses over their lifetimes.',
    dataAsk: [
      'Cohort-level linkage from school census through to earnings (LEO already proves this works at 38m-person scale)',
      'Per-pupil—not aggregate—outcome tracking so headcounts, not just rates, are first-class',
    ],
  },
  regions: {
    no: 2, route: '/projects/policy-engine/regions',
    theme: 'The geography of inequality',
    question: 'Where does the disadvantage gap actually live?',
    thesis: 'The national gap decomposes into very different regional stories — London\'s escape, the North East\'s age-5-to-16 decay, the hidden coastal penalty. Place, not just poverty, carries a residual.',
    thesisEli5: 'The rich–poor gap is not the same everywhere. London mostly beat it; the North East loses ground as children age; seaside towns are quietly worst off.',
    dataAsk: [
      'Sub-regional (LA / constituency) outcome series with consistent disadvantage definitions',
      'Region-aware destination measures — the same child tracked across a regional move',
    ],
  },
  global: {
    no: 3, route: '/projects/policy-engine/global',
    theme: 'England against the world',
    question: 'Is England\'s problem money, or how it\'s spent?',
    thesis: 'PISA 2022 and OECD spending data say money alone doesn\'t separate systems — equity does. England spends near the leaders but concentrates disadvantage harder than they do.',
    thesisEli5: 'Compared with other countries, England doesn\'t spend unusually little — but poorer children here fall further behind than in the best systems.',
    dataAsk: [
      'Internationally comparable equity metrics refreshed between PISA cycles',
      'Spend-per-stage accounting (OECD cumulative age-6–15 basis) rather than headline budgets',
    ],
  },
  monitor: {
    no: 4, route: '/projects/policy-engine/monitor',
    theme: 'The data spine',
    question: 'How would we know if any of this worked?',
    thesis: 'England\'s education data is rich but slow and siloed: a child\'s record fragments across census, attendance, NCCIS, ILR and LEO, and the feedback loop runs in years, not terms. Monitoring is a design choice.',
    thesisEli5: 'We only find out if a policy worked years later, because the data about each child is split across systems that don\'t talk to each other quickly.',
    dataAsk: [
      'A consistent child identifier across services (the CWS Act single unique identifier pilot)',
      'In-year feedback: the daily attendance feed shows near-real-time is possible — nothing equivalent exists post-16',
    ],
  },
  neet: {
    no: 5, route: '/projects/policy-engine/neet',
    theme: 'The early-warning system',
    question: 'A million young people are NEET. Could data have seen it coming?',
    thesis: 'The strongest NEET predictors — absence, EHCP, attainment — are visible in DfE\'s own data years before age 16. The question isn\'t whether to build early warning; it\'s whether to do it credibly: weighted, validated against LEO, governed in the open.',
    thesisEli5: 'Most young people who end up with no job or training showed warning signs at school years earlier — in data the government already collects. The hard part is using it fairly.',
    dataAsk: [
      'A nationally validated risk index (NERI-style weights, tested against LEO 5-year outcomes)',
      'Post-16 participation signal faster than annual returns — the age-18 tracking dark zone closed',
      'Published precision/recall for any deployed model (none exists in England today)',
    ],
  },
};
```

- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npm run check` → no new errors.
- [ ] Commit: `feat(policy-engine): field-study masthead data (stories.ts)`

### Task A2: `components/StoryMasthead.svelte`

**Files:** Create `components/StoryMasthead.svelte`

- [ ] Component contract: `let { story }: { story: Story }` (import type from `../lib/stories`). Renders:
  - kicker line: `FIELD STUDY №{no} · {theme}` (style: `pe-eyebrow` idiom, JetBrains Mono, letter-spaced)
  - `<h1 class="pe-h1">{story.question}</h1>`
  - thesis paragraph (`pe-lede`), switching on `app.narrative`
  - a `data-ask` box: heading `▸ TO MONITOR THIS, THE DEPARTMENT WOULD NEED` (mono, 10px) + `{#each story.dataAsk}` bullets; bordered left 3px `#4a7c7c`, background `rgba(74,124,124,0.07)`, radius 7px, padding 10px 14px; final line: small link `→ The data spine` to `/projects/policy-engine/monitor` (omit the link when `story.no === 4`, i.e. on monitor itself).
- [ ] Visual check via dev server (`http://homeserv:5173`) on one page after Task A3 wires it in.
- [ ] Commit with Task A3.

### Task A3: Wire mastheads, retitle the Briefing, regroup nav, fix route mode

**Files:**
- Modify `components/SectionNav.svelte` (FLOW, lines 6–15)
- Modify `+layout.svelte:21` (isDataRoute)
- Modify `outcomes/+page.svelte` (title block, lines 147–167)
- Modify `population/+page.svelte`, `regions/+page.svelte`, `global/+page.svelte`, `monitor/+page.svelte`, `neet/+page.svelte` (replace their existing eyebrow/h1/lede header block with `<StoryMasthead story={STORIES.<key>} />`; keep any page-specific intro prose below it)

- [ ] `SectionNav.svelte`: restructure FLOW into two groups and render a grouped nav:

```ts
const BRIEFING = [
  { href: '/projects/policy-engine', label: 'Overview' },
  { href: '/projects/policy-engine/outcomes', label: 'The Briefing' },
];
const STUDIES = [
  { href: '/projects/policy-engine/population', label: 'Population' },
  { href: '/projects/policy-engine/regions', label: 'Regions' },
  { href: '/projects/policy-engine/global', label: 'Global' },
  { href: '/projects/policy-engine/monitor', label: 'Monitoring' },
  { href: '/projects/policy-engine/neet', label: 'NEET' },
];
```

  Render: BRIEFING tabs · thin separator · tiny mono label `FIELD STUDIES` (hide ≤620px) · STUDIES tabs · existing dashed separator + Method tab unchanged.
- [ ] `+layout.svelte:21`: `isDataRoute` regex becomes `/\/(outcomes|population|regions)$/` (drop `neet` — field study, drawer must not auto-open).
- [ ] `outcomes/+page.svelte`: eyebrow → `The Briefing`; h1 → `State of the system`; rewrite the lede in both registers to frame it as the high-level DfE policy overview the field studies hang off (research: "the high-level readout across equity, attainment, SEND, system health and money — the do-nothing path against your scenario. Each Field Study that follows pulls one thread."). Update `<svelte:head><title>` on outcomes (and the five study pages while in them) to match new labels.
- [ ] Each study page: import `StoryMasthead` + `STORIES`, replace header block. Do NOT remove page-specific controls (e.g. Regions' selector) — masthead sits above them.
- [ ] Verify: dev server — drawer no longer auto-opens on `/neet`; nav shows grouping; all five mastheads render in both registers.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npm run check`
- [ ] Commit: `feat(policy-engine): Briefing + Field Studies realignment (nav, mastheads, route modes)`

### Task A4: Deploy Phase A

- [ ] Invoke `/ship` — full check → build → commit → deploy → verify `https://strangeramblings.com/projects/policy-engine` shows the new nav + a masthead.

---

## Phase B — UI improvements (deploy 2)

### Task B1: Scenario state clarity (`basePreset` + display name)

**Files:** Modify `lib/appState.svelte.ts`, `lib/scenarios.ts` (read first), `components/ScenarioSelector.svelte` (read first)

- [ ] Add to `AppState`:

```ts
basePreset = $state<string | null>(null);   // the preset the user started from (survives edits)
```

  - `applyPreset(p)`: set `this.basePreset = p.optimize ? null : p.name`.
  - `resetAll()` / `loadSavedScenario()` / `applyOptimized()`: set `basePreset = null` (saved scenario name already shown via `matchedSaved`).
  - New derived `changedFromBase`: when `basePreset` is set and levers ≠ preset levers, the list of `{ id, value, baseValue }` for levers differing from that preset; when no basePreset, diff vs `policyLevers()`. Cap display later at full list (≤35).
  - `scenarioName` fallback chain gains a step: if `basePreset` set and `changedFromBase.length > 0` → `` `${basePreset} +${changedFromBase.length} change${s}` ``; ELI5 display name mirrors it using the preset's `eli5Name`.
  - Add `resetToBase()`: if `basePreset`, re-apply that preset's levers.
- [ ] UI: in `LeverDrawer` scenario area, when `changedFromBase.length > 0` show a small `↺ back to {basePreset}` button calling `resetToBase()`.
- [ ] Persist `basePreset` in the same localStorage write path as levers (extend the STORAGE JSON to `{ levers, basePreset }`, with backward-compat parse: if parsed object has no `levers` key, treat the whole object as levers).
- [ ] Run check; manual test: apply preset → move slider → name shows "+1 change" → reset returns.
- [ ] Commit: `feat(policy-engine): preset+modifications scenario model`

### Task B2: `components/CompareDiffStrip.svelte`

**Files:** Create `components/CompareDiffStrip.svelte`; modify `outcomes/+page.svelte` (render above themes when `app.compareB`); read `components/CompareReadout.svelte` first — if it already does ≥80% of this, extend it instead of creating a new component.

- [ ] Contract: no props; reads `app`. At `app.horizon`, for the four KPIs `gapKS4` (months, lower better), `attainment8` (pts), `neet` (pp), `cumulativeCost` (£bn): compute A−B deltas from `app.viewSim` / `app.viewSimB`; render one compact strip: `B vs A: gap −0.4mo · A8 +0.3 · NEET −0.5pp · cost +£2.1bn`, colour-coded by direction-goodness (use `OUTCOMES_BY_ID[k].goodIfUp`). Include swap/clear buttons mirroring layout controls.
- [ ] Commit: `feat(policy-engine): compare difference strip`

### Task B3: Peek drawer

**Files:** Modify `lib/appState.svelte.ts`, `+layout.svelte` (shell grid + side), `components/LeverDrawer.svelte` (unchanged), create `components/PeekRail.svelte`

- [ ] `AppState`: replace boolean with mode while keeping the old API working:

```ts
drawerMode = $state<'closed' | 'peek' | 'full'>('closed');
get drawerOpen() { return this.drawerMode === 'full'; }   // existing readers keep working
toggleDrawer() { this.drawerMode = this.drawerMode === 'full' ? 'peek' : 'full'; this.drawerUserSet = true; }
openDrawer() { this.drawerMode = 'full'; this.drawerUserSet = true; }
closeDrawer() { this.drawerMode = 'closed'; this.drawerUserSet = true; }
```

  Route default effect in `+layout.svelte:40` becomes: data routes → `'peek'` unless user-set; non-data routes → `'closed'` unless user-set. Persist `drawerMode` choice in localStorage (`epm-drawer-mode`).
- [ ] `+layout.svelte` shell: `grid-template-columns:` 46px (closed) / 132px (peek) / 348px (full); `.side` content: `{#if app.drawerMode === 'full'}<LeverDrawer/>{:else if app.drawerMode === 'peek'}<PeekRail/>{:else}spine button{/if}`. Spine click → `'peek'`; mobile (<900px) unchanged: only closed/full (overlay), peek treated as closed.
- [ ] `PeekRail.svelte`: vertical strip showing (top→bottom) an expand button (→ full), the scenario display name (vertical text or wrapped 11px), changed-lever chips from `app.changedFromBase` — each chip: lever short name + formatted value, click → `app.focusLever(id)` (which now sets mode `'full'`); a `+N more` overflow beyond 8 chips; a collapse button (→ closed).
- [ ] Run check; manual test all three states + mobile overlay.
- [ ] Commit: `feat(policy-engine): three-state lever drawer with peek rail`

### Task B4: Finish half-wired interactions

**Files:** Modify `components/LeverRail.svelte`, `+layout.svelte` (uncertainty button), `components/LeverDrawer.svelte` (export/import area)

- [ ] **focusLever flash** in `LeverRail.svelte`: rows already exist per lever; add `data-lever-id` attr; add:

```ts
$effect(() => {
  const id = app.highlightLever;
  if (!id) return;
  const el = host?.querySelector(`[data-lever-id="${id}"]`) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => { el.classList.remove('flash'); app.highlightLever = null; }, 1600);
  } else { app.highlightLever = null; }
});
```

  with `.flash { animation: leverFlash 1.6s ease; } @keyframes leverFlash { 0%,60% { background: rgba(47,111,151,0.18); box-shadow: inset 3px 0 0 #2f6f97; } 100% { background: transparent; } }`. If the lever's group is collapsed/search-filtered, clear the search and expand first (check the rail's existing group/search state when editing). Also ensure search match works: `focusLever` chips on the Briefing already call this.
- [ ] **Monte Carlo explainer**: the Uncertainty button (`+layout.svelte:103`) gets `title="110-draw Monte Carlo across every effect-size band plus a shared structural multiplier; shaded fan = P10–P90."` and a one-line footnote appears once under the first banded chart on the Briefing (`outcomes/+page.svelte`, small mono caption, both registers).
- [ ] **Export/import polish** in `LeverDrawer.svelte`: under the buttons add 10px mono hint `JSON: { "levers": { "<lever-id>": value } }`; on successful import show a transient `✓ imported` (1.7s, same pattern as copyLink's `copied`).
- [ ] Commit: `feat(policy-engine): lever flash, MC explainer, import feedback`

### Task B5: ELI5 coverage on Global

**Files:** Modify `global/+page.svelte` (read first)

- [ ] Audit every prose block on the page for an ELI5 variant; add missing ones (tone-matched to existing examples — plain words, no acronyms, keep numbers). Chart titles: add ELI5 mappings consistent with `CHART_ELI5_TITLE` idiom if that page hardcodes titles.
- [ ] Commit: `feat(policy-engine): complete ELI5 coverage on Global`

### Task B6: Chart resize debounce + mobile scenebar

**Files:** Modify `components/OutcomeChart.svelte` (ResizeObserver, ~L40–45), `+layout.svelte` (scenebar CSS + markup)

- [ ] Debounce: wrap the ResizeObserver callback body in a trailing 80ms timeout (clear pending on each call; `onDestroy` clears). The drawer-toggle reflow then costs one settled re-render.
- [ ] Mobile scenebar: at ≤700px wrap `.controls` in a `<details class="ctrl-disclosure"><summary>⚙ Scenario controls</summary>…</details>` (CSS: summary styled as a `cbtn`; ≥701px the `details` is forced open via `details[open]`-independent CSS — simplest: duplicate container styles with a media query so desktop renders controls inline and mobile collapses; implement with one `details` element styled `display:contents` on desktop and collapsed on mobile).
- [ ] Verify on dev server with devtools mobile emulation: sticky stack ≤2 rows on a 390px viewport.
- [ ] Commit: `feat(policy-engine): chart resize debounce + mobile scenario disclosure`

### Task B7: `components/StorySection.svelte` + co-visible Briefing layout

**Files:** Create `components/StorySection.svelte`; modify `outcomes/+page.svelte` theme loop (lines 173–196) + styles

- [ ] `StorySection.svelte` contract (Svelte 5 snippets):

```svelte
<script lang="ts">
  let { title, prose, data }: { title: string; prose: Snippet; data: Snippet } = $props();
</script>
<section class="ss">
  <div class="ss-prose"><h2 class="pe-h2">{title}</h2>{@render prose()}</div>
  <div class="ss-data">{@render data()}</div>
</section>
<style>
  .ss { display: grid; grid-template-columns: minmax(280px, 38ch) minmax(0, 1fr); gap: 24px 36px; margin: 30px 0; align-items: start; }
  .ss-prose { position: sticky; top: calc(var(--topH, 0px) + 56px); }
  @media (max-width: 1099px) { .ss { grid-template-columns: 1fr; } .ss-prose { position: static; } }
</style>
```

  (56px ≈ section-nav height; verify against the real `--topH` cascade in dev and adjust — the secnav is sticky below topH so the prose must clear both.)
- [ ] `outcomes/+page.svelte`: replace the `<section class="theme">` blocks with `StorySection` — prose snippet = theme prose + (new, small) per-theme "key shifts at {horizon}" line if trivial to derive, else just prose; data snippet = existing `.grid` of chart cells unchanged. The chart grid inside the data column should drop to `minmax(min(300px,100%),1fr)` so two columns still fit beside the prose at 1440px.
- [ ] Kill conflicting `pe-prose.cols` usage on this page (charts no longer below the prose).
- [ ] Verify desktop ≥1100px: prose stays pinned while that theme's charts scroll; mobile: stacked as before.
- [ ] Commit: `feat(policy-engine): co-visible prose+data Briefing layout`

### Task B8: Deploy Phase B

- [ ] `/ship`; verify live: peek rail, co-visible Briefing, hint-chip flash.

---

## Phase C — NEET model deepening (deploy 3)

### Task C1: Params + types for segments and pipeline

**Files:** Modify `lib/params.ts`, `lib/types.ts`, `lib/montecarlo.ts` (MC_KEYS)

- [ ] `params.ts` — extend BASELINE and add two new blocks (place after POST16):

```ts
// In BASELINE (keep neet: 13.3 as the headline anchor) add:
  // NEET composition, England 2025 (ONS Jan–Mar 2026 splits applied to the DfE England rate):
  // unemployed-active 39% · inactive-health 28% · inactive-other 33%  [ONS NEET May 2026; RF False Starts]
  neetUnemployed: 5.19, neetInactiveHealth: 3.72, neetInactiveOther: 4.39,
```

```ts
// ---------------------------------------------------------------------------
// NEET segment dynamics. The single NEET scalar is decomposed into three stocks
// with different drivers and stickiness [ONS May 2026; Milburn interim 2026;
// Resolution Foundation False Starts 2025 / Lost in Transition 2026].
// ---------------------------------------------------------------------------
export const NEETSEG = {
  // share of the attainment elasticity (SYS.neetPerA8) landing on each segment —
  // qualifications move employability (U) most, health-driven inactivity least
  a8Share: { unemployed: 0.6, other: 0.3, health: 0.1 },
  // share of the upstream pipeline pressure landing on each segment
  pipeShare: { unemployed: 0.45, other: 0.35, health: 0.20 },
  // health-segment stickiness: 8 in 10 health-inactive NEETs still NEET 2+ yrs later
  // (Milburn) — modelled as slower lever response (longer effective lag) on that stock
  healthLag: 4,
};

// Upstream pipeline pressure: pp of headline NEET per unit deviation of the modelled
// mediators, derived from DfE "Risk factors for becoming NEET" (May 2026) relative
// risks (PA 3.9×; EHCP ~⅓ NEET at 17–19; FSM/poverty ~2×) scaled by cohort shares.
// Associational, not causal — confidence: medium. Acts with the stock-turnover lag.
export const NEETPIPE = {
  absenceK: band(0.05, 0.11, 0.20),   // pp NEET per pp disadvantaged persistent absence above 29.9
  povertyK: band(0.02, 0.05, 0.10),   // pp NEET per pp child poverty above 31.0
  ehcpK:    band(0.10, 0.30, 0.60),   // pp NEET per pp EHCP prevalence above 5.3 (composition pressure)
  lag: 4,                              // years for school-cohort pressure to propagate into the 16–24 stock
};
```

- [ ] `POST16` adjustments + additions (document the re-scope inline):

```ts
export const POST16 = {
  // post16_skills RE-SCOPED 2026-06: Youth Guarantee + apprenticeships are now their own
  // levers, so this is T/V-levels + Skills England + study-programme quality only.
  neetMax: band(0.3, 0.8, 1.5),          // was (0.5, 1.2, 2.2) — see youth_guarantee/apprenticeships
  mhNeetMax: band(0.4, 1.0, 1.8),
  mhDriftMitig: band(0.3, 0.55, 0.8),
  mhSevereMax: band(0.2, 0.6, 1.2),
  // NEW LEVERS (effects land on segments, see engine):
  youthGuaranteeMax: band(0.3, 0.8, 1.5),   // pp off unemployed-NEET at full rollout [Youth Contract +1.8pp re-engagement; £820m + 18–24 Jobs Guarantee; confidence low–medium]
  careersMax: band(0.2, 0.7, 1.4),          // pp off NEET inflow at full Gatsby coverage [CEC/Gatsby −8% NEET likelihood, −20% disadvantaged; CORRELATIONAL]
  apprenticeshipsMax: band(0.2, 0.8, 1.8),  // pp off unemployed-NEET at full 16–24 start recovery [YFF toolkit: high impact / LOW evidence security — wide band]
  post16PremiumMax: band(0.1, 0.5, 1.0),    // pp off NEET (U+O) via post-16 retention [EPI 16–19 premium proposal; disadvantage funding stops at 16]
};
```

- [ ] Reduce `SYS.neetPerA8` central to avoid double counting with the new absence pipeline term (absence acts on NEET both via attainment and now directly): `neetPerA8: band(0.10, 0.25, 0.45)` with a comment `// reduced from (0.15,0.35,0.6) when NEETPIPE.absenceK added — overlap haircut`.
- [ ] `types.ts` `YearResult`: after `neet: number;` add:

```ts
  neetUnemployed: number;      // % 16-24, unemployed-active segment (cyclical)
  neetInactiveHealth: number;  // % 16-24, inactive-health segment (sticky; Milburn fault line)
  neetInactiveOther: number;   // % 16-24, inactive-other (caring/discouraged)
```

- [ ] `montecarlo.ts` MC_KEYS: append `'neetInactiveHealth'` (the segment with the live policy debate; headline `neet` already present — keep MC cost bounded, don't add all three).
- [ ] Run check (engine will error until C2 — acceptable mid-task; do C1+C2 in one commit).

### Task C2: Engine — 3-segment NEET stock + pipeline (TDD)

**Files:** Create `lib/engine.neet.test.ts`; modify `lib/engine.ts` (replace lines 291–304, the NEET block; extend `years.push`)

- [ ] **Write the failing tests first** (`lib/engine.neet.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { runSim } from './engine';
import { baselineLevers, policyLevers, LEVERS_BY_ID } from './levers';
import { BASELINE } from './params';

const at = (years: ReturnType<typeof runSim>['years'], y: number) => years.find((r) => r.year === y)!;
const maxed = (base: Record<string, number>, id: string) => ({ ...base, [id]: LEVERS_BY_ID[id].max });

describe('NEET segments', () => {
  it('segments sum to the headline in every year', () => {
    for (const levers of [baselineLevers(), policyLevers()]) {
      for (const y of runSim(levers).years) {
        expect(y.neetUnemployed + y.neetInactiveHealth + y.neetInactiveOther).toBeCloseTo(y.neet, 6);
      }
    }
  });
  it('reproduces the 2025 baseline composition', () => {
    const y0 = at(runSim(baselineLevers()).years, 2025);
    expect(y0.neet).toBeCloseTo(BASELINE.neet, 6);
    expect(y0.neetUnemployed).toBeCloseTo(BASELINE.neetUnemployed, 6);
    expect(y0.neetInactiveHealth).toBeCloseTo(BASELINE.neetInactiveHealth, 6);
    expect(y0.neetInactiveOther).toBeCloseTo(BASELINE.neetInactiveOther, 6);
  });
  it('mental health acts on the health segment, youth guarantee on the unemployed segment', () => {
    const base = at(runSim(baselineLevers()).years, 2035);
    const mh = at(runSim(maxed(baselineLevers(), 'mental_health')).years, 2035);
    const yg = at(runSim(maxed(baselineLevers(), 'youth_guarantee')).years, 2035);
    expect(base.neetInactiveHealth - mh.neetInactiveHealth)
      .toBeGreaterThan(base.neetUnemployed - mh.neetUnemployed);
    expect(base.neetUnemployed - yg.neetUnemployed).toBeGreaterThan(0.3);
    expect(Math.abs(base.neetInactiveHealth - yg.neetInactiveHealth)).toBeLessThan(0.05);
  });
  it('worse upstream absence raises NEET via the pipeline', () => {
    const worse = maxed(baselineLevers(), 'housing_instability'); // raises disadvantaged PA
    expect(at(runSim(worse).years, 2035).neet)
      .toBeGreaterThan(at(runSim(baselineLevers()).years, 2035).neet);
  });
  it('new levers carry cost', () => {
    for (const id of ['youth_guarantee', 'careers_gatsby', 'apprenticeships', 'post16_premium']) {
      const sim = runSim(maxed(baselineLevers(), id));
      expect(at(sim.years, 2030).cumulativeCost).toBeGreaterThan(0);
    }
  });
});
```

- [ ] `npm test -- engine.neet` → FAILS (fields/levers missing).
- [ ] **Implementation** — replace the NEET block in `engine.ts` (current L291–304) with:

```ts
    // ---------------- NEET (post-16 exit boundary), 3 segments ----------------
    // U = unemployed-active (cyclical) · IH = inactive-health (sticky; Milburn
    // "generational fault line") · IO = inactive-other (caring/discouraged).
    // Headline = sum. Sources: ONS May 2026 composition; DfE risk-factors May 2026.
    const mhDriftMitig = R(POST16.mhDriftMitig) * concave(depPos('mental_health')) * ramp(ys, 3);
    // upstream pipeline pressure (pp on headline NEET) from the modelled mediators
    const pipe = (R(NEETPIPE.absenceK) * (persistentAbsenceDis - PA_DIS_BASE)
      + R(NEETPIPE.povertyK) * (childPoverty - BASELINE.childPoverty)
      + R(NEETPIPE.ehcpK) * (ehcpPct - BASELINE.ehcpPct)) * ramp(ys, NEETPIPE.lag);
    const a8Effect = R(SYS.neetPerA8) * (attainment8 - BASELINE.attainment8) + 0.08 * structReductionsK4;
    const careersCut = R(POST16.careersMax) * concave(depPos('careers_gatsby')) * ramp(ys, 3);

    const neetUnemployed = clamp(
      BASELINE.neetUnemployed
        + NEETSEG.pipeShare.unemployed * pipe - NEETSEG.a8Share.unemployed * a8Effect
        - 0.6 * careersCut
        - R(POST16.neetMax) * concave(depPos('post16_skills')) * ramp(ys, 2)
        - R(POST16.youthGuaranteeMax) * concave(depPos('youth_guarantee')) * ramp(ys, 2)
        - R(POST16.apprenticeshipsMax) * concave(depPos('apprenticeships')) * ramp(ys, 3)
        - 0.5 * R(POST16.post16PremiumMax) * concave(depPos('post16_premium')) * ramp(ys, 3)
        - 0.6 * R(IND.behaviourNeet) * concave(depPos('behaviour_support')) * ramp(ys, 2)
        - R(IND.placeNeet) * concave(depPos('place_investment')) * ramp(ys, 2)
        - 0.5 * R(IND.careNeet) * concave(depPos('care_support')) * ramp(ys, 2),
      1.5, 10,
    );
    const neetInactiveHealth = clamp(
      BASELINE.neetInactiveHealth
        + R(SYS.youthIllHealthDrift) * (1 - mhDriftMitig) * ys
        + NEETSEG.pipeShare.health * pipe - NEETSEG.a8Share.health * a8Effect
        - 0.1 * careersCut
        - R(POST16.mhNeetMax) * concave(depPos('mental_health')) * ramp(ys, NEETSEG.healthLag)
        - R(IND.camhsNeet) * concave(depPos('camhs')) * ramp(ys, NEETSEG.healthLag),
      1.0, 12,
    );
    const neetInactiveOther = clamp(
      BASELINE.neetInactiveOther
        + NEETSEG.pipeShare.other * pipe - NEETSEG.a8Share.other * a8Effect
        - 0.3 * careersCut
        - 0.5 * R(POST16.post16PremiumMax) * concave(depPos('post16_premium')) * ramp(ys, 3)
        - 0.4 * R(IND.behaviourNeet) * concave(depPos('behaviour_support')) * ramp(ys, 2)
        - 0.5 * R(IND.careNeet) * concave(depPos('care_support')) * ramp(ys, 2),
      1.5, 9,
    );
    const neet = clamp(neetUnemployed + neetInactiveHealth + neetInactiveOther, 5, 25);
```

  Import `NEETSEG, NEETPIPE` from params. Add the three segment fields to `years.push`. NOTE the existing single-equation lever coefficients (careNeet, behaviourNeet) are now split across segments with fractional weights summing to ~1.0 of the old effect — preserve total magnitudes.
- [ ] Add to the cost block:

```ts
      + Math.max(0, val('youth_guarantee') - 15) / 85 * COST.youthGuaranteeFullBn
      + Math.max(0, val('careers_gatsby') - 35) / 65 * COST.careersFullBn
      + Math.max(0, val('apprenticeships') - 30) / 70 * COST.apprenticeshipsFullBn
      + val('post16_premium') * COST.post16PremiumPerPound
```

  and to `COST` in params: `youthGuaranteeFullBn: 1.2,` `careersFullBn: 0.3,` `apprenticeshipsFullBn: 1.0,` `post16PremiumPerPound: 0.43e6 / 1e9,` (≈0.43m disadvantaged 16–18s × £1 — comment with IFS/EPI sourcing).
- [ ] Tests still fail until C3 adds the levers → do C3 before running.

### Task C3: New lever definitions + metadata

**Files:** Modify `lib/levers.ts` (LEVERS, LEVER_META, LEVER_ELI5_NAME), `lib/outcomes.ts` (OUTCOMES + ELI5 maps), `outcomes/+page.svelte` (KEY_LEVERS.neet)

- [ ] Insert into `LEVERS` after `mental_health` (group `post16` — full defs; evidence text from the research dossier with sources):

```ts
  {
    id: 'youth_guarantee', group: 'post16', label: 'Youth Guarantee & Jobs Guarantee', unit: '%',
    min: 0, max: 100, step: 5, baseline: 15, policy: 60,
    blurb: 'Rollout of the Youth Guarantee (18–21) and the paid 6-month Jobs Guarantee for young people on Universal Credit — keyworker-led, employer-proximate re-engagement.',
    evidence: 'Eight trailblazers (£45m, 2025/26) extended to 2027; £820m over 2026/27–28/29 plus a Jobs Guarantee for 18–24s. Closest evaluated analogue: the 2012–14 Youth Contract keyworker model produced ≈+1.8pp re-engagement. Work-based, individualised offers are the best-evidenced family (YFF toolkit) — but national-scale effects are unproven.',
    source: 'Commons Library CBP-10827; IES Youth Contract evaluation; YFF toolkit', url: 'https://commonslibrary.parliament.uk/research-briefings/cbp-10827/',
    confidence: 'low', policyRef: 'Get Britain Working / Youth Guarantee (Autumn Budget 2025)',
  },
  {
    id: 'careers_gatsby', group: 'post16', label: 'Careers provision (Gatsby coverage)', unit: '% schools',
    min: 0, max: 100, step: 5, baseline: 35, policy: 60,
    blurb: 'Share of schools/colleges achieving all 8 Gatsby career-guidance benchmarks (Careers & Enterprise Company infrastructure).',
    evidence: 'Schools achieving all 8 benchmarks see students ~8% less likely to be NEET at 16/18 — rising to ~20% in the most disadvantaged schools; CEC estimates ~6,000 NEETs/yr prevented. CORRELATIONAL destination-data analysis, not an RCT — benchmark attainment tracks well-run schools, so the band is wide and the confidence low.',
    source: 'Gatsby Foundation / CEC destination analyses', url: 'https://www.gatsbybenchmarks.org.uk/news/good-career-guidance-prevents-6000-young-people-becoming-neet-each-year/',
    confidence: 'low', policyRef: 'Gatsby Benchmarks / CEC careers hubs',
  },
  {
    id: 'apprenticeships', group: 'post16', label: '16–24 apprenticeship recovery', unit: 'index',
    min: 0, max: 100, step: 5, baseline: 30, policy: 60,
    blurb: 'Recovery of young-apprenticeship starts (down ~40% since the levy) — SME full funding for 16–24s from April 2026, foundation apprenticeships.',
    evidence: 'YFF toolkit rates apprenticeships the HIGHEST-IMPACT youth-employment intervention — but with LOW evidence security (largely international studies), so the modelled band is deliberately wide. Under-25 starts fell ~40% post-levy; full SME funding for 16–24s begins April 2026.',
    source: 'Youth Futures Foundation Youth Employment Toolkit; CIPD levy analysis', url: 'https://youthfuturesfoundation.org/toolkit/',
    confidence: 'low', policyRef: 'Apprenticeship funding reform (April 2026)',
  },
```

  and into group `disadvantage` after `poverty_action`:

```ts
  {
    id: 'post16_premium', group: 'disadvantage', label: '16–19 student premium', unit: '£/student',
    min: 0, max: 1000, step: 50, baseline: 0, policy: 0, format: (v) => fmtGBP(v),
    blurb: 'A disadvantage premium following the student past 16 — today, Pupil-Premium-style funding stops dead at GCSEs (EPI\'s headline NEET recommendation; not current policy).',
    evidence: '16–18 funding is ~8% below 2010 in colleges and ~20% below in school sixth forms (IFS), and disadvantage funding largely ends at 16 even though the NEET cliff is at 16–18. EPI proposes a 16–19 premium as the single most direct funding fix. No causal estimate exists — modelled via post-16 retention with a wide band.',
    source: 'EPI "Five charts" 2025; IFS education spending 2025–26', url: 'https://epi.org.uk/publications-and-research/five-charts-that-explain-the-rise-in-neet-rates/',
    confidence: 'low', policyRef: 'EPI proposal (not announced policy)',
  },
```

- [ ] Re-scope `post16_skills` blurb/evidence: remove "Youth Guarantee" claims (now its own lever); note the re-scope in its evidence line ("Youth Guarantee and apprenticeships are modelled separately").
- [ ] `LEVER_META` additions:

```ts
  youth_guarantee: { drives: ['neet'], modelNote: 'Acts on the UNEMPLOYED-active NEET segment (keyworker re-engagement); no effect on the health-driven segment — careers fairs don\'t fix CAMHS waiting lists.' },
  careers_gatsby:  { drives: ['neet'], modelNote: 'Cuts NEET inflow across segments (60/30/10 unemployed/other/health) — correlational evidence, wide band.' },
  apprenticeships: { drives: ['neet'], modelNote: 'Unemployed-segment lever: the highest-impact, lowest-certainty intervention in the YFF evidence — the band is honest about that.' },
  post16_premium:  { drives: ['neet'], modelNote: 'Funds post-16 retention, reducing inflow to the unemployed and inactive-other segments. A proposal, not policy — baseline and announced-policy are both £0.' },
```

- [ ] `LEVER_ELI5_NAME` additions: `youth_guarantee: 'Guaranteed work or training for young people'`, `careers_gatsby: 'Proper careers advice in every school'`, `apprenticeships: 'More apprenticeships for under-25s'`, `post16_premium: 'Extra money for poorer sixth-formers'`.
- [ ] `lib/outcomes.ts`: add three OUTCOMES entries (group `system`, goodIfUp false, dp 1) for `neetUnemployed` ('NEET — unemployed'), `neetInactiveHealth` ('NEET — inactive, health'), `neetInactiveOther` ('NEET — inactive, other'), each with a one-line blurb naming its drivers; add ELI5 labels ('Looking for work but can\'t find it' / 'Too unwell to work or study' / 'Out for other reasons (caring etc.)') and ELI5 tooltips.
- [ ] `outcomes/+page.svelte` `KEY_LEVERS.neet` → `['youth_guarantee', 'mental_health', 'apprenticeships', 'careers_gatsby', 'post16_premium']`.
- [ ] `npm test -- engine.neet` → ALL PASS. Also run the full suite `npm test` (no regressions) + check.
- [ ] Manual sanity on dev: scorecard NEET at policy defaults lands ≈12–13% at 2040 (not pinned at a clamp); sensitivity tornado for `neet` ranks mental_health/youth_guarantee near the top.
- [ ] Commit: `feat(policy-engine): 3-segment NEET stock, evidence pipeline, 4 new post-16 levers`

### Task C4: NEET economics

**Files:** Read then modify `lib/economics.ts`, `components/CostPanel.svelte`, `components/PopulationPanel.svelte` (or `lib/population.ts` where the econ grid rows are computed)

- [ ] `economics.ts` additions:

```ts
// NEET economics. Two anchors, used as a LOW–HIGH range, never a point estimate:
//  • York/Audit Commission (Coles et al. 2010): lifetime public-finance ~£56k,
//    resource cost ~£104k per NEET young person (2010 prices — conservative anchor).
//  • Milburn interim review (2026): lifetime earnings loss up to £300k per person;
//    aggregate "cost to the country" £125bn/yr — an upper bound, quote only in prose.
export const NEET_ECON = {
  perPersonLifetimeLow: 104_000,   // resource cost, 2010 prices (uprated note in UI)
  perPersonLifetimeHigh: 300_000,  // Milburn earnings-scarring upper bound
  source: 'Coles et al. (2010, University of York); Milburn interim review (2026)',
};
/** Headcount of 16–24s moved out of NEET at the horizon, from a pp change. */
export function neetHeadcountAvoided(ppReduction: number, youthPopM: number): number {
  return Math.max(0, ppReduction / 100) * youthPopM * 1e6;
}
```

- [ ] `CostPanel.svelte`: add a value row `cost per NEET-year avoided` = cumulative cost share attributable…  — keep it simple and honest: total scenario `cumulativeCost` ÷ Σ annual NEET-headcount reduction vs baseline over the horizon (label it "whole-package cost per NEET-year avoided" with a footnote that the package buys other outcomes too). Skip if NEET reduction ≤ 0 (show "—").
- [ ] Population econ grid: add a NEET line — headcount avoided at horizon × the £104k–£300k range, displayed as a low–high span with the standard "associational, not causal" caveat styling used by the existing LEO rows.
- [ ] Check + visual verify; commit: `feat(policy-engine): NEET economics (scarring range, cost per NEET-year avoided)`

### Task C5: Method page + sources for the new model

**Files:** Modify `components/Methodology.svelte` (read first), `lib/sources.ts`, `components/CausalFlow.svelte` (read first)

- [ ] Methodology: add a "NEET segments & pipeline" equation entry following the established equation-card pattern: the three segment equations in compact notation + the pipeline term, with the assumption notes (composition split source, overlap haircut on neetPerA8, associational pipeline). Both registers.
- [ ] CausalFlow: update the NEET node to show three sub-stocks fed by an arrow from absence/poverty/SEND ("pipeline") — if the SVG layout makes this heavy, an acceptable minimum is relabelling the NEET node to "NEET (3 segments)" and adding one pipeline arrow from the absence node.
- [ ] `sources.ts`: append entries (org/what/url) for: ONS NEET bulletin (May 2026), DfE *Risk factors for becoming NEET* (May 2026), Milburn interim review (2026), Resolution Foundation *False Starts* (2025) + *Lost in Transition* (2026), YFF Youth Employment Toolkit, Gatsby/CEC destination analyses, IES Youth Contract evaluation, Commons Library CBP-10827, Coles et al. 2010, Impetus Youth Jobs Gap.
- [ ] Lever cards on Method need no work (generated from LEVERS — verify the four new cards render with confidence badges).
- [ ] Check; commit: `docs(policy-engine): method page + sources for NEET segments`

### Task C6: Briefing NEET composition chart

**Files:** Modify `outcomes/+page.svelte` (system theme)

- [ ] Extend the system theme: the NEET chart gains the three segment series alongside the headline (headline emphasized + banded; segments as thinner solid lines — colours: U `#2f6f97`, IH `#7a5aa6`, IO `#9a7b1f`); update the theme prose (both registers) to introduce the segmentation ("61% of today's NEETs are inactive, not unemployed — and the health-driven slice responds to different levers"). HISTORY has no segment series — segments render projection-only via `proj()`, which already pads history with NaN.
- [ ] Verify in dev (hover readouts, compare mode falls back to headline-only — the compare mapping uses `CHART_PRIMARY`, untouched).
- [ ] Commit: `feat(policy-engine): NEET segment composition on the Briefing`

### Task C7: Deploy Phase C

- [ ] `/ship`; verify live: new levers in the drawer, segments on the Briefing NEET chart, Method cards.

---

## Phase D — NEET intelligence story + measurement layer (deploy 4)

### Task D1: `lib/triage.ts` (TDD) — calibrated synthetic-cohort triage model

**Files:** Create `lib/triage.ts`, `lib/triage.test.ts`

- [ ] **Tests first** (`lib/triage.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { STRATA, residualRR, triageCurve, triageAt, COHORT_BASE_RATE } from './triage';

describe('triage cohort', () => {
  it('strata shares sum to 1 and residual RR is sane', () => {
    const total = STRATA.reduce((s, x) => s + x.share, 0);
    expect(total).toBeCloseTo(1, 6);
    const rr = residualRR();
    expect(rr).toBeGreaterThan(0.3);
    expect(rr).toBeLessThan(1);
  });
  it('weighted mean relative risk is 1 (the cohort reproduces the base rate)', () => {
    const mean = STRATA.reduce((s, x) => s + x.share * (x.rr ? x.rr.central : residualRR()), 0);
    expect(mean).toBeCloseTo(1, 6);
  });
});

describe('triage operating points', () => {
  it('recall rises and precision falls (weakly) as the flag rate rises', () => {
    let lastRecall = 0, lastPrecision = 1;
    for (const flagPct of [2, 5, 10, 20, 40]) {
      const p = triageAt(flagPct, 'weighted');
      expect(p.recall).toBeGreaterThan(lastRecall);
      expect(p.precision).toBeLessThanOrEqual(lastPrecision + 1e-9);
      lastRecall = p.recall; lastPrecision = p.precision;
    }
  });
  it('flagging everyone gives recall 1 at base-rate precision', () => {
    const p = triageAt(100, 'weighted');
    expect(p.recall).toBeCloseTo(1, 6);
    expect(p.precision).toBeCloseTo(COHORT_BASE_RATE, 6);
  });
  it('the weighted index dominates the checklist', () => {
    for (const flagPct of [5, 10, 20]) {
      expect(triageAt(flagPct, 'weighted').recall)
        .toBeGreaterThanOrEqual(triageAt(flagPct, 'checklist').recall - 1e-9);
    }
  });
  it('uncertainty bands bracket the central estimate', () => {
    const c = triageCurve('weighted', 200);
    const i = c.flagPct.indexOf(10);
    expect(c.recallP10[i]).toBeLessThanOrEqual(c.recall[i]);
    expect(c.recallP90[i]).toBeGreaterThanOrEqual(c.recall[i]);
  });
});
```

- [ ] `npm test -- triage` → FAILS (module missing).
- [ ] **Implementation** `lib/triage.ts` — core design:

```ts
// triage.ts — a SYNTHETIC Year-11 cohort triage model, calibrated to PUBLISHED
// relative risks (DfE "Risk factors for becoming NEET" May 2026; Impetus Youth Jobs
// Gap compound-disadvantage; NatCen/YFF RONI research). Demonstrates the recall /
// precision / caseload trade-off of risk flagging. ASSOCIATIONAL multipliers on an
// APPROXIMATED overlap structure — a strategy demonstrator, NOT a deployable tool.

import type { Band } from './params';
import { band } from './params';

export const COHORT_SIZE = 600_000;       // one England year group
export const COHORT_BASE_RATE = 0.12;     // P(NEET at 17–19) for the cohort  [DfE risk-factors]

export interface Stratum {
  id: string; label: string; eli5: string;
  share: number;            // fraction of the cohort (mutually exclusive strata)
  rr: Band | null;          // relative risk vs cohort average; null = residual (computed)
  checklistPoints: number;  // unweighted RONI-style points (drives the checklist ordering)
}

export const STRATA: Stratum[] = [
  { id: 'care',      label: 'Care experience',                      eli5: 'Grew up in care',                    share: 0.012, rr: band(2.5, 3.0, 3.5), checklistPoints: 3 },
  { id: 'ehcp',      label: 'EHCP',                                  eli5: 'Has a legal special-needs plan',     share: 0.045, rr: band(2.3, 2.7, 3.1), checklistPoints: 2 },
  { id: 'compound',  label: 'FSM + SEN support + low attainment',    eli5: 'Poor, extra needs and low grades',   share: 0.060, rr: band(2.4, 2.8, 3.2), checklistPoints: 4 },
  { id: 'pa_fsm',    label: 'Persistent absence + FSM',              eli5: 'Poor and missing lots of school',    share: 0.080, rr: band(2.2, 2.6, 3.0), checklistPoints: 3 },
  { id: 'pa',        label: 'Persistent absence only',               eli5: 'Missing lots of school',             share: 0.090, rr: band(1.8, 2.2, 2.6), checklistPoints: 1 },
  { id: 'lowatt',    label: 'Below Level 2 only',                    eli5: 'Low grades only',                    share: 0.100, rr: band(1.6, 1.9, 2.2), checklistPoints: 1 },
  { id: 'fsm',       label: 'FSM only',                              eli5: 'From a poor family only',            share: 0.140, rr: band(1.4, 1.7, 2.0), checklistPoints: 1 },
  { id: 'none',      label: 'No flagged risk markers',               eli5: 'No warning signs on record',         share: 0.473, rr: null,                  checklistPoints: 0 },
];
```

  Functions (all pure):
  - `residualRR(sample?: (b: Band) => number): number` — solves `Σ share·rr = 1` for the `none` stratum given sampled RRs of the others; assert > 0.
  - `orderStrata(mode: 'checklist' | 'weighted', rrOf: (s: Stratum) => number)` — checklist sorts by `checklistPoints` desc (ties by share desc — deliberately misordering vs true risk); weighted sorts by `rrOf` desc.
  - `triageAt(flagPct: number, mode, sample?): { recall; precision; flagged; falsePerTrue; caseloadPerLA }` — walk ordered strata, take whole strata until the flag budget is exhausted, take a *fraction* of the marginal stratum (linear interpolation: flagging x% of a stratum captures x% of its NEETs — within-stratum risk is uniform by construction); `recall = Σ flagged share·rr / 1`, `precision = COHORT_BASE_RATE × (Σ flagged share·rr / Σ flagged share)`, `flagged = flagPct/100 × COHORT_SIZE`, `falsePerTrue = (1 − precision)/precision`, `caseloadPerLA = flagged / 153`.
  - `triageCurve(mode, draws = 200, seed = 7): { flagPct: number[]; recall; recallP10; recallP90; precision; precisionP10; precisionP90 }` over `flagPct ∈ {1..40}` — reuse the `mulberry32` + `triangular` pattern from `montecarlo.ts` (copy the two small fns or export them from montecarlo and import; prefer exporting from montecarlo to stay DRY), sampling every stratum RR per draw and re-solving the residual.
- [ ] `npm test -- triage` → ALL PASS. Commit: `feat(policy-engine): calibrated triage model (lib + tests)`

### Task D2: `components/TriageSimulator.svelte`

**Files:** Create `components/TriageSimulator.svelte`

- [ ] Layout (single component, bespoke SVG, follows OutcomeChart idiom — ResizeObserver width, viewBox):
  1. **Controls row**: primary slider "Flag the top __% of the cohort" (1–40, default 10, step 1, big readout); mode toggle `checklist (RONI)` / `weighted (NERI-style)`.
  2. **Readout cards** (4): recall ("of future NEETs caught"), precision ("of flagged who become NEET"), false positives per true positive, caseload (total flagged + per-LA average) — each with P10–P90 sub-line from `triageCurve` at the chosen flagPct.
  3. **Recall curve SVG**: x = flag rate 0–40%, y = recall 0–100%; both mode curves drawn (active emphasized, other faint), band fan (P10–P90) on the active mode, marker dot at the current flagPct; diagonal reference line ("no model: flagging x% at random catches x%").
  4. **Waffle**: 10×10 dots representing the cohort at the chosen operating point — flagged-true (filled `#9a3b2e`), flagged-false (hollow red ring), missed-true (filled `rgba(28,22,17,0.5)`), rest (faint dots); legend beneath; both registers for labels.
  5. **Caveats panel — ALWAYS visible, not collapsible** (bordered, `EthicsGuardrails`-adjacent styling): synthetic cohort; published associational multipliers, not causal; overlap structure approximated from cross-tabs; ignores data quality/lag/consent realities; **risk ≠ responsiveness** (link to the uplift-modelling act below); no deployed English model publishes these numbers — that's the point.
- [ ] All copy in both registers. Memoise `triageCurve` per mode (it's ~200 draws × 40 points × 8 strata — cheap, but compute once via module-level cache keyed by mode).
- [ ] Commit: `feat(policy-engine): triage trade-off simulator`

### Task D3: `lib/dataestate.ts` + `components/DataEstateMap.svelte`

**Files:** Create both

- [ ] Data: nodes (id, name, tier `'proven' | 'underused' | 'missing'`, stage `'pre16' | 'transition' | 'post18'`, latency, access, blurb, blurbEli5, gap?) for: school census/NPD, daily attendance feed (proven; "mandatory Sept 2024; school-level only — never individual early warning"), attainment, NCCIS/CCIS (proven; "statutory to 17… duty to track 18-year-olds dropped 2016"), ILR, destination measures (underused; "~15 months in arrears"), LEO (underused; "could validate any risk index against real 5-year outcomes — nobody has published that"), ECHILD (underused; NHS linkage, research-only, ~2yr lag), Data First MoJ–DfE (underused), GUiE (underused), UCAS (underused; leading indicator), **missing**: post-16 real-time participation signal; operational health→RONI flow; statutory tracking at 18. Edges: which link to which today (NPD→LEO, NPD→ECHILD, census→attendance feed, NCCIS→destination…).
- [ ] Map component: horizontal SVG, three stage columns (pre-16 / 16–18 / 18–24); nodes as rounded chips colour-coded by tier (proven `#2f7d4f`, underused `#b4632e`, missing: dashed `#b1455e` outline); linkage edges as thin curves; the **age-18 dark zone** drawn as a literal hatched vertical band over the 18–24 column where tracking nodes stop. Click/tap a node → side card (fixed-position panel on desktop, below-map on mobile) with latency / access route / the strategic gap line + tier badge. Legend + both registers.
- [ ] Commit: `feat(policy-engine): data estate map`

### Task D4: `components/StakeholderMap.svelte`

**Files:** Create `components/StakeholderMap.svelte` (data inline in the component — single consumer)

- [ ] CSS-grid matrix: rows = life stage (pre-16, 16–18, 18–24); columns = function (Tracking, Funding, Delivery, Careers, Health, Evidence); cells list owner chips (DfE, DWP, LA, MCA, CEC, Colleges/ITPs, NHS, YFF) with colour per org. Five fault-line annotations rendered as numbered markers on the relevant cells + a list beneath: (1) tracking duty dies at 18 while NEET peaks at 18–24; (2) data-sharing guidance omits Jobcentres and ICBs; (3) "destination not known" variance corrupts LA comparisons; (4) SEND transitions fragment across school/college/LA/health; (5) no single owner of the 16–24 outcome (DfE 16–18, DWP 18+, LAs to 18, MCAs pieces). Both registers.
- [ ] Commit: `feat(policy-engine): stakeholder ownership map`

### Task D5: `lib/measurement.ts` + `components/MeasurementPopover.svelte` + Briefing wiring

**Files:** Create `lib/measurement.ts`, `components/MeasurementPopover.svelte`; modify `outcomes/+page.svelte` (chart cells)

- [ ] `measurement.ts`: `MEASUREMENT: Record<string, { sources: string; latency: string; gaps: string; better: string; eli5: string }>` keyed by the Briefing `CHART_PRIMARY` values (gapKS4, attainment8, grade5EM, ks2RWM, gld, ehcpPct, highNeedsDeficitStock, ehcpAttainment8, persistentAbsence, childPoverty, neet, teacherShortfall, cumulativeCost). Each entry answers: what data measures this today, how stale is it, what's the known gap, one line of "what better looks like". (e.g. `neet`: sources 'LFS (quarterly, volatile) · CCIS to 17 · annual DfE brief'; latency 'quarterly with ONS volatility caveats; LA-level annual'; gaps 'tracking goes dark at 18; LA not-known rates corrupt comparisons'; better 'RTI/DWP-linked near-real-time EET status for 16–24s'.)
- [ ] `MeasurementPopover.svelte`: trigger button `⌕ how we'd monitor this` (mono 9px, same visual weight as the hint-chip row) + popover panel — **must use an opaque background** (`--paper` / `#f1ead6`, NOT translucent) and portal/fixed positioning consistent with `ChartModal`'s approach to escape the chart-cell stacking context (see memory: modal/overlay tokens). Esc/click-out closes.
- [ ] Wire into the Briefing chart cell footer next to the hint chips for every chart with a MEASUREMENT entry.
- [ ] Commit: `feat(policy-engine): measurement layer (how we'd monitor this)`

### Task D6: Rebuild `neet/+page.svelte` — "The early-warning system"

**Files:** Rewrite `neet/+page.svelte` (read fully first; salvage its data uses of `lib/neet.ts`); extend `lib/neet.ts` with new act content constants (risk-tooling ladder entries, failure gallery, opportunity ladder)

- [ ] Six acts, each a `StorySection` (prose left/sticky, data right), masthead from Phase A on top:
  1. **The headline** — 1.01m / 13.5% (first time above 1m since 2013), composition flip chart (existing NEET_NOW composition bar reused) + the LIVE engine segment chart (`app.viewSim` segment series, marked "the engine's view — open the levers to change it" with a deliberate open-drawer link instead of auto-open).
  2. **The risk-tooling ladder** — new `lib/neet.ts` constant `TOOLING_LADDER`: RONI (checklist; LA practice → DfE national guidance Jan 2025; weaknesses: unweighted, Years 10–11 too late, LA variance) → NERI (NatCen weighted index; >1m records; signals from primary school) → ML (Bristol: only ATRS-published model in England, no public precision/recall; Essex dashboard; vendor-opacity warnings). Rendered as a 3-step ladder with the load-bearing line: *no deployed English NEET model has published precision/recall*. Failure gallery card row: Ofqual 2020 · DfE ABIE suspension · DWP UC-advances model — each one line: what broke, the design rule it teaches.
  3. **The triage simulator** — `<TriageSimulator />`.
  4. **The data estate** — `<DataEstateMap />` + the LEO-validation headline.
  5. **The stakeholders** — `<StakeholderMap />`.
  6. **The opportunity ladder & governance** — table of the eight shapes ranked by evidence-to-novelty (validated weighted index → attendance-feed early warning → survival analysis → place-based forecasting → service matching → LLM casework → **uplift modelling**, marked "the frontier: target by who responds, not who's at risk"), each row: needs (cross-link the estate node names), evidence status, governance price; closing governance checklist (DPIA published · ATRS record with metrics · ICO-grade human-in-the-loop · subgroup error rates · sunset/review · challenger team). Keep/relocate the existing `EthicsGuardrails` component here.
- [ ] Retain from the old page wherever the act structure fits: LA spread chart (act 1 or 2), Estonia/NL international comparators (act 2 — register them as "register-based systems, not ML"), CCIS matrix content (act 4 if not superseded by the estate map — otherwise delete; no orphan sections).
- [ ] Both registers throughout. Update `<title>`.
- [ ] `npm run check` + full `npm test`; visual pass on dev at 1440px, 1024px, 390px.
- [ ] Commit: `feat(policy-engine): NEET field study rebuilt as the early-warning intelligence story`

### Task D7: Deploy Phase D + closeout

- [ ] `/ship`; verify live: `/projects/policy-engine/neet` all six acts, triage simulator interactive, measurement popovers on the Briefing.
- [ ] Update memory: `project_whitehall_model_policy_engine.md` (append the realignment summary + SHA) — keep it short.
- [ ] Final report to John: what shipped, what was calibrated where, known follow-ups.

---

## Self-review notes (run after drafting — resolved inline)

- Spec coverage: A1–A4 ↔ spec A; B1–B8 ↔ spec B (B1↔B3-state-clarity, B7↔B1-co-visible); C1–C7 ↔ spec C (C6 covers the Briefing composition variant); D1–D7 ↔ spec D incl. D5 measurement layer. Onboarding-modal staleness fix (Explore finding) deliberately out of scope — not in spec.
- Type consistency: segment field names `neetUnemployed/neetInactiveHealth/neetInactiveOther` used identically in params/types/engine/tests/outcomes; `triageAt`/`triageCurve` signatures match tests; `drawerMode` getter preserves `drawerOpen` readers.
- Honest deviations from strict TDD: UI components (mastheads, maps, popovers) are verified visually + by `npm run check`, not unit tests — logic lives in tested libs (engine, triage). Page copy is authored at execution time against the register/tone rules above rather than fully inlined here.
