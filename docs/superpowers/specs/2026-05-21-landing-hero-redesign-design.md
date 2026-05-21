# Landing hero redesign — design spec

**Date:** 2026-05-21
**Project:** `strange_rambling_svelte`
**Status:** Approved for planning

## Problem

The landing page hero (`src/routes/+page.svelte`) shows a raw BPM number on the
left and a fixed explainer paragraph on the right. It is static and does not
carry the visual weight of the `/health` hero. We want the landing hero to:

1. Mirror the `/health` v2 hero layout and "pulse" treatment.
2. Lead with a short, witty, provocative headline that reflects the visitor's
   read of John's current state — heart rate, steps, temperature.
3. Serve those headlines instantly with no per-request LLM call, by snapping
   live vitals to the nearest of a pre-generated set of ~150 cached titles.

## Goals

- A redesigned hero that reuses the `/health` v2 hero language.
- LLM-generated headline copy, pre-cached as ~150 combinations, snapped to the
  nearest neighbour at render time. Zero LLM latency on the landing page.
- Copy that stays numerically honest: exact live numbers always shown; cached
  text never displays a wrong number.
- Light visual reconciliation of the sections below the hero so the page reads
  as one coherent piece.

## Non-goals

- No full redesign of the Biome / Writing / footer sections — content and
  structure stay; only spacing, type, and section numbering are retouched.
- No new visualisation variants beyond ECG and the existing biome field.
- No per-visitor personalisation — the hero reflects John's vitals only.

## Confirmed decisions

| Decision | Choice |
|----------|--------|
| Hero layout | `/health` structure (mono tag, primary+ghost headline, accent strap, footer meta bar) with a single mono vitals line instead of the bold metric grid |
| Background "pulse" | ECG trace by default; existing toggle generalised so visitors can switch to the biome particle field |
| Strap line | Cached + snapped, written with live number-slots (`{bpm}` etc.) filled at render |
| Title storage | Postgres table |
| Regeneration | Weekly cron + an admin "regenerate now" page |
| Redesign scope | Hero fully redesigned; sections below get light reconciliation only |

## Architecture

### Components / files

| Path | Purpose |
|------|---------|
| `src/lib/db/schema.ts` | Add `heroTitles` table |
| `src/lib/landing/hero-titles-buckets.ts` | Bucket centroid definitions + per-axis snapping (pure, testable) |
| `src/lib/landing/hero-titles-service.ts` | Generation, in-memory cache, `snapHeroTitle()`, deterministic fallback |
| `src/lib/landing/hero-titles-scheduler.ts` | Weekly regeneration cron |
| `src/lib/components/shared/Ecg.svelte` | `Ecg.svelte` moved here from `health/v2/` (now shared by `/` and `/health`) |
| `src/lib/components/landing/LandingHero.svelte` | New hero component (extracted from `+page.svelte`) |
| `src/lib/components/landing/BackgroundToggle.svelte` | Generalised from `BiomeToggle.svelte` — ECG ⇄ biome |
| `src/routes/+page.svelte` | Use `LandingHero`; render ECG or biome background; light section reconciliation |
| `src/routes/+page.server.ts` | Snap live vitals → `heroTitle` |
| `src/routes/admin/hero/+page.svelte` + `+page.server.ts` | Admin: regenerate button + browse all 150 entries |
| `src/hooks.server.ts` | Start/stop the hero-titles scheduler |

### Data model — `hero_titles`

Drizzle `pgTable('hero_titles', …)`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial, pk | |
| `hrBucket` | integer | 0–4 |
| `stepsBucket` | integer | 0–4 |
| `tempBucket` | integer | 0–5 |
| `hrCentroid` | integer | bpm centroid of the bucket |
| `stepsCentroid` | integer | steps centroid of the bucket |
| `tempCentroid` | integer | °C centroid of the bucket |
| `primary` | text | headline line 1 |
| `ghost` | text | headline line 2 (ghost-coloured) |
| `strapTemplate` | text | strap with `{…}` placeholders |
| `generatedAt` | timestamptz | |

Unique constraint on `(hrBucket, stepsBucket, tempBucket)`. Exactly 150 rows
when fully populated.

### The grid — ~150 combinations

5 HR × 5 steps × 6 temp = **150**. Bucket centroids:

- **HR (bpm):** deep-rest `50`, resting `62`, warm `80`, elevated `105`, hard `140`
- **Steps:** just-woke `200`, slow-start `2000`, building `6000`, active `11000`, big-day `18000`
- **Temp (°C):** freezing `-2`, cold `5`, cool `10`, mild `15`, warm `21`, hot `28`

Each bucket also carries a short qualitative label (above) used to build the
generation prompt.

### Snapping

The centroids form an axis-aligned rectangular grid. The nearest grid point by
Euclidean distance equals the per-axis nearest centroid, computed independently
per dimension — so snapping does not require a full 150-row scan:

1. `+page.server.ts` reads live HR, steps, temp (already available from
   `/api/biome/state` + the existing steps query).
2. For each axis, pick the bucket whose centroid is closest to the live value.
3. The resulting `(hrBucket, stepsBucket, tempBucket)` tuple keys the row.

### Strap number-slots

`strapTemplate` is written by the LLM using placeholder tokens, never literal
digits. Supported tokens, filled with **live** values at render:

| Token | Filled with |
|-------|-------------|
| `{bpm}` | live heart rate, integer |
| `{steps}` | live step count, thousands-separated |
| `{temp}` | live temperature, integer + `°` |
| `{sky}` | live weather condition word, lowercased |

The headline (`primary` / `ghost`) never contains numbers. Exact figures also
appear in the always-live mono vitals line, independent of the cache.

### Generation service

`generateHeroTitles()`:

1. Iterate all 150 grid points.
2. Per point, build a prompt describing the bucket qualitatively (e.g. "Heart
   rate: resting (~62 bpm). Activity: barely moved (~200 steps). Temperature:
   mild (~15°C)."). Voice instructions adapted from the existing
   `src/lib/health/hero-copy-service.ts` prompt — dry, witty, snappy, knowing.
3. Call the LLM via `getLLMClient` + `resolveDefaultModel('chat')`. Request
   strict JSON `{ "primary", "ghost", "strap" }`. Per-call timeout 90s. Run
   with light concurrency (≤4 in flight).
4. Validate (see below). On success, upsert the row. On failure for a bucket,
   leave any existing row untouched; if no row exists yet, write that bucket's
   deterministic fallback. Regeneration is therefore non-destructive on partial
   failure.
5. After the run, refresh the in-memory cache.

The LLM call is injectable (as in `hero-copy-service`) so generation is
testable without network access.

### Validation

A generated entry is rejected if:

- `primary` or `ghost` is empty, longer than 24 characters, or contains any
  digit `[0-9]`.
- `strapTemplate` is empty, longer than 200 characters, contains a literal
  digit `[0-9]`, or does not contain the `{bpm}` token.

Rejecting literal digits forces all numbers through the live token slots.

### In-memory cache

`hero-titles-service.ts` holds the 150 rows in a module-level variable with a
5-minute TTL. `snapHeroTitle()` lazy-loads on first call and reloads when the
TTL lapses; `generateHeroTitles()` refreshes it immediately on completion. The
short TTL means cron regenerations and admin hand-edits both propagate without
explicit invalidation wiring. The landing page tolerates a 5-minute-stale set.

### Fallback

If the table is empty (cold start, before the first generation) or the DB read
fails, `snapHeroTitle()` returns from a small hardcoded set of 5 deterministic
entries keyed on HR band, so the hero is never blank. An empty table on startup
also triggers an immediate generation run.

### Scheduler

`hero-titles-scheduler.ts` mirrors `src/lib/health/scheduler.ts`:

- `startHeroTitlesScheduler()` called from `hooks.server.ts`; `stop…()` wired
  into the existing graceful-shutdown block.
- Interval from `HERO_TITLES_REGEN_MS`, default 7 days.
- On startup: if the table is empty, generate ~30s after boot; otherwise wait
  one full interval before the first regeneration.

### Admin page — `/admin/hero`

- `+page.server.ts` load: all 150 rows ordered by bucket indices, plus current
  generation status and `generatedAt` of the newest row.
- A `regenerate` form action starts `generateHeroTitles()` in the background
  (module-level "in progress" flag) and returns immediately. The page shows
  status: idle / running / last completed.
- Styling follows the established admin design language (`.nm-sec`,
  `.nm-save-btn`, `.row-link`, CSS-var palette), modelled on `/admin/files`.

### Hero component & background toggle

- `LandingHero.svelte` renders: mono tag (`RIGHT NOW · HH:MM · DD MON YYYY ·
  LONDON`), primary+ghost headline, accent strap (placeholders filled), mono
  vitals line, footer meta bar. Uses existing design tokens (`--font-display`,
  `--font-mono`, `--accent`, etc.).
- `Ecg.svelte` moves to `src/lib/components/shared/`; the one `/health` import
  in `health/v2/Hero.svelte` is updated. It already polls `/api/biome/state`
  for live HR and supports a `fullbleed` background mode.
- `BackgroundToggle.svelte` generalises `BiomeToggle.svelte`: persists
  `landing-bg` (`'ecg' | 'biome'`, default `'ecg'`) in localStorage and
  dispatches a `landing-bg-change` event. `+page.svelte` renders `<Ecg>` or
  `<BiomeBackground>` accordingly.

### Below-hero reconciliation

Add `/health`-style mono section numbers — `02 / THE BIOME`, `03 / WRITING` —
and align strap styling and dividers with the hero. Section content, the post
list, `ScrollReveal`, and the footer are unchanged.

## Data flow (landing page request)

1. `+page.server.ts` loads posts + steps + `/api/biome/state` (HR, temp,
   condition) — as today.
2. `snapHeroTitle({ hr, steps, temp })` snaps per-axis, looks up the row (or
   falls back), fills strap placeholders with live `hr` / `steps` / `temp` /
   `condition`, and returns `{ primary, ghost, strap }`.
3. `+page.svelte` renders `LandingHero` with that copy plus the live vitals.

## Error handling

| Failure | Behaviour |
|---------|-----------|
| DB read fails on SSR | `snapHeroTitle()` returns a fallback entry |
| Table empty | Fallback entry served; startup triggers a generation run |
| LLM call fails for a bucket | Keep the existing row; if none, write that bucket's fallback. Run continues |
| LLM returns invalid / non-conforming JSON | Treated as a bucket failure (same as above) |
| Regeneration already running | Admin `regenerate` action is a no-op while the in-progress flag is set |

## Testing

- **`hero-titles-buckets.ts`** — snapping: live values across and between
  bucket boundaries snap to the expected bucket on each axis.
- **Strap placeholder fill** — each token replaced; `{steps}` thousands-
  separated; `{sky}` lowercased; unknown tokens left intact.
- **Validation** — rejects digits in `primary`/`ghost`/`strap`, over-length
  copy, and straps missing `{bpm}`.
- **`generateHeroTitles()`** — with an injected mock LLM: all 150 rows upserted
  on success; a per-bucket failure leaves a prior row intact and never aborts
  the run.
- **Fallback** — empty table / DB error yields a non-empty hero.

## Rollout

1. Schema change via `npx drizzle-kit push`.
2. Deploy. On first boot the empty table triggers a generation run (~minutes);
   the fallback set covers the hero until it completes.
3. Verify the live hero on production after deploy (per project deploy
   discipline).
