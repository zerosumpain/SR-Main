# Trails physiology suite — dashboard, workout enrichment, overview strip

**Date:** 2026-08-18 · **Grade:** Full autonomous · **Branch:** `trails-health-suite`

## Brief

Review /trails in light of the health data and Apple Health workouts; build a
dashboard view showing physiological progression and more health statistics;
improve the workout detail view and the overview; weave in health research.

## Review findings (what the data audit showed)

1. **The trails HR series feed no analytics.** `/health` v2's analytics run on
   Whoop strain (`whoop_cycles`) and zone durations (`whoop_workouts`) — both
   from the wrist, none from the per-workout `activity_series` heart-rate data
   trails now ingests. The richest signal in the house is unread.
2. **Untapped workout metadata.** Every Apple workout carries
   `heartRateRecovery` (a post-exercise HR decay curve → HRR60, one of the
   best-evidenced fitness markers), `intensity` (kcal/hr·kg ≈ METs),
   `temperature`, `humidity`, min HR, `maxSpeed`. All stored, none shown.
3. **`heart_rate_variability` (10,463 Apple SDNN samples) has zero readers.**
   The /health HRV metrics are Whoop RMSSD; the Apple series just accumulates.
4. **Phone-side metric drift:** `respiratory_rate`, `flights_climbed`,
   `walking_running_distance` stopped arriving 2026-05-20/21;
   `resting_heart_rate`, `oxygen_saturation`, `body_temperature`, `body_mass`,
   `apple_exercise_time`, `apple_stand_hour` are accepted by the ingest but
   never sent. Fix is in the HAE app's metric selection, not in code.
5. **Workout pages show traces, not interpretation** — no zones, no load, no
   recovery, no comparison to the athlete's own history.
6. Whoop is live (recovery scored 2026-08-18: 236 daily rows ≈ 8 months of RHR
   / RMSSD / recovery) — that is the progression backbone until the trails
   corpus (7 activities, started 2026-08-11) grows.
7. **Found during QA:** four July 2026 `whoop_cycles` rows store strain ×100
   (635/634/1401/431 on a 0–21 scale). series-30d and correlations already
   unscaled at read; acwr, monotony, recovery-debt and training-load did not —
   so the /health strain ACWR has been reporting 0.20 "detraining" when the
   real ratio is 1.04 "optimal". Fixed with a shared `realStrain()` applied in
   all four readers (code-only; the rows are left as-is deliberately).

## What ships

### A. Pure analytics — `src/lib/health/analytics/` (MetricResult pattern, vitest each)

| Module | Computes | Research anchor |
|---|---|---|
| `trimp.ts` | Banister TRIMP per session from `[t, hr]` samples (fallback: avg-HR variant); daily load series; TRIMP-ACWR via existing `computeACWR` | Banister 1991; Williams 2017 EWMA |
| `hr-zones.ts` | 5-zone edges from %HRmax; time-in-zone from samples; aggregate distribution | ACSM guidelines; Seiler 2010 for 80/20 read |
| `efficiency.ts` | EF = speed(m/min)/HR for steady outdoor work; aerobic decoupling (1st vs 2nd half EF drift) | Coaching heuristic (Friel/TrainingPeaks); durability lit. Maunder 2021 |
| `hrr.ts` | HRR60 from the `heartRateRecovery` metadata curve + curve for display | Cole 1999 NEJM (≤12 bpm abnormal) |

`hrMax` = max(observed max HR across activities + Apple HR maxima, Tanaka
208−0.7·age from `HEALTH_DOB`); `hrRest` = 28d mean Whoop RHR. Both resolved
server-side, passed in, documented in methodology.

### B. Service — `src/lib/trails/physio-service.ts`

- `getTrailsDashboard()` — assembles (all fail-soft, `safe()` pattern from
  /health): VO2max (reuse `getVO2Max`), RHR/HRV daily series 180d + 7d/28d
  rolling (whoop_recovery; plus the unread Apple SDNN daily medians), recovery
  score series, per-activity physio (TRIMP/EF/HRR60/zones) for last 90d,
  daily TRIMP + TRIMP-ACWR (sufficiency-gated — honest 'insufficient' until
  ≥14 days), Whoop-strain ACWR (existing `getACWR`) as the interim load chip,
  12-week volume by sport, zone distribution 28d.
- `enrichActivityDetail(detail)` — per-workout TRIMP, EF, decoupling, HRR60 +
  curve, zones, METs, conditions, and same-sport medians ("vs typical").

### C. Methodology — extend `METHODOLOGY` in `src/lib/health/methodology.ts`

New entries: `trimp`, `hrr60`, `efficiency-factor`, `decoupling`, `hr-zones`
(+ cadence note). Reuse existing `acwr`, `vo2max` entries. Plain-English
formula/caveats register, real citations. EvidenceChip + MethodologyDrawer on
the new page.

### D. UI

- **`/trails/dashboard`** (owner-gated by default): header w/ nav · Fitness
  signal tiles (VO2max + band, RHR 7d Δ, HRV 7d Δ, latest recovery) each with
  EvidenceChip · progression charts (VO2max, RHR, HRV w/ 28d baseline band;
  EF and HRR60 per-workout dots) · training load (daily TRIMP bars + ACWR
  chips + sufficiency note) · 12-week volume bars · 28d zone bar w/ 80/20
  note · MethodologyDrawer.
- **New components** (`src/lib/components/trails/`): `DateLineChart.svelte`
  (date x-axis, optional baseline band + dot mode, crosshair hover — adapted
  from trails `LineChart`, scales via `chartkit.ts`), `ZoneBar.svelte`
  (stacked bar, sequential accent-tint ramp light→dark, labels + hover),
  `WeeklyBars.svelte` (12w bars, single hue, per-sport tooltip).
- **`/trails/[id]`**: stat grid gains TRIMP, EF, HRR60, METs, Min HR ·
  zone bar section · HRR curve chart · decoupling + "vs your typical
  run/ride/walk" delta line · conditions (temp/humidity) in provenance.
  All conditional — absent data renders nothing (Fitness.svelte fail-soft
  precedent).
- **`/trails`**: nav gains Dashboard link; one compact load/volume strip
  section (12w mini bars + ACWR chip) linking to the dashboard.

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Dashboard location | enrich /trails · new /trails/dashboard · extend /health | **/trails/dashboard** | /health is public; physiological progression is owner-only (trails precedent); overview stays a list | yes — routes are cheap |
| Load metric | Whoop strain only · TRIMP only · both, labelled | **Both, labelled** | TRIMP from real HR series is the honest future; 7 days of trails data can't feed ACWR yet — sufficiency labels say so instead of hiding the section | yes |
| HR zone anchor | Karvonen (HRR-based) · %HRmax observed+Tanaka | **%HRmax** | fewer inputs, matches ACSM tables, Whoop RHR still shown separately; documented in methodology | yes — pure function param |
| Where analytics live | `src/lib/trails/` · `src/lib/health/analytics/` | **health/analytics** | that's the established family (MetricResult, tests, methodology ids); trails service composes them | yes |
| Per-activity physio | compute at ingest (schema change) · read-side | **read-side** | no migration, no backfill, 7 activities today; revisit if the dashboard slows at ~100+ activities with big series | yes |
| Apple SDNN vs Whoop RMSSD | mix into one HRV chart · separate, labelled | **separate, labelled** | SDNN and RMSSD are not comparable measures; mixing fabricates a trend | n/a — correctness |
| Weekly volume encoding | stacked per-sport hues · single hue + tooltip breakdown | **single hue + tooltip** | house rule is warm monochrome; avoids categorical palette for 3 sports on a private page | yes |
| Overview list rows | add load column · leave alone | **leave alone** | 5 stat columns already wrap on mobile; the strip section carries the new signal | yes |
| Legacy ×100 strain rows | repair prod data · normalise at read | **normalise at read** (`realStrain()` in all four unpatched readers) | matches the fix series-30d/correlations already ship; no prod UPDATE to get wrong | yes |

## Verification

- `npx vitest run` on new analytics tests (TRIMP/zones/EF/HRR known-value cases).
- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` clean.
- Local prod-build QA with prod data snapshot copied into local Postgres
  (activities/series/tracks/whoop_*/vo2max rows) — Playwright screenshot of
  /trails/dashboard + an enriched /trails/[id].
- Ship via PR → CI → merge; live verify with authenticated fetch of
  https://strangeramblings.com/trails/dashboard rendering real values.

## Out of scope

Phone-side HAE metric selection (reported only); persisting physio at ingest;
sleep analytics on the trails page (stay on /health); public exposure.
