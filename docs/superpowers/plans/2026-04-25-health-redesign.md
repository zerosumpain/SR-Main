# /health Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/health` to (1) adopt the SR `.nm-*` design language used by `/admin/files` and `/jkai/canvas`, and (2) add eight research-driven analytics modules (Autonomic Balance, ACWR, Sleep Regularity Index, Circadian Alignment, Training Monotony & Strain, VO₂max Percentile, Polarised Training Distribution, Recovery Debt) plus a methodology / evidence panel.

**Architecture:** Five-phase build. Phase 0 stands up the design-language primitives (masthead, sticky scroll-spy nav, evidence chip, evidence panel, metric card, mini sparkline, methodology source-of-truth). Phase 1 implements eight pure analytics functions in `src/lib/health/analytics/` with vitest unit tests. Phase 2 exposes them as services + `/api/health/<metric>` endpoints. Phase 3 builds the eight analytics module components. Phase 4 restyles the six existing components and the slide-over content. Phase 5 assembles the new `+page.svelte` and `+page.server.ts`.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), TypeScript, Drizzle ORM (Postgres), `layerchart` for charts, Vitest for tests, Tailwind 4 + canonical `nm-tokens.css`.

**Spec:** `docs/superpowers/specs/2026-04-25-health-redesign-design.md`.

---

## Pre-flight

- [ ] **Confirm worktree**

Run: `git status` and `git branch --show-current`
Expected: clean tree on a feature branch (or `master` if working in place — confirm with the human).

- [ ] **Confirm tests run**

Run: `npm test -- --run tests/lib/webframe/extract.test.ts`
Expected: at least one existing test passes (proves vitest + path aliases work).

- [ ] **Confirm dev server starts**

Run: `npm run dev` (background it). Hit `http://homeserv:5173/health` in a browser. Confirm the current page loads.
Stop the server with the background-process control once confirmed.

---

## Phase 0 — Foundation primitives

### Task 1: Methodology source of truth

**Files:**
- Create: `src/lib/health/methodology.ts`

- [ ] **Step 1: Create the methodology module**

```ts
// src/lib/health/methodology.ts
export type MethodologyEntry = {
  id: string;            // 'sri', 'acwr', etc. — used as deep-link anchor
  metric: string;        // 'Sleep Regularity Index'
  cite: string;          // 'Phillips 2017'
  formula: string;       // markdown
  sourceData: string;    // 'Whoop sleep events, 14d window'
  caveats: string;       // markdown
  reference: string;     // 'Phillips et al., Scientific Reports 7:3216 (2017). https://doi.org/10.1038/s41598-017-03171-4'
};

export const METHODOLOGY: MethodologyEntry[] = [
  {
    id: 'readiness',
    metric: 'Readiness',
    cite: 'composite',
    formula: 'weighted mean of recovery (40%), HRV trend (20%), sleep quality (25%), load balance (15%) — clipped to 0–100',
    sourceData: 'Whoop recovery, Whoop HRV, Whoop sleep performance, ACWR (Whoop strain).',
    caveats: 'Composite score. The factor with the lowest value usually drives the colour band. See each factor for its own evidence.',
    reference: 'Internal composite. No single citation.',
  },
  {
    id: 'autonomic-balance',
    metric: 'Autonomic Balance',
    cite: 'Plews 2013',
    formula: 'composite z-score of HRV-rmssd 7d trend (positive) and resting heart rate 7d trend (negative), normalised against 28d personal baseline. Output mapped to 0–100.',
    sourceData: 'Whoop hrv_rmssd and resting_heart_rate from `whoop_recovery` (last 28 days).',
    caveats: 'Personal baselines drift over months. Below ~30 sustained for >5 days is the early-warning band — investigate sleep, illness, alcohol, stress.',
    reference: 'Plews DJ et al., Sports Med 43:773–781 (2013). Heart rate variability in elite triathletes — is variation in variability the key?',
  },
  {
    id: 'acwr',
    metric: 'ACWR — Acute:Chronic Workload Ratio',
    cite: 'Gabbett 2016',
    formula: 'acute = 7-day exponentially-weighted moving average of daily strain. chronic = 28-day EWMA. ratio = acute / chronic. Sweet spot: 0.8–1.3. Danger: >1.5 or <0.5.',
    sourceData: 'Whoop daily strain from `whoop_cycles` (last 28 days).',
    caveats: 'EWMA is more responsive than simple rolling mean. Below 0.5 suggests detraining; above 1.5 is associated with elevated injury risk in field-sport literature.',
    reference: 'Gabbett TJ. Br J Sports Med 50:273–280 (2016). The training—injury prevention paradox.',
  },
  {
    id: 'sri',
    metric: 'Sleep Regularity Index',
    cite: 'Phillips 2017',
    formula: 'percentage probability of being in the same sleep/wake state at the same clock minute on any two days within the window. 100 = perfectly regular, 0 = random.',
    sourceData: 'Whoop sleep start/end events from `whoop_sleep` (last 14 days, naps excluded).',
    caveats: 'Needs ≥7 nights to be meaningful, ≥14 to be stable. SRI predicts mortality and metabolic health independently of duration (Windred et al. 2024 Sleep).',
    reference: 'Phillips AJK et al., Scientific Reports 7:3216 (2017). https://doi.org/10.1038/s41598-017-03171-4',
  },
  {
    id: 'circadian-alignment',
    metric: 'Circadian Alignment',
    cite: 'Wittmann 2006',
    formula: 'sleep midpoint = (sleep_onset + sleep_offset) / 2, in local minutes-since-midnight. Drift = mean(midpoint, last 7 nights) − mean(midpoint, prior 21 nights). Reported in hours.',
    sourceData: 'Whoop sleep start/end events from `whoop_sleep` (last 28 days, naps excluded).',
    caveats: 'Drift > +/− 1 hour vs personal baseline indicates social jetlag — flag for review. The sign matters: positive drift = phase-delayed (sleeping later).',
    reference: 'Wittmann M et al., Chronobiol Int 23:497–509 (2006). Social jetlag: misalignment of biological and social time.',
  },
  {
    id: 'monotony',
    metric: 'Training Monotony & Strain',
    cite: 'Foster 1998',
    formula: 'monotony = mean(daily_load_7d) / SD(daily_load_7d). strain = sum(daily_load_7d) × monotony. Verdict: monotony >2.0 = high; strain >6000 = elevated overtraining risk.',
    sourceData: 'Whoop daily strain from `whoop_cycles` (last 7 days). Day-zero counts as 0 load.',
    caveats: 'Foster\'s thresholds were derived in collegiate athletes — interpret bands as personal trend signals rather than absolute cutoffs. Empty rest days are healthy and lower monotony.',
    reference: 'Foster C, Med Sci Sports Exerc 30:1164–1168 (1998). Monitoring training in athletes with reference to overtraining syndrome.',
  },
  {
    id: 'vo2max',
    metric: 'VO₂max & Cardio Percentile',
    cite: 'ACSM normative',
    formula: 'current = latest VO₂max value. trend = slope of linear regression over last 90 days. percentile = lookup in ACSM age × sex normative table.',
    sourceData: 'Apple Health `vo2_max` series from `apple_health_metrics`. Age derived from configured DOB; sex from configured profile.',
    caveats: 'Apple\'s VO₂max estimate is conservative and based on submaximal walking/running data. Use the trend, not the absolute value, for personal tracking.',
    reference: 'ACSM\'s Guidelines for Exercise Testing and Prescription, 11th ed. (2021). Tables 4.7–4.10.',
  },
  {
    id: 'polarised',
    metric: 'Polarised Training Distribution',
    cite: 'Seiler 2010',
    formula: 'aggregate Whoop workout zone durations (zone_zero..zone_five) over last 7 days. Z1+Z2 = easy. Z3 = moderate (the "junk middle"). Z4+Z5 = hard. 80/20 verdict triggers if easy ≥80% AND hard ≥10%.',
    sourceData: 'Whoop workout zone durations (ms) from `whoop_workouts` (last 7 days).',
    caveats: 'Whoop\'s zones are heart-rate-based and use the user\'s configured max HR. Mis-calibrated max HR shifts everything. Polarised training is most-evidenced for endurance sports; less applicable for strength training.',
    reference: 'Seiler S, Int J Sports Physiol Perform 5:276–291 (2010). What is best practice for training intensity and duration distribution in endurance athletes?',
  },
  {
    id: 'recovery-debt',
    metric: 'Recovery Debt',
    cite: 'Van Dongen 2003',
    formula: 'sleep_debt_minutes = sum_{14d}(sleep_need − sleep_actual), floored at 0. strain_recovery_balance = mean(strain_7d) − mean(recovery_score_7d). Debt > 240 min OR balance > 8 = overdrawn.',
    sourceData: 'Whoop sleep need/actual from `whoop_sleep`; strain from `whoop_cycles`; recovery from `whoop_recovery` (last 14 days).',
    caveats: 'Sleep debt is reset by genuine recovery sleep, not by single long nights. The strain/recovery balance is a heuristic — use alongside subjective state.',
    reference: 'Van Dongen HPA et al., Sleep 26:117–126 (2003). The cumulative cost of additional wakefulness.',
  },
];

export function getMethodologyEntry(id: string): MethodologyEntry | undefined {
  return METHODOLOGY.find((m) => m.id === id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/methodology.ts
git commit -m "feat(health): add methodology source-of-truth for evidence panel"
```

---

### Task 2: EvidenceChip component

**Files:**
- Create: `src/lib/components/health/EvidenceChip.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { getMethodologyEntry } from '$lib/health/methodology';

  let {
    id,
    onopen,
  }: { id: string; onopen?: (id: string) => void } = $props();

  const entry = $derived(getMethodologyEntry(id));
</script>

{#if entry}
  <button
    type="button"
    class="ev-chip"
    title={`${entry.metric} — ${entry.cite}. Click for methodology.`}
    onclick={() => onopen?.(id)}
  >
    <span class="ev-cite">{entry.cite}</span>
  </button>
{/if}

<style>
  .ev-chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
  }
  .ev-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .ev-cite { font-weight: 700; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/EvidenceChip.svelte
git commit -m "feat(health): add EvidenceChip — citation pill for analytics modules"
```

---

### Task 3: EvidencePanel component

**Files:**
- Create: `src/lib/components/health/EvidencePanel.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { METHODOLOGY } from '$lib/health/methodology';
  import { onMount, tick } from 'svelte';

  let { focusId }: { focusId?: string | null } = $props();
  let root: HTMLDivElement | null = $state(null);

  onMount(async () => {
    if (focusId) {
      await tick();
      root?.querySelector(`[data-entry-id="${focusId}"]`)?.scrollIntoView({ block: 'start' });
    }
  });
</script>

<div bind:this={root} class="ev-root">
  <p class="ev-intro">
    Every analytics module on this page is derived from peer-reviewed health science.
    Each entry below states the formula, the source data, the citation, and the caveats.
  </p>

  {#each METHODOLOGY as entry (entry.id)}
    <article class="ev-entry" data-entry-id={entry.id}>
      <header class="ev-hd">
        <span class="ev-metric">{entry.metric}</span>
        <span class="ev-cite-tag">{entry.cite}</span>
      </header>
      <dl class="ev-grid">
        <dt>Formula</dt>
        <dd>{entry.formula}</dd>
        <dt>Source data</dt>
        <dd>{entry.sourceData}</dd>
        <dt>Caveats</dt>
        <dd>{entry.caveats}</dd>
        <dt>Reference</dt>
        <dd class="ev-ref">{entry.reference}</dd>
      </dl>
    </article>
  {/each}
</div>

<style>
  .ev-root { display: flex; flex-direction: column; gap: 1.25rem; }
  .ev-intro {
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-secondary);
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--card-border);
    margin: 0;
  }
  .ev-entry {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--card-border);
  }
  .ev-entry:last-child { border-bottom: 0; }
  .ev-hd {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .ev-metric {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-primary);
  }
  .ev-cite-tag {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  .ev-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 0.9rem;
    row-gap: 0.35rem;
    margin: 0;
  }
  .ev-grid dt {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    padding-top: 2px;
  }
  .ev-grid dd {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
  }
  .ev-ref {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/EvidencePanel.svelte
git commit -m "feat(health): add EvidencePanel — methodology slide-over content"
```

---

### Task 4: HealthMasthead component

**Files:**
- Create: `src/lib/components/health/HealthMasthead.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  let { onopenEvidence }: { onopenEvidence?: () => void } = $props();
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<header class="hm">
  <div class="hm-left">
    <div class="hm-kicker">DAILY · {today}</div>
    <h1 class="hm-title">HEALTH</h1>
    <p class="hm-sub">
      Live readiness, autonomic balance, training load, sleep quality, body signals — derived
      from Whoop, Apple Health, and Strava and contextualised against current health research.
    </p>
  </div>
  <div class="hm-right">
    <button type="button" class="hm-evidence" onclick={() => onopenEvidence?.()}>
      [ Evidence &amp; Methodology ]
    </button>
  </div>
</header>

<style>
  .hm {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    padding: 1.5rem 1.5rem 1rem;
    border-bottom: 2px solid var(--text-primary);
    margin: 0 auto 1.25rem;
    max-width: 1200px;
  }
  .hm-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.4rem;
  }
  .hm-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2.25rem;
    font-weight: 900;
    line-height: 1.05;
    color: var(--text-primary);
  }
  .hm-sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-secondary);
    max-width: 60ch;
  }
  .hm-evidence {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
  }
  .hm-evidence:hover { text-decoration: underline; }
  @media (max-width: 640px) {
    .hm { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
    .hm-title { font-size: 1.75rem; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/HealthMasthead.svelte
git commit -m "feat(health): add HealthMasthead — kicker/title/sub/evidence-link header"
```

---

### Task 5: HealthSectionNav component

**Files:**
- Create: `src/lib/components/health/HealthSectionNav.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  type Section = { id: string; label: string };
  const SECTIONS: Section[] = [
    { id: 'readiness', label: 'Readiness' },
    { id: 'autonomic', label: 'Autonomic' },
    { id: 'sleep', label: 'Sleep' },
    { id: 'training', label: 'Training' },
    { id: 'body', label: 'Body' },
    { id: 'activities', label: 'Activities' },
  ];

  let active = $state<string>('readiness');

  onMount(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) active = e.target.id;
        }
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  });

  function scrollTo(id: string, ev: Event) {
    ev.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    active = id;
  }
</script>

<nav class="hsn">
  <ul class="hsn-list">
    {#each SECTIONS as s (s.id)}
      <li>
        <a
          href={`#${s.id}`}
          class="hsn-link"
          class:active={active === s.id}
          onclick={(e) => scrollTo(s.id, e)}
        >
          {s.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .hsn {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--bg);
    border-bottom: 1px solid var(--card-border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hsn::-webkit-scrollbar { display: none; }
  .hsn-list {
    display: flex;
    gap: 1.5rem;
    list-style: none;
    margin: 0;
    padding: 0.5rem 1.5rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  .hsn-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    text-decoration: none;
    padding: 0.25rem 0;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }
  .hsn-link:hover { color: var(--text-secondary); }
  .hsn-link.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/HealthSectionNav.svelte
git commit -m "feat(health): add HealthSectionNav — sticky scroll-spy section nav"
```

---

### Task 6: MetricCard primitive

**Files:**
- Create: `src/lib/components/health/MetricCard.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import EvidenceChip from './EvidenceChip.svelte';

  let {
    label,
    evidenceId,
    onopenDetail,
    onopenEvidence,
    children,
    insufficient = false,
  }: {
    label: string;
    evidenceId: string;
    onopenDetail?: () => void;
    onopenEvidence?: (id: string) => void;
    children: Snippet;
    insufficient?: boolean;
  } = $props();
</script>

<section class="nm-sec mc">
  <div class="nm-sec-hd mc-hd">
    <span class="sr-label-tight">{label}</span>
    <EvidenceChip id={evidenceId} onopen={onopenEvidence} />
    {#if onopenDetail && !insufficient}
      <button type="button" class="row-link mc-detail" onclick={onopenDetail}>Detail</button>
    {/if}
  </div>
  <div class="mc-body">
    {#if insufficient}
      <p class="mc-insufficient">Insufficient data — needs more history to compute.</p>
    {:else}
      {@render children()}
    {/if}
  </div>
</section>

<style>
  .mc-hd { gap: 0.5rem; }
  .mc-detail { margin-left: auto; }
  .mc-body { display: flex; flex-direction: column; gap: 0.6rem; }
  .mc-insufficient {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
    margin: 0;
  }
  /* row-link is canonical from /admin/files; redefine here so this component
   * is self-contained when used outside /health. */
  .row-link {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .row-link:hover { color: var(--accent-hover); text-decoration: underline; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/MetricCard.svelte
git commit -m "feat(health): add MetricCard — generic .nm-sec module wrapper"
```

---

### Task 7: MiniSparkline primitive

**Files:**
- Create: `src/lib/components/health/MiniSparkline.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { Chart, Svg, Spline } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';

  let {
    points,
    height = 40,
    color = 'var(--accent)',
  }: {
    points: { date: Date; value: number }[];
    height?: number;
    color?: string;
  } = $props();
</script>

<div class="ms" style="height: {height}px;">
  {#if points.length > 1}
    <Chart
      data={points}
      x="date"
      xScale={scaleTime()}
      y="value"
      yScale={scaleLinear()}
      yNice={true}
      padding={{ top: 2, bottom: 2, left: 0, right: 0 }}
    >
      <Svg>
        <Spline stroke={color} strokeWidth={1.5} curve={curveMonotoneX} />
      </Svg>
    </Chart>
  {/if}
</div>

<style>
  .ms { width: 100%; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/MiniSparkline.svelte
git commit -m "feat(health): add MiniSparkline — flat 2px sparkline primitive"
```

---

## Phase 1 — Pure analytics (TDD)

> Each analytics module is a pure function in `src/lib/health/analytics/<name>.ts` with a colocated test file in `tests/lib/health/analytics/<name>.test.ts`. Functions take typed inputs (no DB), return a `MetricResult<T>`. Service layer (Phase 2) does the DB queries and feeds the pure function.

### Task 8: MetricResult type

**Files:**
- Create: `src/lib/health/analytics/types.ts`

- [ ] **Step 1: Create the shared type**

```ts
// src/lib/health/analytics/types.ts
export type Sufficiency = 'ok' | 'partial' | 'insufficient';

export type MetricResult<T> = {
  value: T;
  sufficiency: Sufficiency;
  asOf: string;          // ISO date
  sampleSize: number;    // n datapoints used
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/analytics/types.ts
git commit -m "feat(health): add MetricResult shared type for analytics functions"
```

---

### Task 9: Sleep Regularity Index (Phillips 2017)

**Files:**
- Create: `src/lib/health/analytics/sri.ts`
- Test: `tests/lib/health/analytics/sri.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/sri.test.ts
import { describe, it, expect } from 'vitest';
import { computeSRI } from '$lib/health/analytics/sri';

describe('computeSRI', () => {
  it('returns 100 for perfectly regular sleep over 14 nights', () => {
    // 14 identical nights: in bed 23:00–07:00 local
    const nights = Array.from({ length: 14 }).map((_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i, 23, 0));      // 23:00 UTC
      const e = new Date(Date.UTC(2026, 0, 2 + i, 7, 0));       // 07:00 UTC next day
      return { startLocalIso: d.toISOString(), endLocalIso: e.toISOString() };
    });
    const r = computeSRI(nights);
    expect(r.sufficiency).toBe('ok');
    expect(Math.round(r.value)).toBe(100);
  });

  it('returns < 100 when sleep times shift', () => {
    const nights = [
      { startLocalIso: '2026-01-01T23:00:00Z', endLocalIso: '2026-01-02T07:00:00Z' },
      { startLocalIso: '2026-01-02T01:00:00Z', endLocalIso: '2026-01-02T09:00:00Z' },
      { startLocalIso: '2026-01-03T23:00:00Z', endLocalIso: '2026-01-04T07:00:00Z' },
      { startLocalIso: '2026-01-04T02:00:00Z', endLocalIso: '2026-01-04T10:00:00Z' },
      { startLocalIso: '2026-01-05T23:00:00Z', endLocalIso: '2026-01-06T07:00:00Z' },
      { startLocalIso: '2026-01-06T03:00:00Z', endLocalIso: '2026-01-06T11:00:00Z' },
      { startLocalIso: '2026-01-07T23:00:00Z', endLocalIso: '2026-01-08T07:00:00Z' },
    ];
    const r = computeSRI(nights);
    expect(r.value).toBeLessThan(100);
    expect(r.value).toBeGreaterThan(0);
  });

  it('reports insufficient with < 7 nights', () => {
    const r = computeSRI([
      { startLocalIso: '2026-01-01T23:00:00Z', endLocalIso: '2026-01-02T07:00:00Z' },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/sri.test.ts`
Expected: FAIL — module `$lib/health/analytics/sri` not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/sri.ts
import type { MetricResult } from './types';

export type SleepInterval = {
  startLocalIso: string;
  endLocalIso: string;
};

const MINUTES_PER_DAY = 24 * 60;

/**
 * Phillips 2017 Sleep Regularity Index.
 * For each minute m in [0, 1440), compute the fraction of pairs (i,j) where
 * day_i and day_j have the same sleep state at minute m. Average over all
 * minutes and pairs. Output 0–100.
 */
export function computeSRI(intervals: SleepInterval[]): MetricResult<number> {
  if (intervals.length < 7) {
    return { value: 0, sufficiency: 'insufficient', asOf: new Date().toISOString(), sampleSize: intervals.length };
  }

  // Build day buckets. Day = local YYYY-MM-DD of the start.
  const days = new Map<string, Uint8Array>();   // 1440 minutes per day
  for (const iv of intervals) {
    const start = new Date(iv.startLocalIso);
    const end = new Date(iv.endLocalIso);
    const dayKey = start.toISOString().slice(0, 10);
    let arr = days.get(dayKey);
    if (!arr) {
      arr = new Uint8Array(MINUTES_PER_DAY);
      days.set(dayKey, arr);
    }
    fillSleepMinutes(arr, start, end, dayKey);
    // If interval spans midnight, fill the next day as well.
    const nextDayKey = isoOffsetDay(dayKey, 1);
    if (end.toISOString().slice(0, 10) !== dayKey) {
      let next = days.get(nextDayKey);
      if (!next) {
        next = new Uint8Array(MINUTES_PER_DAY);
        days.set(nextDayKey, next);
      }
      fillSleepMinutes(next, start, end, nextDayKey);
    }
  }

  const dayArrays = [...days.values()];
  if (dayArrays.length < 2) {
    return { value: 0, sufficiency: 'insufficient', asOf: new Date().toISOString(), sampleSize: intervals.length };
  }

  let agreement = 0;
  let pairs = 0;
  for (let i = 0; i < dayArrays.length; i++) {
    for (let j = i + 1; j < dayArrays.length; j++) {
      let same = 0;
      const a = dayArrays[i];
      const b = dayArrays[j];
      for (let m = 0; m < MINUTES_PER_DAY; m++) {
        if (a[m] === b[m]) same++;
      }
      agreement += same / MINUTES_PER_DAY;
      pairs++;
    }
  }
  const sri = (agreement / pairs) * 100;

  return {
    value: sri,
    sufficiency: dayArrays.length >= 14 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: dayArrays.length,
  };
}

function fillSleepMinutes(arr: Uint8Array, start: Date, end: Date, dayKey: string) {
  const dayStart = new Date(dayKey + 'T00:00:00Z').getTime();
  const dayEnd = dayStart + MINUTES_PER_DAY * 60 * 1000;
  const s = Math.max(start.getTime(), dayStart);
  const e = Math.min(end.getTime(), dayEnd);
  if (e <= s) return;
  const sMin = Math.floor((s - dayStart) / 60000);
  const eMin = Math.ceil((e - dayStart) / 60000);
  for (let m = sMin; m < eMin && m < MINUTES_PER_DAY; m++) arr[m] = 1;
}

function isoOffsetDay(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/sri.test.ts`
Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/sri.ts tests/lib/health/analytics/sri.test.ts
git commit -m "feat(health): add SRI analytics (Phillips 2017) with vitest"
```

---

### Task 10: Circadian alignment

**Files:**
- Create: `src/lib/health/analytics/circadian.ts`
- Test: `tests/lib/health/analytics/circadian.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/circadian.test.ts
import { describe, it, expect } from 'vitest';
import { computeCircadianAlignment } from '$lib/health/analytics/circadian';

describe('computeCircadianAlignment', () => {
  it('returns ~0 drift when last 7 nights match the prior baseline', () => {
    const nights = Array.from({ length: 28 }).map((_, i) => ({
      startLocalIso: `2026-01-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
      endLocalIso: `2026-01-${String(i + 2).padStart(2, '0')}T07:00:00Z`,
    }));
    const r = computeCircadianAlignment(nights);
    expect(Math.abs(r.value.driftHours)).toBeLessThan(0.05);
    expect(r.sufficiency).toBe('ok');
  });

  it('reports positive drift when recent nights are later', () => {
    const baseline = Array.from({ length: 21 }).map((_, i) => ({
      startLocalIso: `2026-01-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
      endLocalIso: `2026-01-${String(i + 2).padStart(2, '0')}T07:00:00Z`,
    }));
    const recent = Array.from({ length: 7 }).map((_, i) => ({
      startLocalIso: `2026-01-${String(i + 22).padStart(2, '0')}T01:00:00Z`,
      endLocalIso: `2026-01-${String(i + 23).padStart(2, '0')}T09:00:00Z`,
    }));
    const r = computeCircadianAlignment([...baseline, ...recent]);
    expect(r.value.driftHours).toBeGreaterThan(1.5);
  });

  it('reports insufficient with < 14 nights', () => {
    const r = computeCircadianAlignment([
      { startLocalIso: '2026-01-01T23:00:00Z', endLocalIso: '2026-01-02T07:00:00Z' },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/circadian.test.ts`
Expected: FAIL — module not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/circadian.ts
import type { MetricResult } from './types';
import type { SleepInterval } from './sri';

export type CircadianResult = {
  driftHours: number;        // positive = phase-delayed (sleeping later)
  baselineMidpointMin: number;
  recentMidpointMin: number;
  flag: 'aligned' | 'drift-late' | 'drift-early';
};

export function computeCircadianAlignment(intervals: SleepInterval[]): MetricResult<CircadianResult> {
  if (intervals.length < 14) {
    return {
      value: { driftHours: 0, baselineMidpointMin: 0, recentMidpointMin: 0, flag: 'aligned' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: intervals.length,
    };
  }
  const sorted = [...intervals].sort((a, b) => a.startLocalIso.localeCompare(b.startLocalIso));
  const recent = sorted.slice(-7);
  const baseline = sorted.slice(0, sorted.length - 7);

  const recentMid = avgMidpointMinutes(recent);
  const baseMid = avgMidpointMinutes(baseline);
  const driftHours = (recentMid - baseMid) / 60;

  return {
    value: {
      driftHours,
      baselineMidpointMin: baseMid,
      recentMidpointMin: recentMid,
      flag: Math.abs(driftHours) < 1 ? 'aligned' : driftHours > 0 ? 'drift-late' : 'drift-early',
    },
    sufficiency: sorted.length >= 28 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

function avgMidpointMinutes(intervals: SleepInterval[]): number {
  if (intervals.length === 0) return 0;
  let sum = 0;
  for (const iv of intervals) {
    const start = new Date(iv.startLocalIso);
    const end = new Date(iv.endLocalIso);
    const midMs = (start.getTime() + end.getTime()) / 2;
    const mid = new Date(midMs);
    // Minutes since the START of the night (midnight local). Wrap negative values into 24h domain.
    const minOfDay = mid.getUTCHours() * 60 + mid.getUTCMinutes();
    sum += minOfDay;
  }
  return sum / intervals.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/circadian.test.ts`
Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/circadian.ts tests/lib/health/analytics/circadian.test.ts
git commit -m "feat(health): add circadian alignment analytics with vitest"
```

---

### Task 11: Foster monotony & strain

**Files:**
- Create: `src/lib/health/analytics/monotony.ts`
- Test: `tests/lib/health/analytics/monotony.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/monotony.test.ts
import { describe, it, expect } from 'vitest';
import { computeMonotony } from '$lib/health/analytics/monotony';

describe('computeMonotony', () => {
  it('returns high monotony for flat daily load', () => {
    const r = computeMonotony([10, 10, 10, 10, 10, 10, 10]);
    expect(r.value.monotony).toBeGreaterThan(50);  // SD≈0 → big number, capped
    expect(r.value.strain).toBeGreaterThan(0);
    expect(r.sufficiency).toBe('ok');
  });

  it('returns ~1 monotony for varied load', () => {
    const r = computeMonotony([0, 14, 0, 12, 0, 16, 0]);
    expect(r.value.monotony).toBeGreaterThan(0.5);
    expect(r.value.monotony).toBeLessThan(2);
  });

  it('reports insufficient when fewer than 7 days supplied', () => {
    const r = computeMonotony([10, 10]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/monotony.test.ts`
Expected: FAIL — module not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/monotony.ts
import type { MetricResult } from './types';

export type MonotonyResult = {
  monotony: number;     // mean / SD (capped at 100)
  strain: number;       // sum * monotony
  mean: number;
  sd: number;
  band: 'low' | 'moderate' | 'high';
};

const MONOTONY_CAP = 100;

export function computeMonotony(daily: number[]): MetricResult<MonotonyResult> {
  if (daily.length < 7) {
    return {
      value: { monotony: 0, strain: 0, mean: 0, sd: 0, band: 'low' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: daily.length,
    };
  }
  const window = daily.slice(-7);
  const sum = window.reduce((a, b) => a + b, 0);
  const mean = sum / window.length;
  const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
  const sd = Math.sqrt(variance);
  const rawMonotony = sd === 0 ? MONOTONY_CAP : mean / sd;
  const monotony = Math.min(rawMonotony, MONOTONY_CAP);
  const strain = sum * monotony;
  const band: MonotonyResult['band'] =
    monotony > 2 ? 'high' : monotony > 1 ? 'moderate' : 'low';
  return {
    value: { monotony, strain, mean, sd, band },
    sufficiency: 'ok',
    asOf: new Date().toISOString(),
    sampleSize: window.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/monotony.test.ts`
Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/monotony.ts tests/lib/health/analytics/monotony.test.ts
git commit -m "feat(health): add Foster 1998 monotony & strain analytics"
```

---

### Task 12: Autonomic balance

**Files:**
- Create: `src/lib/health/analytics/autonomic-balance.ts`
- Test: `tests/lib/health/analytics/autonomic-balance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/autonomic-balance.test.ts
import { describe, it, expect } from 'vitest';
import { computeAutonomicBalance } from '$lib/health/analytics/autonomic-balance';

describe('computeAutonomicBalance', () => {
  it('returns mid score (~50) when 7d trends match 28d baseline', () => {
    const series = Array.from({ length: 28 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      hrv: 50,
      rhr: 60,
    }));
    const r = computeAutonomicBalance(series);
    expect(r.value.score).toBeGreaterThan(40);
    expect(r.value.score).toBeLessThan(60);
    expect(r.sufficiency).toBe('ok');
  });

  it('returns higher score when recent HRV is high and RHR is low', () => {
    const baseline = Array.from({ length: 21 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`, hrv: 50, rhr: 60,
    }));
    const recent = Array.from({ length: 7 }).map((_, i) => ({
      date: `2026-01-${String(i + 22).padStart(2, '0')}`, hrv: 70, rhr: 52,
    }));
    const r = computeAutonomicBalance([...baseline, ...recent]);
    expect(r.value.score).toBeGreaterThan(70);
  });

  it('returns insufficient with < 14 days', () => {
    const r = computeAutonomicBalance([
      { date: '2026-01-01', hrv: 50, rhr: 60 },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/autonomic-balance.test.ts`
Expected: FAIL — module not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/autonomic-balance.ts
import type { MetricResult } from './types';

export type AutonomicSample = { date: string; hrv: number; rhr: number };

export type AutonomicResult = {
  score: number;             // 0–100
  hrvZ: number;
  rhrZ: number;
  hrv7dMean: number;
  rhr7dMean: number;
  hrvBaselineMean: number;
  rhrBaselineMean: number;
};

export function computeAutonomicBalance(series: AutonomicSample[]): MetricResult<AutonomicResult> {
  if (series.length < 14) {
    return {
      value: { score: 0, hrvZ: 0, rhrZ: 0, hrv7dMean: 0, rhr7dMean: 0, hrvBaselineMean: 0, rhrBaselineMean: 0 },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: series.length,
    };
  }
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-7);
  const baseline = sorted.slice(0, sorted.length - 7);

  const hrv7d = mean(recent.map((s) => s.hrv));
  const rhr7d = mean(recent.map((s) => s.rhr));
  const hrvBase = mean(baseline.map((s) => s.hrv));
  const rhrBase = mean(baseline.map((s) => s.rhr));
  const hrvSD = stdev(baseline.map((s) => s.hrv));
  const rhrSD = stdev(baseline.map((s) => s.rhr));

  const hrvZ = hrvSD === 0 ? 0 : (hrv7d - hrvBase) / hrvSD;     // higher = better
  const rhrZ = rhrSD === 0 ? 0 : (rhr7d - rhrBase) / rhrSD;     // higher = WORSE
  const composite = hrvZ - rhrZ;                                 // higher = better balance
  // Map z (typically −2..+2) to 0..100, clipped.
  const score = Math.max(0, Math.min(100, 50 + composite * 25));

  return {
    value: {
      score,
      hrvZ,
      rhrZ,
      hrv7dMean: hrv7d,
      rhr7dMean: rhr7d,
      hrvBaselineMean: hrvBase,
      rhrBaselineMean: rhrBase,
    },
    sufficiency: sorted.length >= 28 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/autonomic-balance.test.ts`
Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/autonomic-balance.ts tests/lib/health/analytics/autonomic-balance.test.ts
git commit -m "feat(health): add autonomic balance analytics (HRV+RHR z-score)"
```

---

### Task 13: ACWR (EWMA)

**Files:**
- Create: `src/lib/health/analytics/acwr.ts`
- Test: `tests/lib/health/analytics/acwr.test.ts`

> Note: existing `training-load-service.ts` has a simpler rolling-window ACWR. Phase 1 introduces an EWMA variant (Williams et al. 2017, Murray et al. 2017 — more sensitive than rolling window) for the new module. The existing function stays in place for backward compatibility.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/acwr.test.ts
import { describe, it, expect } from 'vitest';
import { computeACWR } from '$lib/health/analytics/acwr';

describe('computeACWR', () => {
  it('returns ratio ~1 for steady load', () => {
    const days = Array.from({ length: 28 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      load: 10,
    }));
    const r = computeACWR(days);
    expect(r.value.ratio).toBeGreaterThan(0.95);
    expect(r.value.ratio).toBeLessThan(1.05);
    expect(r.value.zone).toBe('optimal');
  });

  it('classifies sudden spike as caution or danger', () => {
    const baseline = Array.from({ length: 21 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`, load: 5,
    }));
    const spike = Array.from({ length: 7 }).map((_, i) => ({
      date: `2026-01-${String(i + 22).padStart(2, '0')}`, load: 25,
    }));
    const r = computeACWR([...baseline, ...spike]);
    expect(['caution', 'danger']).toContain(r.value.zone);
  });

  it('reports insufficient with < 14 days', () => {
    const r = computeACWR([{ date: '2026-01-01', load: 5 }]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/acwr.test.ts`
Expected: FAIL — module not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/acwr.ts
import type { MetricResult } from './types';

export type LoadDay = { date: string; load: number };
export type ACWRZone = 'detraining' | 'undertraining' | 'optimal' | 'caution' | 'danger';

export type ACWRResult = {
  acuteEWMA: number;
  chronicEWMA: number;
  ratio: number;
  zone: ACWRZone;
};

export function computeACWR(days: LoadDay[]): MetricResult<ACWRResult> {
  if (days.length < 14) {
    return {
      value: { acuteEWMA: 0, chronicEWMA: 0, ratio: 0, zone: 'detraining' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: days.length,
    };
  }
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const acute = ewma(sorted.map((d) => d.load), 7);
  const chronic = ewma(sorted.map((d) => d.load), 28);
  const ratio = chronic === 0 ? 0 : acute / chronic;
  const zone: ACWRZone =
    ratio < 0.5 ? 'detraining' :
    ratio < 0.8 ? 'undertraining' :
    ratio <= 1.3 ? 'optimal' :
    ratio <= 1.5 ? 'caution' : 'danger';
  return {
    value: { acuteEWMA: acute, chronicEWMA: chronic, ratio, zone },
    sufficiency: sorted.length >= 28 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

function ewma(values: number[], halfLifeDays: number): number {
  if (values.length === 0) return 0;
  const lambda = 1 - Math.exp(Math.log(0.5) / halfLifeDays);
  let s = values[0];
  for (let i = 1; i < values.length; i++) {
    s = lambda * values[i] + (1 - lambda) * s;
  }
  return s;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/acwr.test.ts`
Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/acwr.ts tests/lib/health/analytics/acwr.test.ts
git commit -m "feat(health): add EWMA ACWR analytics (Williams 2017)"
```

---

### Task 14: VO₂max percentile (ACSM lookup)

**Files:**
- Create: `src/lib/health/analytics/vo2max-percentile.ts`
- Test: `tests/lib/health/analytics/vo2max-percentile.test.ts`

> Use a coarse ACSM-derived male table (the user's profile is male per `+447359228511` registry; female table is included for completeness). The lookup table is intentionally small — five percentile breakpoints per age band.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/vo2max-percentile.test.ts
import { describe, it, expect } from 'vitest';
import { computeVO2MaxResult } from '$lib/health/analytics/vo2max-percentile';

describe('computeVO2MaxResult', () => {
  it('returns the latest value and trend slope', () => {
    const series = [
      { date: '2026-01-01', value: 40 },
      { date: '2026-02-01', value: 42 },
      { date: '2026-03-01', value: 44 },
    ];
    const r = computeVO2MaxResult(series, { age: 35, sex: 'male' });
    expect(r.value.current).toBe(44);
    expect(r.value.trendSlopePerMonth).toBeGreaterThan(0);
    expect(r.value.percentile).toBeGreaterThan(0);
    expect(r.sufficiency).toBe('ok');
  });

  it('reports insufficient with no data', () => {
    const r = computeVO2MaxResult([], { age: 35, sex: 'male' });
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/vo2max-percentile.test.ts`
Expected: FAIL — module not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/vo2max-percentile.ts
import type { MetricResult } from './types';

export type VO2Sample = { date: string; value: number };
export type Profile = { age: number; sex: 'male' | 'female' };

export type VO2Result = {
  current: number;
  trendSlopePerMonth: number;
  percentile: number;
  band: 'poor' | 'fair' | 'good' | 'excellent' | 'superior';
};

// ACSM 11th ed. percentile breakpoints (cardiorespiratory fitness, mL/kg/min).
// Columns: 20th, 40th, 60th, 80th, 95th. Rows: age bands.
const ACSM_MALE: Record<string, [number, number, number, number, number]> = {
  '20-29': [37.1, 41.0, 45.0, 49.0, 56.2],
  '30-39': [35.1, 38.9, 43.0, 47.0, 53.7],
  '40-49': [33.0, 36.7, 40.5, 44.5, 51.1],
  '50-59': [30.2, 33.8, 37.4, 41.0, 47.3],
  '60-69': [27.5, 30.6, 33.7, 36.7, 42.4],
  '70-79': [24.9, 27.5, 30.0, 32.5, 38.0],
};
const ACSM_FEMALE: Record<string, [number, number, number, number, number]> = {
  '20-29': [29.9, 33.0, 36.0, 39.5, 45.5],
  '30-39': [28.0, 31.0, 33.8, 37.0, 42.0],
  '40-49': [25.5, 28.0, 30.5, 33.5, 38.0],
  '50-59': [22.7, 25.0, 27.4, 30.0, 34.5],
  '60-69': [21.0, 23.0, 25.0, 27.0, 31.0],
  '70-79': [19.5, 21.0, 22.5, 24.5, 28.0],
};

const PERCENTILES = [20, 40, 60, 80, 95];

export function computeVO2MaxResult(series: VO2Sample[], profile: Profile): MetricResult<VO2Result> {
  if (series.length === 0) {
    return {
      value: { current: 0, trendSlopePerMonth: 0, percentile: 0, band: 'poor' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: 0,
    };
  }
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted[sorted.length - 1].value;
  const slope = linearSlopePerMonth(sorted);
  const breakpoints = lookupBreakpoints(profile);
  const percentile = percentileFromBreakpoints(current, breakpoints);
  const band: VO2Result['band'] =
    percentile >= 80 ? 'superior' :
    percentile >= 60 ? 'excellent' :
    percentile >= 40 ? 'good' :
    percentile >= 20 ? 'fair' : 'poor';

  return {
    value: { current, trendSlopePerMonth: slope, percentile, band },
    sufficiency: sorted.length >= 3 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

function lookupBreakpoints(p: Profile): [number, number, number, number, number] {
  const table = p.sex === 'male' ? ACSM_MALE : ACSM_FEMALE;
  const band =
    p.age < 30 ? '20-29' :
    p.age < 40 ? '30-39' :
    p.age < 50 ? '40-49' :
    p.age < 60 ? '50-59' :
    p.age < 70 ? '60-69' : '70-79';
  return table[band];
}

function percentileFromBreakpoints(v: number, bps: [number, number, number, number, number]): number {
  if (v < bps[0]) return Math.max(0, (v / bps[0]) * 20);
  for (let i = 0; i < bps.length - 1; i++) {
    if (v < bps[i + 1]) {
      const span = bps[i + 1] - bps[i];
      const within = span === 0 ? 0 : (v - bps[i]) / span;
      return PERCENTILES[i] + within * (PERCENTILES[i + 1] - PERCENTILES[i]);
    }
  }
  return 95 + Math.min(5, ((v - bps[4]) / Math.max(1, bps[4])) * 5);
}

function linearSlopePerMonth(series: VO2Sample[]): number {
  if (series.length < 2) return 0;
  const t0 = new Date(series[0].date).getTime();
  const xs = series.map((s) => (new Date(s.date).getTime() - t0) / (1000 * 60 * 60 * 24 * 30));
  const ys = series.map((s) => s.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/vo2max-percentile.test.ts`
Expected: 2/2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/vo2max-percentile.ts tests/lib/health/analytics/vo2max-percentile.test.ts
git commit -m "feat(health): add VO2max ACSM-percentile analytics"
```

---

### Task 15: Polarised training distribution

**Files:**
- Create: `src/lib/health/analytics/polarised.ts`
- Test: `tests/lib/health/analytics/polarised.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/polarised.test.ts
import { describe, it, expect } from 'vitest';
import { computePolarised } from '$lib/health/analytics/polarised';

describe('computePolarised', () => {
  it('classifies 80/20 split as polarised', () => {
    const r = computePolarised([
      { z0: 0, z1: 50_000, z2: 30_000, z3: 0, z4: 15_000, z5: 5_000 },
    ]);
    expect(r.value.easyPct).toBeGreaterThanOrEqual(80);
    expect(r.value.hardPct).toBeGreaterThanOrEqual(10);
    expect(r.value.verdict).toBe('polarised');
  });

  it('flags junk-middle when Z3 dominates', () => {
    const r = computePolarised([
      { z0: 0, z1: 0, z2: 5_000, z3: 90_000, z4: 5_000, z5: 0 },
    ]);
    expect(r.value.verdict).toBe('junk-middle');
  });

  it('reports insufficient with no workouts', () => {
    const r = computePolarised([]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/polarised.test.ts`
Expected: FAIL — module not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/polarised.ts
import type { MetricResult } from './types';

export type ZoneDurations = {
  z0: number; z1: number; z2: number; z3: number; z4: number; z5: number;
};

export type PolarisedResult = {
  easyPct: number;        // Z1+Z2 (Z0 excluded — recovery noise)
  midPct: number;         // Z3
  hardPct: number;        // Z4+Z5
  verdict: 'polarised' | 'pyramid' | 'junk-middle' | 'insufficient-volume';
  totalMinutes: number;
};

export function computePolarised(workouts: ZoneDurations[]): MetricResult<PolarisedResult> {
  if (workouts.length === 0) {
    return {
      value: { easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume', totalMinutes: 0 },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: 0,
    };
  }
  let easy = 0, mid = 0, hard = 0;
  for (const w of workouts) {
    easy += w.z1 + w.z2;
    mid += w.z3;
    hard += w.z4 + w.z5;
  }
  const total = easy + mid + hard;
  if (total === 0) {
    return {
      value: { easyPct: 0, midPct: 0, hardPct: 0, verdict: 'insufficient-volume', totalMinutes: 0 },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: workouts.length,
    };
  }
  const easyPct = (easy / total) * 100;
  const midPct = (mid / total) * 100;
  const hardPct = (hard / total) * 100;
  const verdict: PolarisedResult['verdict'] =
    midPct > 50 ? 'junk-middle' :
    easyPct >= 80 && hardPct >= 10 ? 'polarised' :
    easyPct >= 70 && midPct >= 15 ? 'pyramid' :
    'pyramid';
  return {
    value: { easyPct, midPct, hardPct, verdict, totalMinutes: total / 60_000 },
    sufficiency: 'ok',
    asOf: new Date().toISOString(),
    sampleSize: workouts.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/polarised.test.ts`
Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/polarised.ts tests/lib/health/analytics/polarised.test.ts
git commit -m "feat(health): add polarised training distribution analytics (Seiler 2010)"
```

---

### Task 16: Recovery debt

**Files:**
- Create: `src/lib/health/analytics/recovery-debt.ts`
- Test: `tests/lib/health/analytics/recovery-debt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/health/analytics/recovery-debt.test.ts
import { describe, it, expect } from 'vitest';
import { computeRecoveryDebt } from '$lib/health/analytics/recovery-debt';

describe('computeRecoveryDebt', () => {
  it('returns zero debt when actual sleep meets need every night', () => {
    const series = Array.from({ length: 14 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      sleepNeedMin: 480, sleepActualMin: 480, strain: 12, recoveryScore: 70,
    }));
    const r = computeRecoveryDebt(series);
    expect(r.value.sleepDebtMin).toBe(0);
    expect(r.value.overdrawn).toBe(false);
  });

  it('flags overdrawn when accumulated debt > 240 min', () => {
    const series = Array.from({ length: 14 }).map((_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      sleepNeedMin: 480, sleepActualMin: 420, strain: 14, recoveryScore: 55,
    }));
    const r = computeRecoveryDebt(series);
    expect(r.value.sleepDebtMin).toBeGreaterThan(240);
    expect(r.value.overdrawn).toBe(true);
  });

  it('reports insufficient with < 7 nights', () => {
    const r = computeRecoveryDebt([
      { date: '2026-01-01', sleepNeedMin: 480, sleepActualMin: 480, strain: 12, recoveryScore: 70 },
    ]);
    expect(r.sufficiency).toBe('insufficient');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/lib/health/analytics/recovery-debt.test.ts`
Expected: FAIL — module not resolvable.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/analytics/recovery-debt.ts
import type { MetricResult } from './types';

export type RecoverySample = {
  date: string;
  sleepNeedMin: number;
  sleepActualMin: number;
  strain: number;
  recoveryScore: number;
};

export type RecoveryDebtResult = {
  sleepDebtMin: number;
  strainRecoveryBalance: number;     // mean(strain_7d) − mean(recovery_7d)/10 — >0 means strain dominant
  overdrawn: boolean;
  series: { date: string; debt: number }[];
};

export function computeRecoveryDebt(series: RecoverySample[]): MetricResult<RecoveryDebtResult> {
  if (series.length < 7) {
    return {
      value: { sleepDebtMin: 0, strainRecoveryBalance: 0, overdrawn: false, series: [] },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: series.length,
    };
  }
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  let cumDebt = 0;
  const debtSeries: { date: string; debt: number }[] = [];
  for (const s of sorted.slice(-14)) {
    const nightly = Math.max(0, s.sleepNeedMin - s.sleepActualMin);
    cumDebt += nightly;
    debtSeries.push({ date: s.date, debt: cumDebt });
  }
  const last7 = sorted.slice(-7);
  const meanStrain = last7.reduce((a, b) => a + b.strain, 0) / last7.length;
  const meanRecovery = last7.reduce((a, b) => a + b.recoveryScore, 0) / last7.length;
  // Whoop strain ranges 0–21; recovery 0–100. Normalise recovery into the strain scale (÷10) then take the gap.
  const balance = meanStrain - meanRecovery / 10;
  const overdrawn = cumDebt > 240 || balance > 8;
  return {
    value: { sleepDebtMin: cumDebt, strainRecoveryBalance: balance, overdrawn, series: debtSeries },
    sufficiency: sorted.length >= 14 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run tests/lib/health/analytics/recovery-debt.test.ts`
Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/analytics/recovery-debt.ts tests/lib/health/analytics/recovery-debt.test.ts
git commit -m "feat(health): add recovery debt analytics"
```

---

## Phase 2 — Service layer + endpoints

> Each service queries the DB for the analytics' inputs and feeds the pure function. Endpoints follow the existing `training-load/+server.ts` pattern: try/catch → JSON.

### Task 17: Autonomic balance service + endpoint

**Files:**
- Create: `src/lib/health/services/autonomic-balance-service.ts`
- Create: `src/routes/api/health/autonomic/+server.ts`

- [ ] **Step 1: Create the service**

```ts
// src/lib/health/services/autonomic-balance-service.ts
import { db } from '$lib/db';
import { whoopRecovery } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computeAutonomicBalance, type AutonomicSample } from '$lib/health/analytics/autonomic-balance';

export async function getAutonomicBalance() {
  const since = Math.floor(Date.now() / 1000) - 28 * 86400;
  const rows = await db
    .select({
      created: whoopRecovery.createdDate,
      hrv: whoopRecovery.hrvRmssd,
      rhr: whoopRecovery.restingHeartRate,
    })
    .from(whoopRecovery)
    .where(gte(whoopRecovery.createdDate, since))
    .orderBy(asc(whoopRecovery.createdDate));

  const series: AutonomicSample[] = rows.map((r) => ({
    date: new Date(r.created * 1000).toISOString().slice(0, 10),
    hrv: r.hrv,
    rhr: r.rhr,
  }));
  return computeAutonomicBalance(series);
}
```

- [ ] **Step 2: Create the endpoint**

```ts
// src/routes/api/health/autonomic/+server.ts
import { json } from '@sveltejs/kit';
import { getAutonomicBalance } from '$lib/health/services/autonomic-balance-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getAutonomicBalance());
  } catch (err) {
    console.error('Failed to compute autonomic balance:', err);
    return json({ error: 'Failed to compute autonomic balance' }, { status: 500 });
  }
};
```

- [ ] **Step 3: Smoke-test the endpoint**

Run: `npm run dev` (background), then `curl http://homeserv:5173/api/health/autonomic | head -c 300`
Expected: JSON body with `value`, `sufficiency`, `asOf`, `sampleSize`. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/health/services/autonomic-balance-service.ts src/routes/api/health/autonomic/+server.ts
git commit -m "feat(health): add /api/health/autonomic endpoint"
```

---

### Task 18: Sleep regularity service + endpoint

**Files:**
- Create: `src/lib/health/services/sleep-regularity-service.ts`
- Create: `src/routes/api/health/sleep-regularity/+server.ts`

- [ ] **Step 1: Create the service**

```ts
// src/lib/health/services/sleep-regularity-service.ts
import { db } from '$lib/db';
import { whoopSleep } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { computeSRI, type SleepInterval } from '$lib/health/analytics/sri';

export async function getSleepRegularity() {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const rows = await db
    .select({
      start: whoopSleep.startDate,
      end: whoopSleep.endDate,
      nap: whoopSleep.nap,
    })
    .from(whoopSleep)
    .where(and(gte(whoopSleep.startDate, since), eq(whoopSleep.nap, false)))
    .orderBy(asc(whoopSleep.startDate));

  const intervals: SleepInterval[] = rows.map((r) => ({
    startLocalIso: new Date(r.start * 1000).toISOString(),
    endLocalIso: new Date(r.end * 1000).toISOString(),
  }));
  return computeSRI(intervals);
}
```

- [ ] **Step 2: Create the endpoint**

```ts
// src/routes/api/health/sleep-regularity/+server.ts
import { json } from '@sveltejs/kit';
import { getSleepRegularity } from '$lib/health/services/sleep-regularity-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getSleepRegularity());
  } catch (err) {
    console.error('Failed to compute sleep regularity:', err);
    return json({ error: 'Failed to compute sleep regularity' }, { status: 500 });
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/health/services/sleep-regularity-service.ts src/routes/api/health/sleep-regularity/+server.ts
git commit -m "feat(health): add /api/health/sleep-regularity endpoint"
```

---

### Task 19: Circadian alignment service + endpoint

**Files:**
- Create: `src/lib/health/services/circadian-service.ts`
- Create: `src/routes/api/health/circadian/+server.ts`

- [ ] **Step 1: Create the service + endpoint**

```ts
// src/lib/health/services/circadian-service.ts
import { db } from '$lib/db';
import { whoopSleep } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { computeCircadianAlignment } from '$lib/health/analytics/circadian';
import type { SleepInterval } from '$lib/health/analytics/sri';

export async function getCircadianAlignment() {
  const since = Math.floor(Date.now() / 1000) - 28 * 86400;
  const rows = await db
    .select({ start: whoopSleep.startDate, end: whoopSleep.endDate, nap: whoopSleep.nap })
    .from(whoopSleep)
    .where(and(gte(whoopSleep.startDate, since), eq(whoopSleep.nap, false)))
    .orderBy(asc(whoopSleep.startDate));
  const intervals: SleepInterval[] = rows.map((r) => ({
    startLocalIso: new Date(r.start * 1000).toISOString(),
    endLocalIso: new Date(r.end * 1000).toISOString(),
  }));
  return computeCircadianAlignment(intervals);
}
```

```ts
// src/routes/api/health/circadian/+server.ts
import { json } from '@sveltejs/kit';
import { getCircadianAlignment } from '$lib/health/services/circadian-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getCircadianAlignment());
  } catch (err) {
    console.error('Failed to compute circadian alignment:', err);
    return json({ error: 'Failed to compute circadian alignment' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/services/circadian-service.ts src/routes/api/health/circadian/+server.ts
git commit -m "feat(health): add /api/health/circadian endpoint"
```

---

### Task 20: ACWR (EWMA) service + endpoint

**Files:**
- Create: `src/lib/health/services/acwr-service.ts`
- Create: `src/routes/api/health/acwr/+server.ts`

- [ ] **Step 1: Create service + endpoint**

```ts
// src/lib/health/services/acwr-service.ts
import { db } from '$lib/db';
import { whoopCycles } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computeACWR, type LoadDay } from '$lib/health/analytics/acwr';

export async function getACWR() {
  const since = Math.floor(Date.now() / 1000) - 28 * 86400;
  const rows = await db
    .select({ start: whoopCycles.startDate, strain: whoopCycles.strain })
    .from(whoopCycles)
    .where(gte(whoopCycles.startDate, since))
    .orderBy(asc(whoopCycles.startDate));

  // Roll up to one row per local day.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = new Date(r.start * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.strain);
  }
  const days: LoadDay[] = [...byDay.entries()].map(([date, load]) => ({ date, load }));
  return computeACWR(days);
}
```

```ts
// src/routes/api/health/acwr/+server.ts
import { json } from '@sveltejs/kit';
import { getACWR } from '$lib/health/services/acwr-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getACWR());
  } catch (err) {
    console.error('Failed to compute ACWR:', err);
    return json({ error: 'Failed to compute ACWR' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/services/acwr-service.ts src/routes/api/health/acwr/+server.ts
git commit -m "feat(health): add /api/health/acwr endpoint (EWMA)"
```

---

### Task 21: Monotony service + endpoint

**Files:**
- Create: `src/lib/health/services/monotony-service.ts`
- Create: `src/routes/api/health/monotony/+server.ts`

- [ ] **Step 1: Create service + endpoint**

```ts
// src/lib/health/services/monotony-service.ts
import { db } from '$lib/db';
import { whoopCycles } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computeMonotony } from '$lib/health/analytics/monotony';

export async function getMonotony() {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = await db
    .select({ start: whoopCycles.startDate, strain: whoopCycles.strain })
    .from(whoopCycles)
    .where(gte(whoopCycles.startDate, since))
    .orderBy(asc(whoopCycles.startDate));

  // Group by local day to a flat array of 7 values.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const day = new Date(r.start * 1000).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.strain);
  }
  // Fill missing days with zero.
  const today = new Date();
  const series: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push(byDay.get(key) ?? 0);
  }
  return computeMonotony(series);
}
```

```ts
// src/routes/api/health/monotony/+server.ts
import { json } from '@sveltejs/kit';
import { getMonotony } from '$lib/health/services/monotony-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getMonotony());
  } catch (err) {
    console.error('Failed to compute monotony:', err);
    return json({ error: 'Failed to compute monotony' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/services/monotony-service.ts src/routes/api/health/monotony/+server.ts
git commit -m "feat(health): add /api/health/monotony endpoint"
```

---

### Task 22: VO₂max service + endpoint

**Files:**
- Create: `src/lib/health/services/vo2max-service.ts`
- Create: `src/routes/api/health/vo2max/+server.ts`

- [ ] **Step 1: Create service + endpoint**

```ts
// src/lib/health/services/vo2max-service.ts
import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { computeVO2MaxResult, type VO2Sample } from '$lib/health/analytics/vo2max-percentile';

const PROFILE = { age: 32, sex: 'male' as const };  // TODO(personal): wire to a profile config when one exists

export async function getVO2Max() {
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  const rows = await db
    .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
    .from(appleHealthMetrics)
    .where(and(eq(appleHealthMetrics.metricName, 'vo2_max'), gte(appleHealthMetrics.date, since)))
    .orderBy(asc(appleHealthMetrics.date));

  const series: VO2Sample[] = rows
    .filter((r) => r.value != null)
    .map((r) => ({ date: new Date(r.date * 1000).toISOString().slice(0, 10), value: (r.value as number) / 100 }));

  return computeVO2MaxResult(series, PROFILE);
}
```

```ts
// src/routes/api/health/vo2max/+server.ts
import { json } from '@sveltejs/kit';
import { getVO2Max } from '$lib/health/services/vo2max-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getVO2Max());
  } catch (err) {
    console.error('Failed to compute VO2max:', err);
    return json({ error: 'Failed to compute VO2max' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/services/vo2max-service.ts src/routes/api/health/vo2max/+server.ts
git commit -m "feat(health): add /api/health/vo2max endpoint"
```

---

### Task 23: Polarised service + endpoint

**Files:**
- Create: `src/lib/health/services/polarised-service.ts`
- Create: `src/routes/api/health/polarised/+server.ts`

- [ ] **Step 1: Create service + endpoint**

```ts
// src/lib/health/services/polarised-service.ts
import { db } from '$lib/db';
import { whoopWorkouts } from '$lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { computePolarised, type ZoneDurations } from '$lib/health/analytics/polarised';

export async function getPolarised() {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const rows = await db
    .select({
      z0: whoopWorkouts.zoneZero,
      z1: whoopWorkouts.zoneOne,
      z2: whoopWorkouts.zoneTwo,
      z3: whoopWorkouts.zoneThree,
      z4: whoopWorkouts.zoneFour,
      z5: whoopWorkouts.zoneFive,
    })
    .from(whoopWorkouts)
    .where(gte(whoopWorkouts.startDate, since))
    .orderBy(asc(whoopWorkouts.startDate));

  const zones: ZoneDurations[] = rows.map((r) => ({
    z0: r.z0, z1: r.z1, z2: r.z2, z3: r.z3, z4: r.z4, z5: r.z5,
  }));
  return computePolarised(zones);
}
```

```ts
// src/routes/api/health/polarised/+server.ts
import { json } from '@sveltejs/kit';
import { getPolarised } from '$lib/health/services/polarised-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getPolarised());
  } catch (err) {
    console.error('Failed to compute polarised distribution:', err);
    return json({ error: 'Failed to compute polarised distribution' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/services/polarised-service.ts src/routes/api/health/polarised/+server.ts
git commit -m "feat(health): add /api/health/polarised endpoint"
```

---

### Task 24: Recovery debt service + endpoint

**Files:**
- Create: `src/lib/health/services/recovery-debt-service.ts`
- Create: `src/routes/api/health/recovery-debt/+server.ts`

- [ ] **Step 1: Create service + endpoint**

```ts
// src/lib/health/services/recovery-debt-service.ts
import { db } from '$lib/db';
import { whoopSleep, whoopCycles, whoopRecovery } from '$lib/db/schema';
import { gte, eq, and, asc } from 'drizzle-orm';
import { computeRecoveryDebt, type RecoverySample } from '$lib/health/analytics/recovery-debt';

export async function getRecoveryDebt() {
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  const [sleeps, cycles, recoveries] = await Promise.all([
    db.select({
        start: whoopSleep.startDate,
        baselineNeed: whoopSleep.baselineNeed,
        debtNeed: whoopSleep.needFromDebt,
        strainNeed: whoopSleep.needFromStrain,
        inBed: whoopSleep.totalInBed,
        awake: whoopSleep.totalAwake,
        nap: whoopSleep.nap,
      })
      .from(whoopSleep)
      .where(and(gte(whoopSleep.startDate, since), eq(whoopSleep.nap, false)))
      .orderBy(asc(whoopSleep.startDate)),
    db.select({ start: whoopCycles.startDate, strain: whoopCycles.strain })
      .from(whoopCycles)
      .where(gte(whoopCycles.startDate, since))
      .orderBy(asc(whoopCycles.startDate)),
    db.select({ created: whoopRecovery.createdDate, score: whoopRecovery.recoveryScore })
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, since))
      .orderBy(asc(whoopRecovery.createdDate)),
  ]);

  const byDay = new Map<string, RecoverySample>();

  for (const s of sleeps) {
    const date = new Date(s.start * 1000).toISOString().slice(0, 10);
    const needMs = s.baselineNeed + s.debtNeed + s.strainNeed;
    const actualMs = Math.max(0, s.inBed - s.awake);
    byDay.set(date, {
      date,
      sleepNeedMin: needMs / 60_000,
      sleepActualMin: actualMs / 60_000,
      strain: 0,
      recoveryScore: 0,
    });
  }
  for (const c of cycles) {
    const date = new Date(c.start * 1000).toISOString().slice(0, 10);
    const ent = byDay.get(date) ?? { date, sleepNeedMin: 0, sleepActualMin: 0, strain: 0, recoveryScore: 0 };
    ent.strain = c.strain;
    byDay.set(date, ent);
  }
  for (const r of recoveries) {
    const date = new Date(r.created * 1000).toISOString().slice(0, 10);
    const ent = byDay.get(date) ?? { date, sleepNeedMin: 0, sleepActualMin: 0, strain: 0, recoveryScore: 0 };
    ent.recoveryScore = r.score;
    byDay.set(date, ent);
  }

  const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return computeRecoveryDebt(series);
}
```

```ts
// src/routes/api/health/recovery-debt/+server.ts
import { json } from '@sveltejs/kit';
import { getRecoveryDebt } from '$lib/health/services/recovery-debt-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getRecoveryDebt());
  } catch (err) {
    console.error('Failed to compute recovery debt:', err);
    return json({ error: 'Failed to compute recovery debt' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/health/services/recovery-debt-service.ts src/routes/api/health/recovery-debt/+server.ts
git commit -m "feat(health): add /api/health/recovery-debt endpoint"
```

---

## Phase 3 — Module svelte components

> Each module is a thin wrapper around `MetricCard` that renders the inline summary and (optionally) a sparkline. They each accept the typed `MetricResult<T>` from the API.

### Task 25: AutonomicBalance.svelte

**Files:**
- Create: `src/lib/components/health/AutonomicBalance.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data,
    onopenDetail,
    onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="Autonomic Balance"
  evidenceId="autonomic-balance"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="ab-row">
      <div class="ab-score">{Math.round(data.value.score)}</div>
      <div class="ab-meta">
        <div class="ab-line"><span>HRV 7d</span><span class="ab-val">{data.value.hrv7dMean.toFixed(0)} ms</span></div>
        <div class="ab-bar"><div class="ab-bar-fill" style="width:{Math.min(100, Math.max(0, 50 + data.value.hrvZ * 25))}%;"></div></div>
        <div class="ab-line"><span>RHR 7d</span><span class="ab-val">{data.value.rhr7dMean.toFixed(0)} bpm</span></div>
        <div class="ab-bar"><div class="ab-bar-fill" style="width:{Math.min(100, Math.max(0, 50 - data.value.rhrZ * 25))}%;"></div></div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .ab-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .ab-score { font-size: 56px; font-weight: 200; color: var(--accent); line-height: 1; font-family: var(--font-display); }
  .ab-meta { display: flex; flex-direction: column; gap: 0.3rem; }
  .ab-line {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);
  }
  .ab-val { color: var(--text-primary); }
  .ab-bar { height: 2px; background: var(--card-border); }
  .ab-bar-fill { height: 2px; background: var(--accent); }
  @media (max-width: 480px) {
    .ab-row { grid-template-columns: 1fr; }
    .ab-score { font-size: 44px; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/AutonomicBalance.svelte
git commit -m "feat(health): add AutonomicBalance module component"
```

---

### Task 26: SleepRegularityIndex.svelte

**Files:**
- Create: `src/lib/components/health/SleepRegularityIndex.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const band = $derived.by(() => {
    if (!data) return 'low';
    const v = data.value;
    return v >= 87 ? 'regular' : v >= 70 ? 'mid' : 'irregular';
  });
</script>

<MetricCard
  label="Sleep Regularity Index"
  evidenceId="sri"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="sri-row">
      <div class="sri-score">{Math.round(data.value)}</div>
      <div class="sri-rest">
        <div class="sri-band sri-{band}">
          {band === 'regular' ? 'Regular' : band === 'mid' ? 'Moderately regular' : 'Irregular'}
        </div>
        <div class="sri-bar">
          <div class="sri-bar-fill" style="width: {Math.min(100, Math.max(0, data.value))}%;"></div>
          <div class="sri-bar-tick" style="left: 70%;" title="moderately regular"></div>
          <div class="sri-bar-tick" style="left: 87%;" title="regular"></div>
        </div>
        <p class="sri-note">Phillips 2017. Higher = more consistent sleep/wake schedule.</p>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .sri-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .sri-score { font-size: 56px; font-weight: 200; color: var(--accent); line-height: 1; font-family: var(--font-display); }
  .sri-rest { display: flex; flex-direction: column; gap: 0.4rem; }
  .sri-band {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em;
  }
  .sri-band.sri-regular { color: var(--accent); }
  .sri-band.sri-mid { color: var(--text-secondary); }
  .sri-band.sri-irregular { color: #c44; }
  .sri-bar { position: relative; height: 2px; background: var(--card-border); }
  .sri-bar-fill { height: 2px; background: var(--accent); }
  .sri-bar-tick { position: absolute; top: -2px; width: 1px; height: 6px; background: var(--text-ghost); }
  .sri-note { margin: 0; font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  @media (max-width: 480px) { .sri-row { grid-template-columns: 1fr; } .sri-score { font-size: 44px; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/SleepRegularityIndex.svelte
git commit -m "feat(health): add SleepRegularityIndex module component"
```

---

### Task 27: CircadianAlignment.svelte

**Files:**
- Create: `src/lib/components/health/CircadianAlignment.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');

  function fmtMid(min: number): string {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
</script>

<MetricCard
  label="Circadian Alignment"
  evidenceId="circadian-alignment"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="ca-grid">
      <div>
        <div class="ca-label">7d midpoint</div>
        <div class="ca-val">{fmtMid(data.value.recentMidpointMin)}</div>
      </div>
      <div>
        <div class="ca-label">Baseline midpoint</div>
        <div class="ca-val">{fmtMid(data.value.baselineMidpointMin)}</div>
      </div>
      <div>
        <div class="ca-label">Drift</div>
        <div class="ca-val ca-{data.value.flag}">
          {data.value.driftHours > 0 ? '+' : ''}{data.value.driftHours.toFixed(1)} h
        </div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .ca-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
  .ca-label {
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--text-ghost);
  }
  .ca-val { font-size: 22px; font-weight: 300; color: var(--text-primary); margin-top: 4px; font-family: var(--font-mono); }
  .ca-val.ca-drift-late, .ca-val.ca-drift-early { color: #c44; }
  .ca-val.ca-aligned { color: var(--accent); }
  @media (max-width: 480px) { .ca-grid { grid-template-columns: 1fr 1fr; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/CircadianAlignment.svelte
git commit -m "feat(health): add CircadianAlignment module component"
```

---

### Task 28: RecoveryDebt.svelte

**Files:**
- Create: `src/lib/components/health/RecoveryDebt.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';
  import MiniSparkline from './MiniSparkline.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
  const points = $derived.by(() => (data?.value?.series ?? []).map((p: any) => ({ date: new Date(p.date), value: p.debt })));
</script>

<MetricCard
  label="Recovery Debt"
  evidenceId="recovery-debt"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="rd-row">
      <div class="rd-cell">
        <div class="rd-label">Sleep debt 14d</div>
        <div class="rd-val" class:rd-overdrawn={data.value.overdrawn}>
          {Math.round(data.value.sleepDebtMin)} min
        </div>
      </div>
      <div class="rd-cell">
        <div class="rd-label">Strain / Recovery</div>
        <div class="rd-val">
          {data.value.strainRecoveryBalance.toFixed(1)}
        </div>
      </div>
      <div class="rd-cell rd-spark">
        <div class="rd-label">Cumulative debt</div>
        <MiniSparkline points={points} height={28} color={data.value.overdrawn ? '#c44' : 'var(--accent)'} />
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .rd-row { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 1.25rem; align-items: center; }
  .rd-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .rd-label { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .rd-val { font-size: 22px; font-weight: 300; color: var(--text-primary); font-family: var(--font-mono); }
  .rd-val.rd-overdrawn { color: #c44; }
  @media (max-width: 480px) { .rd-row { grid-template-columns: 1fr 1fr; } .rd-spark { grid-column: 1 / -1; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/RecoveryDebt.svelte
git commit -m "feat(health): add RecoveryDebt module component"
```

---

### Task 29: ACWRInjuryRisk.svelte

**Files:**
- Create: `src/lib/components/health/ACWRInjuryRisk.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');

  function markerLeft(ratio: number): number {
    // 0 .. 2.0 mapped to 0 .. 100%
    return Math.min(100, Math.max(0, (ratio / 2) * 100));
  }
</script>

<MetricCard
  label="ACWR — Injury Risk"
  evidenceId="acwr"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="ar-row">
      <div class="ar-ratio ar-{data.value.zone}">{data.value.ratio.toFixed(2)}</div>
      <div class="ar-rest">
        <div class="ar-bar">
          <div class="ar-band-detrain" style="left:0%; width:25%;"></div>
          <div class="ar-band-under" style="left:25%; width:15%;"></div>
          <div class="ar-band-optimal" style="left:40%; width:25%;"></div>
          <div class="ar-band-caution" style="left:65%; width:10%;"></div>
          <div class="ar-band-danger" style="left:75%; width:25%;"></div>
          <div class="ar-marker" style="left: {markerLeft(data.value.ratio)}%;"></div>
        </div>
        <div class="ar-axis">
          <span>0.5</span><span>0.8</span><span>1.3</span><span>1.5</span>
        </div>
        <div class="ar-zone">{data.value.zone.toUpperCase()}</div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .ar-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .ar-ratio { font-size: 48px; font-weight: 200; line-height: 1; font-family: var(--font-display); color: var(--text-primary); }
  .ar-ratio.ar-optimal { color: var(--accent); }
  .ar-ratio.ar-caution, .ar-ratio.ar-undertraining { color: #b88a40; }
  .ar-ratio.ar-danger, .ar-ratio.ar-detraining { color: #c44; }
  .ar-rest { display: flex; flex-direction: column; gap: 0.35rem; }
  .ar-bar { position: relative; height: 8px; background: var(--card-border); }
  .ar-bar > div { position: absolute; top: 0; height: 8px; }
  .ar-band-optimal { background: rgba(184,84,31,0.25); }
  .ar-band-caution { background: rgba(184,138,64,0.4); }
  .ar-band-danger { background: rgba(196,68,68,0.4); }
  .ar-band-detrain { background: rgba(196,68,68,0.25); }
  .ar-band-under { background: rgba(184,138,64,0.25); }
  .ar-marker { width: 2px; background: var(--text-primary); top: -3px; height: 14px; }
  .ar-axis { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }
  .ar-zone { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; color: var(--text-secondary); }
  @media (max-width: 480px) { .ar-row { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/ACWRInjuryRisk.svelte
git commit -m "feat(health): add ACWRInjuryRisk module component"
```

---

### Task 30: TrainingMonotony.svelte

**Files:**
- Create: `src/lib/components/health/TrainingMonotony.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="Training Monotony &amp; Strain"
  evidenceId="monotony"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="tm-row">
      <div class="tm-cell">
        <div class="tm-label">Monotony (mean / SD)</div>
        <div class="tm-val tm-{data.value.band}">{data.value.monotony.toFixed(2)}</div>
      </div>
      <div class="tm-cell">
        <div class="tm-label">Strain (sum × monotony)</div>
        <div class="tm-val">{Math.round(data.value.strain)}</div>
      </div>
      <div class="tm-cell">
        <div class="tm-label">Verdict</div>
        <div class="tm-val tm-{data.value.band}">
          {data.value.band === 'high' ? 'High — vary intensity' : data.value.band === 'moderate' ? 'Moderate' : 'Low — well-varied'}
        </div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .tm-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
  .tm-cell { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .tm-label { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .tm-val { font-size: 20px; font-weight: 300; color: var(--text-primary); font-family: var(--font-mono); }
  .tm-val.tm-low { color: var(--accent); }
  .tm-val.tm-moderate { color: var(--text-secondary); }
  .tm-val.tm-high { color: #c44; }
  @media (max-width: 480px) { .tm-row { grid-template-columns: 1fr 1fr; } .tm-cell:nth-child(3) { grid-column: 1 / -1; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/TrainingMonotony.svelte
git commit -m "feat(health): add TrainingMonotony module component"
```

---

### Task 31: VO2MaxTrend.svelte

**Files:**
- Create: `src/lib/components/health/VO2MaxTrend.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="VO₂max — Cardio Percentile"
  evidenceId="vo2max"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="v-row">
      <div class="v-current">
        <div class="v-num">{data.value.current.toFixed(1)}</div>
        <div class="v-unit">mL/kg/min</div>
      </div>
      <div class="v-rest">
        <div class="v-line"><span>Percentile</span><span class="v-strong">{Math.round(data.value.percentile)}</span></div>
        <div class="v-bar"><div class="v-bar-fill" style="width: {Math.min(100, Math.max(0, data.value.percentile))}%;"></div></div>
        <div class="v-line"><span>Band</span><span class="v-strong">{data.value.band}</span></div>
        <div class="v-line">
          <span>Trend / month</span>
          <span class="v-strong">
            {data.value.trendSlopePerMonth > 0 ? '↑' : data.value.trendSlopePerMonth < 0 ? '↓' : '→'}
            {data.value.trendSlopePerMonth.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .v-row { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; }
  .v-current { display: flex; flex-direction: column; align-items: flex-start; }
  .v-num { font-size: 48px; font-weight: 200; color: var(--accent); font-family: var(--font-display); line-height: 1; }
  .v-unit { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .v-rest { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
  .v-line { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
  .v-strong { color: var(--text-primary); text-transform: capitalize; }
  .v-bar { height: 2px; background: var(--card-border); }
  .v-bar-fill { height: 2px; background: var(--accent); }
  @media (max-width: 480px) { .v-row { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/VO2MaxTrend.svelte
git commit -m "feat(health): add VO2MaxTrend module component"
```

---

### Task 32: PolarisedDistribution.svelte

**Files:**
- Create: `src/lib/components/health/PolarisedDistribution.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import MetricCard from './MetricCard.svelte';

  let {
    data, onopenDetail, onopenEvidence,
  }: { data: any; onopenDetail?: () => void; onopenEvidence?: (id: string) => void } = $props();

  const insufficient = $derived(!data || data.sufficiency === 'insufficient');
</script>

<MetricCard
  label="Polarised Training Distribution"
  evidenceId="polarised"
  {onopenDetail}
  {onopenEvidence}
  {insufficient}
>
  {#if data}
    <div class="pd-row">
      <div class="pd-stack">
        <div class="pd-easy" style="width: {data.value.easyPct}%;" title="Easy (Z1+Z2)">{Math.round(data.value.easyPct)}%</div>
        <div class="pd-mid" style="width: {data.value.midPct}%;" title="Mid (Z3)">{Math.round(data.value.midPct)}%</div>
        <div class="pd-hard" style="width: {data.value.hardPct}%;" title="Hard (Z4+Z5)">{Math.round(data.value.hardPct)}%</div>
      </div>
      <div class="pd-meta">
        <div class="pd-line"><span class="pd-dot pd-d-easy"></span>Easy</div>
        <div class="pd-line"><span class="pd-dot pd-d-mid"></span>Mid</div>
        <div class="pd-line"><span class="pd-dot pd-d-hard"></span>Hard</div>
      </div>
      <div class="pd-verdict pd-{data.value.verdict}">
        {data.value.verdict.replace('-', ' ')}
      </div>
    </div>
  {/if}
</MetricCard>

<style>
  .pd-row { display: grid; grid-template-columns: 1fr auto auto; gap: 1.25rem; align-items: center; }
  .pd-stack { display: flex; height: 22px; border: 1px solid var(--card-border); }
  .pd-stack > div { display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 10px; color: var(--bg); }
  .pd-easy { background: var(--accent); }
  .pd-mid { background: #b88a40; }
  .pd-hard { background: #6b3a1a; }
  .pd-meta { display: flex; flex-direction: column; gap: 4px; font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); }
  .pd-line { display: flex; align-items: center; gap: 6px; }
  .pd-dot { display: inline-block; width: 8px; height: 8px; border: 1px solid var(--card-border); }
  .pd-d-easy { background: var(--accent); }
  .pd-d-mid { background: #b88a40; }
  .pd-d-hard { background: #6b3a1a; }
  .pd-verdict {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
  }
  .pd-verdict.pd-polarised { color: var(--accent); }
  .pd-verdict.pd-pyramid { color: var(--text-secondary); }
  .pd-verdict.pd-junk-middle { color: #c44; }
  .pd-verdict.pd-insufficient-volume { color: var(--text-ghost); }
  @media (max-width: 640px) { .pd-row { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/PolarisedDistribution.svelte
git commit -m "feat(health): add PolarisedDistribution module component"
```

---

## Phase 4 — Restyle existing components

### Task 33: Rewrite ReadinessHero (split layout B)

**Files:**
- Modify: `src/lib/components/health/ReadinessHero.svelte`

- [ ] **Step 1: Replace the file with the split-layout B implementation**

```svelte
<script lang="ts">
  let {
    readiness,
    onopenDetail,
  }: { readiness: any; onopenDetail?: () => void } = $props();

  const factors = $derived(readiness?.factors ?? {});
</script>

<section class="rh">
  <div class="rh-inner">
    {#if readiness}
      <button type="button" class="rh-left" onclick={() => onopenDetail?.()} title="Open readiness detail">
        <div class="rh-kicker">Readiness</div>
        <div class="rh-score">{Math.round(readiness.score)}</div>
        <div class="rh-label">{readiness.label}</div>
        <p class="rh-recom">{readiness.recommendation}</p>
      </button>
      <div class="rh-right">
        <div class="rh-rk">Composite factors</div>
        {#each Object.entries(factors) as [key, factor]}
          {@const f = factor as any}
          {@const val = Math.round(f.value ?? 0)}
          <div class="rh-frow">
            <span class="rh-fkey">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span class="rh-fval">
              {#if key === 'hrvTrend' && f.raw != null}
                {Math.round(f.raw)} <span class="rh-unit">ms</span>
              {:else}
                {val}
              {/if}
            </span>
          </div>
          <div class="rh-fbar"><div class="rh-fbar-fill" style="width: {Math.min(100, Math.max(0, val))}%;"></div></div>
        {/each}
      </div>
    {:else}
      <p class="rh-empty">No readiness data available.</p>
    {/if}
  </div>
</section>

<style>
  .rh { padding: 1.5rem 1.5rem 2rem; max-width: 1200px; margin: 0 auto; }
  .rh-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 2.5rem;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    padding: 2rem 2rem 2rem;
  }
  .rh-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    color: inherit;
  }
  .rh-kicker {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.18em; color: var(--accent);
  }
  .rh-score {
    font-family: var(--font-display); font-size: 120px; font-weight: 200;
    line-height: 0.95; color: var(--accent); margin-top: 0.25rem;
  }
  .rh-label {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.18em; color: var(--text-secondary); margin-top: 0.5rem;
  }
  .rh-recom {
    margin: 1rem 0 0; font-size: 13px; line-height: 1.55;
    color: var(--text-secondary); max-width: 38ch;
  }
  .rh-right { display: flex; flex-direction: column; gap: 6px; }
  .rh-rk {
    font-family: var(--font-mono); font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--text-ghost); margin-bottom: 6px;
  }
  .rh-frow {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);
    text-transform: capitalize;
  }
  .rh-fkey { color: var(--text-secondary); }
  .rh-fval { color: var(--text-primary); }
  .rh-unit { color: var(--text-ghost); font-size: 10px; }
  .rh-fbar { height: 2px; background: var(--card-border); margin-bottom: 6px; }
  .rh-fbar-fill { height: 2px; background: var(--accent); }
  .rh-empty {
    font-family: var(--font-mono); font-size: 12px; color: var(--text-ghost);
    text-align: center; padding: 3rem 0;
  }
  @media (max-width: 768px) {
    .rh-inner { grid-template-columns: 1fr; padding: 1.25rem; gap: 1.5rem; }
    .rh-score { font-size: 80px; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/ReadinessHero.svelte
git commit -m "refactor(health): rewrite ReadinessHero as split layout (score + factor bars)"
```

---

### Task 34: Restyle SparklineStrip

**Files:**
- Modify: `src/lib/components/health/SparklineStrip.svelte`

- [ ] **Step 1: Replace the file**

```svelte
<script lang="ts">
  import MiniSparkline from './MiniSparkline.svelte';

  let { sparklines }: { sparklines: any[] } = $props();

  const labels: Record<string, string> = {
    recovery: 'Recovery', sleep: 'Sleep', heart_rate: 'Heart Rate', strain: 'Strain',
  };
  const units: Record<string, string> = { recovery: '%', sleep: '%', heart_rate: 'bpm', strain: '' };

  function points(s: any) {
    return s.values.map((v: any) => ({ date: new Date(v.date), value: v.value }));
  }
</script>

<section class="ss">
  <div class="ss-grid">
    {#each sparklines || [] as s}
      <div class="ss-cell nm-sec">
        <div class="ss-hd"><span class="sr-label-tight">{labels[s.metric] || s.metric}</span></div>
        <div class="ss-val">
          {Math.round(s.current)}<span class="ss-unit">{units[s.metric] || ''}</span>
        </div>
        <div class="ss-spark"><MiniSparkline points={points(s)} /></div>
        <div class="ss-trend">
          {s.trend === 'up' ? '↑' : s.trend === 'down' ? '↓' : '→'} 7d
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .ss { padding: 0 1.5rem; max-width: 1200px; margin: 0 auto; }
  .ss-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }
  .ss-cell { padding: 0.85rem 1rem 0.75rem; gap: 0; }
  .ss-hd { margin-bottom: 0.5rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--card-border); }
  .ss-val {
    font-family: var(--font-display); font-size: 26px; font-weight: 300;
    color: var(--text-primary); line-height: 1;
  }
  .ss-unit { font-size: 11px; color: var(--text-ghost); margin-left: 4px; }
  .ss-spark { margin-top: 6px; }
  .ss-trend { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); margin-top: 6px; }
  @media (max-width: 768px) { .ss-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/health/SparklineStrip.svelte
git commit -m "refactor(health): restyle SparklineStrip to .nm-sec language"
```

---

### Task 35: Restyle WeeklyStats, SleepBreakdown, BodySignals, ActivityTimeline, ActivityDetail

**Files:**
- Modify: `src/lib/components/health/WeeklyStats.svelte`
- Modify: `src/lib/components/health/SleepBreakdown.svelte`
- Modify: `src/lib/components/health/BodySignals.svelte`
- Modify: `src/lib/components/health/ActivityTimeline.svelte`
- Modify: `src/lib/components/health/ActivityDetail.svelte`

> Goal: replace `rounded-*` classes, `card-bg` rounded boxes, and inline `style="border-radius:..."` with `.nm-sec`-based markup. Preserve all existing data props and behaviour. Each file is small; restyle one at a time, smoke-check, then commit together at the end.

- [ ] **Step 1: Read each file to understand its current structure**

Run: `cat src/lib/components/health/WeeklyStats.svelte src/lib/components/health/SleepBreakdown.svelte src/lib/components/health/BodySignals.svelte src/lib/components/health/ActivityTimeline.svelte src/lib/components/health/ActivityDetail.svelte`
Expected: each file is 30–170 lines. Skim before editing.

- [ ] **Step 2: For each file, perform these mechanical edits**

a. Replace any wrapper `<section class="...">` with `<section class="nm-sec">`. Section headers become `<div class="nm-sec-hd"><span class="sr-label-tight">LABEL</span></div>`.
b. Remove every Tailwind `rounded-*` utility (search: `rounded-`).
c. Replace inline `border-radius` and `border-radius: 999px` with nothing (square corners by default).
d. Replace `bg-white/X` and `backdrop-blur-md` decorative wrappers with plain `.nm-sec` styling.
e. Replace bullet markers and dot separators with mono-typed `·` separators (already used in `/admin/files`).
f. For numeric metric labels, ensure they render in `.sr-label-tight` style (mono, 10px, uppercase, 0.12em).
g. For inline progress / range bars, change `h-1.5 rounded-full` to `h-[2px]` with no border-radius.
h. Keep all `style="color: var(--…)"` inline rules — they're consistent with `nm-tokens`.
i. Section padding: `padding: 0 1.5rem; max-width: 1200px; margin: 0 auto;` on the outermost wrapper.
j. Where the file uses Tailwind for grid/spacing on the OUTER element, prefer scoped CSS in a `<style>` block at the bottom for clarity.

- [ ] **Step 3: Smoke-test the page**

Run: `npm run dev` (background). Hit `/health` in a browser. Confirm each module still renders without console errors. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/health/WeeklyStats.svelte \
        src/lib/components/health/SleepBreakdown.svelte \
        src/lib/components/health/BodySignals.svelte \
        src/lib/components/health/ActivityTimeline.svelte \
        src/lib/components/health/ActivityDetail.svelte
git commit -m "refactor(health): restyle weekly/sleep/signals/activities to .nm-sec language"
```

---

## Phase 5 — Page assembly

### Task 36: Update +page.server.ts to fetch new endpoints

**Files:**
- Modify: `src/routes/health/+page.server.ts`

- [ ] **Step 1: Replace the file**

```ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const fetchJson = (path: string) =>
    fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const [
    readiness, sparklines, trainingLoad, sleepAnalysis, timeline, bodySignals, stats,
    autonomic, sleepRegularity, circadian, recoveryDebt, acwr, monotony, vo2max, polarised,
  ] = await Promise.all([
    fetchJson('/api/health/readiness'),
    fetchJson('/api/health/sparklines'),
    fetchJson('/api/health/training-load'),
    fetchJson('/api/health/sleep-analysis'),
    fetchJson('/api/health/timeline?limit=10'),
    fetchJson('/api/health/body-signals'),
    fetchJson('/api/health/stats'),
    fetchJson('/api/health/autonomic'),
    fetchJson('/api/health/sleep-regularity'),
    fetchJson('/api/health/circadian'),
    fetchJson('/api/health/recovery-debt'),
    fetchJson('/api/health/acwr'),
    fetchJson('/api/health/monotony'),
    fetchJson('/api/health/vo2max'),
    fetchJson('/api/health/polarised'),
  ]);

  const syncState = await fetchJson('/api/health/sync-state');

  return {
    readiness, sparklines, trainingLoad, sleepAnalysis, timeline, bodySignals, stats,
    autonomic, sleepRegularity, circadian, recoveryDebt, acwr, monotony, vo2max, polarised,
    syncState, loadedAt: new Date().toISOString(),
  };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/health/+page.server.ts
git commit -m "feat(health): load all 8 new analytics endpoints in page.server"
```

---

### Task 37: Rewrite +page.svelte (the main shell)

**Files:**
- Modify: `src/routes/health/+page.svelte`

- [ ] **Step 1: Replace the file**

```svelte
<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta name="description" content="Live health dashboard — readiness, autonomic balance, training load, sleep, body signals." />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta property="og:description" content="Live health dashboard — readiness, autonomic balance, training load, sleep, body signals." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
</svelte:head>

<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import SlidePanel from '$lib/components/SlidePanel.svelte';
  import HealthMasthead from '$lib/components/health/HealthMasthead.svelte';
  import HealthSectionNav from '$lib/components/health/HealthSectionNav.svelte';
  import ReadinessHero from '$lib/components/health/ReadinessHero.svelte';
  import SparklineStrip from '$lib/components/health/SparklineStrip.svelte';
  import WeeklyStats from '$lib/components/health/WeeklyStats.svelte';
  import SleepBreakdown from '$lib/components/health/SleepBreakdown.svelte';
  import BodySignals from '$lib/components/health/BodySignals.svelte';
  import ActivityTimeline from '$lib/components/health/ActivityTimeline.svelte';
  import ActivityDetail from '$lib/components/health/ActivityDetail.svelte';
  import AutonomicBalance from '$lib/components/health/AutonomicBalance.svelte';
  import SleepRegularityIndex from '$lib/components/health/SleepRegularityIndex.svelte';
  import CircadianAlignment from '$lib/components/health/CircadianAlignment.svelte';
  import RecoveryDebt from '$lib/components/health/RecoveryDebt.svelte';
  import ACWRInjuryRisk from '$lib/components/health/ACWRInjuryRisk.svelte';
  import TrainingMonotony from '$lib/components/health/TrainingMonotony.svelte';
  import VO2MaxTrend from '$lib/components/health/VO2MaxTrend.svelte';
  import PolarisedDistribution from '$lib/components/health/PolarisedDistribution.svelte';
  import EvidencePanel from '$lib/components/health/EvidencePanel.svelte';

  let { data } = $props();

  type PanelType =
    | 'sleep' | 'activity' | 'signals' | 'stats' | 'readiness'
    | 'evidence'
    | 'autonomic' | 'sri' | 'circadian' | 'recovery-debt'
    | 'acwr' | 'monotony' | 'vo2max' | 'polarised'
    | null;

  let panelOpen = $state(false);
  let panelType = $state<PanelType>(null);
  let panelTitle = $state('');
  let panelData = $state<any>(null);
  let evidenceFocusId = $state<string | null>(null);
  let loadingActivity = $state(false);

  function openPanel(type: PanelType, title: string, pData?: any) {
    panelType = type;
    panelTitle = title;
    panelData = pData ?? null;
    evidenceFocusId = null;
    panelOpen = true;
  }

  function openEvidence(focusId?: string) {
    panelType = 'evidence';
    panelTitle = 'Evidence & Methodology';
    panelData = null;
    evidenceFocusId = focusId ?? null;
    panelOpen = true;
  }

  async function openActivityDetail(event: any) {
    panelType = 'activity';
    panelTitle = event.title || 'Activity';
    panelData = null;
    panelOpen = true;
    loadingActivity = true;
    try {
      const res = await window.fetch(`/api/health/activity/${event.stravaId}`);
      if (res.ok) panelData = await res.json();
    } finally {
      loadingActivity = false;
    }
  }

  function closePanel() {
    panelOpen = false;
    panelType = null;
    evidenceFocusId = null;
  }
</script>

<PageHeader title="HEALTH" />

<HealthMasthead onopenEvidence={() => openEvidence()} />

<section id="readiness">
  <ReadinessHero readiness={data.readiness} onopenDetail={() => openPanel('readiness', 'Readiness', data.readiness)} />
  <SparklineStrip sparklines={data.sparklines || []} />
</section>

<HealthSectionNav />

<div class="hp-wrap">
  <section id="autonomic" class="hp-group">
    <h2 class="hp-h">Autonomic</h2>
    <AutonomicBalance data={data.autonomic} onopenDetail={() => openPanel('autonomic', 'Autonomic Balance', data.autonomic)} onopenEvidence={openEvidence} />
  </section>

  <section id="sleep" class="hp-group">
    <h2 class="hp-h">Sleep</h2>
    <button class="hp-card-btn" onclick={() => openPanel('sleep', 'Sleep Analysis', data.sleepAnalysis)}>
      <SleepBreakdown sleepAnalysis={data.sleepAnalysis} />
    </button>
    <SleepRegularityIndex data={data.sleepRegularity} onopenDetail={() => openPanel('sri', 'Sleep Regularity Index', data.sleepRegularity)} onopenEvidence={openEvidence} />
    <CircadianAlignment data={data.circadian} onopenDetail={() => openPanel('circadian', 'Circadian Alignment', data.circadian)} onopenEvidence={openEvidence} />
    <RecoveryDebt data={data.recoveryDebt} onopenDetail={() => openPanel('recovery-debt', 'Recovery Debt', data.recoveryDebt)} onopenEvidence={openEvidence} />
  </section>

  <section id="training" class="hp-group">
    <h2 class="hp-h">Training</h2>
    <button class="hp-card-btn" onclick={() => openPanel('stats', 'This Week', data.stats)}>
      <WeeklyStats stats={data.stats} />
    </button>
    <ACWRInjuryRisk data={data.acwr} onopenDetail={() => openPanel('acwr', 'ACWR — Injury Risk', data.acwr)} onopenEvidence={openEvidence} />
    <TrainingMonotony data={data.monotony} onopenDetail={() => openPanel('monotony', 'Training Monotony', data.monotony)} onopenEvidence={openEvidence} />
    <VO2MaxTrend data={data.vo2max} onopenDetail={() => openPanel('vo2max', 'VO₂max Trend', data.vo2max)} onopenEvidence={openEvidence} />
    <PolarisedDistribution data={data.polarised} onopenDetail={() => openPanel('polarised', 'Polarised Distribution', data.polarised)} onopenEvidence={openEvidence} />
  </section>

  <section id="body" class="hp-group">
    <h2 class="hp-h">Body</h2>
    <button class="hp-card-btn" onclick={() => openPanel('signals', 'Body Signals', data.bodySignals)}>
      <BodySignals signals={data.bodySignals} />
    </button>
  </section>

  <section id="activities" class="hp-group">
    <h2 class="hp-h">Activities</h2>
    <ActivityTimeline timeline={data.timeline} onselect={openActivityDetail} />
  </section>
</div>

<footer class="hp-footer">
  <div class="hp-sync">
    {#if data.syncState?.length}
      {#each data.syncState as sync}
        {@const lastSync = sync.lastSyncAt || sync.last_sync_at}
        {@const ago = lastSync ? Math.round((Date.now() / 1000 - lastSync) / 60) : null}
        {@const isStale = ago !== null && ago > 120}
        <span class="hp-sync-row" class:stale={isStale}>
          {sync.service}:
          {#if ago !== null}
            {ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`}
            {#if sync.status === 'error' || sync.status === 'syncing'}
              · {sync.status}
            {/if}
          {:else}
            never
          {/if}
        </span>
      {/each}
    {/if}
  </div>
  <div class="hp-links">
    <a href="/" class="hp-link">Home</a>
    <a href="/admin" class="hp-link">Admin</a>
  </div>
</footer>

<SlidePanel open={panelOpen} onclose={closePanel} title={panelTitle}>
  {#if panelType === 'evidence'}
    <EvidencePanel focusId={evidenceFocusId} />
  {:else if panelType === 'activity'}
    {#if loadingActivity}
      <p class="hp-loading">Loading activity…</p>
    {:else if panelData}
      <ActivityDetail activity={panelData} />
    {:else}
      <p class="hp-loading">Activity not found.</p>
    {/if}
  {:else if panelData}
    <pre class="hp-json">{JSON.stringify(panelData, null, 2)}</pre>
  {/if}
</SlidePanel>

<style>
  .hp-wrap { max-width: 1200px; margin: 0 auto; padding: 1rem 1.5rem 2rem; display: flex; flex-direction: column; gap: 2rem; }
  .hp-group { display: flex; flex-direction: column; gap: 0.75rem; scroll-margin-top: 60px; }
  .hp-h {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.18em; color: var(--accent); margin: 0 0 0.25rem;
    padding-bottom: 0.5rem; border-bottom: 2px solid var(--text-primary);
  }
  .hp-card-btn { background: none; border: 0; padding: 0; text-align: left; cursor: pointer; color: inherit; }
  .hp-footer {
    max-width: 1200px; margin: 0 auto; padding: 1.5rem;
    display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between;
    border-top: 2px solid var(--text-primary);
  }
  .hp-sync { display: flex; flex-wrap: wrap; gap: 0.75rem; font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }
  .hp-sync-row.stale { color: #c4570a; }
  .hp-links { display: flex; gap: 1rem; }
  .hp-link {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--accent); text-decoration: none;
  }
  .hp-link:hover { text-decoration: underline; }
  .hp-loading { font-family: var(--font-mono); font-size: 12px; color: var(--text-ghost); padding: 2rem 0; text-align: center; }
  .hp-json { white-space: pre-wrap; font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
</style>
```

> The slide-over content for `readiness | sleep | signals | stats` currently rendered inline inside `+page.svelte` is intentionally collapsed to a JSON dump in this rewrite. The next task replaces that fallback with proper restyled slide-over content for those four panel types — kept here so the page is at least functional after step 1.

- [ ] **Step 2: Smoke-test**

Run: `npm run dev` (background). Hit `/health`. Confirm no console errors; readiness hero, all 8 new modules, the existing modules, and the section-nav scroll-spy work. Click each module's `[ DETAIL ]` and the `[ EVIDENCE & METHODOLOGY ]` link — slide-over should open. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/routes/health/+page.svelte
git commit -m "feat(health): rebuild +page.svelte with new shell, modules, evidence panel"
```

---

### Task 38: Restore restyled inline slide-over content

**Files:**
- Modify: `src/routes/health/+page.svelte`

> Re-create the readiness/sleep/signals/stats slide-over content from the original `+page.svelte` but using `.nm-sec` styling and 2px flat bars. Replace the JSON-dump fallback added in Task 37.

- [ ] **Step 1: Open the file and replace the slide-over content block**

Find this block in `+page.svelte`:

```svelte
{:else if panelData}
    <pre class="hp-json">{JSON.stringify(panelData, null, 2)}</pre>
{/if}
```

Replace it with the four restyled `{:else if panelType === '<X>'}` branches. Each branch mirrors the data structure of the original but uses:
- `.nm-sec` containers (no rounded corners)
- 2px progress bars (no `rounded-full`)
- `.sr-label-tight` for module-row labels
- `--accent` only for "in good range" states; `#c44` for danger; `--text-ghost` for neutral

Example replacement for the `readiness` branch (ports the existing `factorMeta` block from the old file):

```svelte
{:else if panelType === 'readiness' && panelData}
  {@const factorMeta = {
    recovery: { desc: 'Whoop recovery score. Measures how prepared your body is for strain based on HRV, resting heart rate, and sleep.', goodMin: 67, unit: '' },
    hrvTrend: { desc: 'Heart rate variability trend over 7 days. Higher HRV generally indicates better cardiovascular fitness and recovery.', goodMin: 60, unit: '' },
    sleepQuality: { desc: 'Sleep performance percentage from Whoop.', goodMin: 70, unit: '%' },
    loadBalance: { desc: 'Acute-to-chronic workload ratio. Optimal range is 0.8–1.3.', goodMin: 80, unit: '' },
  } as Record<string, any>}
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Readiness · {Math.round(panelData.score)}</span></div>
    <p class="hp-detail-recom">{panelData.recommendation}</p>
  </section>
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Composite factors</span></div>
    {#each Object.entries(panelData.factors) as [key, factor]}
      {@const meta = factorMeta[key] || { desc: '', goodMin: 50, unit: '' }}
      {@const val = Math.round((factor as any).value)}
      <div class="hp-factor">
        <div class="hp-factor-row">
          <span class="sr-label-tight">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
          <span class="hp-factor-val" class:good={val >= meta.goodMin}>
            {#if key === 'hrvTrend' && (factor as any).raw != null}
              {Math.round((factor as any).raw)} ms
            {:else}
              {val}{meta.unit}
            {/if}
          </span>
        </div>
        <div class="hp-bar"><div class="hp-bar-fill" class:good={val >= meta.goodMin} style="width:{Math.min(100, val)}%;"></div></div>
        <p class="hp-factor-desc">{meta.desc}</p>
      </div>
    {/each}
  </section>
```

Similar restyle for `sleep`, `signals`, and `stats` — port their original markup but swap `rounded-lg`/`rounded-full` for `.nm-sec`/`hp-bar` styling. Add the matching CSS in the page-level `<style>`:

```css
.hp-detail-recom { font-size: 13px; line-height: 1.5; color: var(--text-secondary); margin: 0; }
.hp-factor { display: flex; flex-direction: column; gap: 4px; padding: 0.5rem 0; border-bottom: 1px dotted var(--card-border); }
.hp-factor:last-child { border-bottom: 0; }
.hp-factor-row { display: flex; justify-content: space-between; align-items: center; }
.hp-factor-val { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
.hp-factor-val.good { color: var(--accent); }
.hp-factor-desc { margin: 4px 0 0; font-size: 11px; line-height: 1.45; color: var(--text-ghost); }
.hp-bar { height: 2px; background: var(--card-border); }
.hp-bar-fill { height: 2px; background: var(--text-ghost); }
.hp-bar-fill.good { background: var(--accent); }
```

> For `sleep`, `signals`, and `stats`, mirror the markup style: each becomes a series of `.nm-sec` blocks with `.hp-factor` rows. Keep the original explanation text from the old file. The unique parts of each:
> - **sleep**: render `panelData.latest` total hours + four stage rows (light/deep/rem/awake) with their existing percentages and explainer text. Render the `panelData.trend` list of recent nights as a `.nm-sec`.
> - **signals**: each entry in `panelData` (array of body signals) becomes one `.nm-sec` with the metric name, current value, range marker, 7-day delta, and explainer.
> - **stats**: render `panelData.weekly` as `.hp-factor` rows. Render `panelData.personalRecords` (if present) as a `.nm-sec` with one `.hp-factor` row per PR.

Each branch should be a self-contained `{:else if panelType === '<x>' && panelData}` ... block.

- [ ] **Step 2: Smoke-test**

Run: `npm run dev` (background). Click each existing module's drill-down. Confirm the readiness, sleep, signals, and stats panels render properly.

- [ ] **Step 3: Commit**

```bash
git add src/routes/health/+page.svelte
git commit -m "feat(health): restyle readiness/sleep/signals/stats slide-over content"
```

---

## Verification

### Task 39: Lint + typecheck + tests

- [ ] **Step 1: Run all checks**

Run, in order, and fix any reported issues:

```bash
npm run check
npm test -- --run
npm run build
```

Expected: all three succeed. `npm test` should run all eight new analytics test files in addition to the existing ones.

- [ ] **Step 2: Hand-test the page**

Run: `npm run dev` (background). Open `http://homeserv:5173/health`. Verify:

1. Masthead renders with kicker, "HEALTH" title, sub paragraph, `[ EVIDENCE & METHODOLOGY ]` row-link.
2. Readiness hero is split-layout: large score + factors stack on the right.
3. Sticky `READINESS · AUTONOMIC · SLEEP · TRAINING · BODY · ACTIVITIES` nav shows when scrolled past hero; active link is `--accent` underlined.
4. Each section heading uses `.hp-h` (mono accent kicker, 2px text-primary border-bottom).
5. All eight new analytics modules render. Modules with insufficient data show "Insufficient data — needs more history".
6. Every analytics module has a citation chip in its header (e.g. `Phillips 2017`).
7. Clicking a chip opens the slide-over scrolled to the matching methodology entry.
8. Clicking `[ DETAIL ]` on any module opens its slide-over.
9. Clicking the masthead `[ EVIDENCE ]` opens the methodology panel from the top.
10. No `rounded-*` Tailwind classes in `src/routes/health/` or `src/lib/components/health/` (`grep -rn 'rounded-' src/routes/health/ src/lib/components/health/` should return nothing).
11. Mobile (browser narrow to 380px): readiness hero stacks; section nav is horizontally scrollable; modules collapse to single columns where appropriate.

Stop the dev server.

- [ ] **Step 3: Push + deploy**

```bash
git push
~/strange_rambling_svelte/scripts/deploy.sh
```

Expected: deploy script reports success. Smoke-test `https://strangeramblings.com/health`.

---

## Self-Review

### Spec coverage

| Spec requirement | Implemented in |
|---|---|
| `.nm-*` design language baseline | Tasks 4 (masthead), 5 (section nav), 6 (MetricCard), 33–35 (restyles), 37 (page) |
| Sticky kicker scroll-spy section nav | Task 5 |
| Split readiness hero (score + factor bars) | Task 33 |
| All eight analytics modules | Tasks 9–16 (analytics) → 17–24 (services/endpoints) → 25–32 (components) |
| Citation chips per module | Task 2 (chip component); used by Tasks 6, 25–32 |
| Page-level Evidence & Methodology panel | Tasks 1 (data), 3 (panel), 4 (link), 37 (wiring) |
| On-the-fly compute, no schema changes | Tasks 17–24 (no migrations referenced) |
| Dense everywhere; instrument-feel | Task 37 page layout (hp-wrap padding, no `h-[Xvh]` spacers) |
| Sufficiency states ("insufficient data") | Task 8 (type), threaded through 9–16, surfaced in Task 6 (MetricCard) |
| Existing modules retained, restyled | Tasks 33–35, plus existing API endpoints unchanged |
| Slide-over content for existing modules restyled | Task 38 |
| Pure analytics functions unit-tested | Tasks 9–16 (each has a vitest file) |
| `npm run check`, `npm test`, `npm run build` pass | Task 39 |
| Mobile responsiveness | Tasks 4, 5, 33–35, 37 (all include mobile media queries) |

### Outstanding caveats (acknowledged, not blockers)

- `vo2max-service.ts` has a hard-coded `PROFILE = { age: 32, sex: 'male' }`. A profile config doesn't exist in the codebase yet; the comment marks this for follow-up rather than blocking the redesign.
- The polarised module relies on Whoop-derived HR zones which assume a correctly-configured max HR on the Whoop side — calibration is out of scope.
- Recovery-debt strain/recovery balance heuristic (>8) is a personal threshold; tune if it triggers too often.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-health-redesign.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
