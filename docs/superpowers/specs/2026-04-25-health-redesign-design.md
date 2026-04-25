# /health Redesign — Design Spec

**Date:** 2026-04-25
**Surface:** `https://strangeramblings.com/health` (route: `src/routes/health/`)
**Goal:** Overhaul `/health` to (1) adopt the SR `.nm-*` design language used by `/admin/files` and `/jkai/canvas`, and (2) add eight research-driven analytics modules so the page demonstrates and exploits modern health science instead of being a vanilla Whoop/Strava reskin.

---

## Decisions (locked)

| # | Decision |
|---|----------|
| 1 | **B — restyle + new analytics**, not restyle-only |
| 2 | All eight new analytics modules: Autonomic Balance, ACWR Injury Risk, Sleep Regularity Index, Circadian Alignment, Training Monotony & Strain, VO₂max & Cardio Percentile, Polarised Training Distribution, Recovery Debt |
| 3 | **C — hybrid layout**: full-bleed hero + sticky kicker-style section nav + long scroll grouped by theme |
| 4 | **B — split hero**: score on the left, four factor bars on the right |
| 5 | **C — hybrid drill-down**: scannable inline summaries + `[ DETAIL ]` row-link opens existing `SlidePanel` for deep view |
| 6 | **C — citation chips per module + page-level `EVIDENCE & METHODOLOGY` panel** (single source of truth) |
| 7 | **A — on-the-fly compute** in API routes, no schema changes |
| 8 | **A — dense everywhere**: instrument-feel, not scroll-essay |

---

## Architecture

### Page shell — `src/routes/health/+page.svelte`

```
<PageHeader title="HEALTH" />              ← unchanged
<HealthMasthead />                          ← new: kicker · h1 · sub · [ EVIDENCE ] row-link
<ReadinessHero />                           ← rebuilt (split layout B)
<HealthSectionNav />                        ← new: sticky scroll-spy kicker-nav
<section id="autonomic">  ...modules...
<section id="sleep">      ...modules...
<section id="training">   ...modules...
<section id="body">       ...modules...
<section id="activities"> ...modules...
<footer />                                  ← restyled to nm
<SlidePanel>                                ← retained, content restyled
```

### Design language baseline

Every section, card, button, chip, and bar uses the canonical `nm-tokens.css` primitives:

- **Containers** → `.nm-sec` (square 1px `--card-border`, header rule via `.nm-sec-hd`).
- **Labels** → `.sr-label-tight` (mono 10px uppercase 0.12em).
- **Actions** → `.row-link` (mono 10px uppercase accent).
- **Primary buttons** → `.nm-save-btn`. Secondary → `.nm-btn-ghost`.
- **Chips** → square 22×22 mono 10px font-weight 700 (modelled on `.perm-chip`).
- **Progress / range bars** → 2px flat (no `rounded-full`, no `rounded-lg`).
- **No `rounded-*` Tailwind utilities anywhere.**
- **Page-hdr pattern** (kicker → display heading → `.sub` → 2px border-bottom on `--text-primary`) used at the top of every grouped section.

### New components

| Component | Purpose |
|-----------|---------|
| `HealthMasthead.svelte` | Kicker, h1 "HEALTH", sub paragraph, right-aligned `[ EVIDENCE & METHODOLOGY ]` row-link. |
| `HealthSectionNav.svelte` | Sticky `top: 0; z-index: 20;` kicker-style nav. `IntersectionObserver` scroll-spy; active link `color: var(--accent)` + 2px underline. Six anchors. |
| `EvidenceChip.svelte` | Square mono pill rendered in section headers. Props: `metric`, `cite`. Click → opens `EVIDENCE` panel scrolled to that metric. |
| `EvidencePanel.svelte` | Slide-over body content for the methodology panel. Lists every metric: name, formula, source data, study/citation, caveats. |
| `MetricCard.svelte` | Generic `.nm-sec` card primitive: header (`.sr-label-tight` + `EvidenceChip` + `[ DETAIL ]` row-link) and a body slot for inline summary. |
| `MiniSparkline.svelte` | 2px-stroke flat sparkline reused across modules (current value + 7d/14d series + delta). |

### New analytics components (one per module)

Grouped by section anchor:

**`#autonomic`**
- `AutonomicBalance.svelte` — HRV 7d trend × RHR drift overlay → "nervous system load" gauge (composite z-score) + early-warning band.

**`#sleep`** (existing `SleepBreakdown` retained, restyled, plus:)
- `SleepRegularityIndex.svelte` — Phillips 2017 SRI 0–100. Inline: number + 14d trend line + verdict band (irregular / mid / regular).
- `CircadianAlignment.svelte` — sleep-midpoint drift vs personal 28d baseline. Inline: drift in hours + direction arrow + flag if >1h (social-jetlag heuristic).
- `RecoveryDebt.svelte` — rolling 14d cumulative sleep-debt minutes + strain-vs-recovery imbalance. Inline: debt minutes, strain/recovery ratio, area-chart sparkline.

**`#training`** (existing `WeeklyStats` retained, restyled, plus:)
- `ACWRInjuryRisk.svelte` — acute (7d) ÷ chronic (28d) Whoop strain. Inline: ratio number, sweet-spot band (0.8–1.3) visual, danger flag if >1.5 or <0.5.
- `TrainingMonotony.svelte` — Foster 1998: monotony = mean(load)/SD(load) over 7d; strain = total load × monotony. Inline: monotony number + strain number + traffic-light verdict.
- `VO2MaxTrend.svelte` — Apple Health VO₂max series, 90d trend + age-percentile context (lookup table from ACSM normative data). Inline: current value + percentile + trend arrow.
- `PolarisedDistribution.svelte` — % time in Z1/Z2 vs Z3 vs Z4/Z5 across last 7d activities. Inline: stacked horizontal bar (3 segments) + 80/20 verdict.

**`#body`** (existing `BodySignals` retained, restyled.)

**`#activities`** (existing `ActivityTimeline` + `ActivityDetail` retained, restyled.)

### Drill-down model

Each module:

1. Renders inline summary (always visible, scannable).
2. Header has `[ DETAIL ]` row-link → opens `SlidePanel` with the deep view (history charts, factor breakdowns, research explainer paragraph, link to methodology entry).
3. Existing slide-over content for `readiness | sleep | signals | stats | activity` gets restyled but otherwise behaves the same.

### Evidence & methodology

Single source of truth: `src/lib/health/methodology.ts`. Exports a typed `Methodology` array:

```ts
export type MethodologyEntry = {
  id: string;          // 'sri', 'acwr', 'monotony', etc.
  metric: string;      // 'Sleep Regularity Index'
  cite: string;        // 'Phillips 2017'
  formula: string;     // markdown
  sourceData: string;  // 'Apple Health sleep-stage events, 14d window'
  caveats: string;     // markdown
  reference: string;   // full citation + DOI/URL where applicable
};
```

`EvidenceChip` looks up by `id`, `EvidencePanel` renders the array as one continuous panel. Hashed deep-link inside the panel (`#sri`) so chip clicks scroll to the right entry.

---

## Data — on-the-fly API routes (no schema changes)

New endpoints under `/api/health/`:

| Endpoint | Source data | Computation |
|----------|-------------|-------------|
| `GET /api/health/autonomic` | Whoop HRV + Apple RHR (last 28d) | 7d/28d HRV mean & SD, RHR drift z-score, composite "autonomic load" 0–100 |
| `GET /api/health/sleep-regularity` | Whoop sleep events (last 14d) | Phillips 2017 SRI: mean prob. of being in same state at same clock time across 24h windows |
| `GET /api/health/circadian` | Whoop sleep midpoints (last 28d) | Personal baseline midpoint + last 7d drift in hours |
| `GET /api/health/recovery-debt` | Whoop sleep need vs actual + strain (last 14d) | Cumulative sleep-debt minutes; strain/recovery rolling balance |
| `GET /api/health/acwr` | Whoop strain (last 28d) | Acute (7d EWMA) ÷ chronic (28d EWMA), with band classification |
| `GET /api/health/monotony` | Whoop strain (last 7d) | Foster monotony = mean/SD; strain = sum × monotony |
| `GET /api/health/vo2max` | Apple Health VO₂max series + user DOB | 90d trend; ACSM age-percentile lookup |
| `GET /api/health/polarised` | Strava activities (last 7d) + HR-zone definitions | % time in Z1/Z2, Z3, Z4/Z5 |

Existing endpoints (`readiness`, `sparklines`, `training-load`, `sleep-analysis`, `body-signals`, `stats`, `timeline`, `sync-state`) remain unchanged.

`+page.server.ts` extends its `Promise.all` to include the eight new endpoints. Each `.catch(() => null)` pattern preserved so a single failing module doesn't break the page.

### Computation rigour

- All formulas implemented in pure functions in `src/lib/health/analytics/` (one file per metric: `sri.ts`, `acwr.ts`, `monotony.ts`, `circadian.ts`, `vo2max-percentile.ts`, `polarised.ts`, `autonomic-balance.ts`, `recovery-debt.ts`). Unit-testable.
- Every analytics module receives a typed `MetricResult<T>` with `{ value, raw, sample, asOf, sufficiency: 'ok' | 'partial' | 'insufficient' }`. Modules render an "insufficient data" state when sufficiency fails (e.g. <14 nights of sleep events for SRI).

---

## Mobile / responsive

Decision A — instrument-feel everywhere. Concrete rules:

- `.nm-sec` sections render at the same density on mobile and desktop (no `h-[8vh]` cinematic spacers between sections).
- Hero (split layout) collapses to stacked at <640px.
- Sticky `HealthSectionNav` becomes horizontally scrollable on narrow viewports (`overflow-x: auto; scrollbar-width: none;`).
- Multi-column grids inside modules collapse to single-column at <640px.
- The factor strip in the hero stays as a 2-column grid on mobile (preserving the analytical character) rather than 1-column.

---

## Out of scope

- Database schema changes / materialised rollups (deferred until a specific endpoint proves slow under real traffic).
- New data sources (e.g. continuous glucose, blood panels) — current Whoop / Apple / Strava is the input set.
- Authoring UI for methodology entries (the `methodology.ts` file is hand-edited).
- Migrating away from the existing `SlidePanel` component (retained, restyled).
- Backwards-compatibility shims for the old `/health` markup; this is a clean replacement.

---

## Migration & deletion

- `src/routes/health/+page.svelte` — replaced wholesale.
- `src/lib/components/health/ReadinessHero.svelte` — rewritten to split layout (Q4-B).
- `src/lib/components/health/SparklineStrip.svelte`, `WeeklyStats.svelte`, `SleepBreakdown.svelte`, `BodySignals.svelte`, `ActivityTimeline.svelte`, `ActivityDetail.svelte` — restyled to nm-language; behaviour preserved.
- All `rounded-*` Tailwind utilities and inline `style="..."` rules in those components removed in favour of canonical `nm-tokens.css` classes + minimal scoped `<style>`.

---

## Acceptance criteria

1. `/health` renders the masthead, hero (split B), sticky scroll-spy nav, six grouped sections, and footer using `.nm-*` tokens with no `rounded-*` utilities anywhere in `src/routes/health/` or `src/lib/components/health/`.
2. All eight new analytics modules render with inline summary + `[ DETAIL ]` row-link, and degrade gracefully to an "insufficient data" state when sample size is too small.
3. `EvidenceChip` appears on every analytics module header. Clicking any chip opens `EVIDENCE & METHODOLOGY` slide-over scrolled to the right entry.
4. `npm run lint` and `npm run build` pass.
5. Page is functionally usable on mobile: section nav scrollable, modules legible, slide-over works.
6. Pure analytics functions in `src/lib/health/analytics/*.ts` have unit tests covering the canonical example from each method's source paper (or a deterministic synthetic case where no canonical example exists).
