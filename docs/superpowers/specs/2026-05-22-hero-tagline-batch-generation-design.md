# Hero Tagline Batch Generation — Design

**Date:** 2026-05-22
**Status:** Approved (design)

## Problem

The `/admin/hero` page manages the pre-generated copy the landing hero snaps
to. Today it has a single "Regenerate all" button. Generation fires 150
separate LLM calls — one per `(HR × steps × temp)` bucket — runs for minutes
as a fire-and-forget background job, and writes straight to the database.

There is no way to influence the *style* of the generated copy, no way to
control the *length* of headlines or straps, and no chance to review the
output before it goes live.

## Goals

- Let the admin influence the generation style with a freeform text prompt.
- Generate in batches of 50 instead of 150 single calls.
- Support multiple copy variants per bucket, so the hero varies between
  visits within the same vitals state.
- Let the admin control headline and strap length independently.
- Preview generated copy and explicitly Save (replace or append) it.

## Non-goals

- Editing copy by hand in the preview table.
- Per-bucket targeted regeneration.
- Decoupling hero copy from the vitals grid (the 150-bucket grid stays).

## Background — current architecture

- `hero_titles` table: one row per bucket, unique index on
  `(hr_bucket, steps_bucket, temp_bucket)`. Columns include `primary`,
  `ghost`, `strap_template`, the three centroids, and `generated_at`.
- `hero-titles-buckets.ts`: defines the 5 HR × 5 steps × 6 temp grid
  (150 points) and the snap function.
- `hero-titles-service.ts`: `generateHeroTitles()` loops the grid with
  concurrency 4, one LLM call per point, upserts on the bucket key.
  `snapHeroTitle()` looks up the single row for a snapped bucket.
  `validateGenerated()` enforces hard-coded length limits (24-char
  headline, 200-char strap) and a no-digits / `{bpm}`-token rule.
- `hero-titles-scheduler.ts`: weekly regeneration + a startup top-up if the
  set is incomplete.
- Landing `+page.server.ts` calls `snapHeroTitle()` during SSR.
- Admin route tree is auth-guarded centrally in `hooks.server.ts`; any
  non-public path (including child routes of `/admin/hero`) requires auth.

## Design

### 1. Data model

`hero_titles` table changes (applied via `npx drizzle-kit push`):

- **Drop** the unique index `hero_titles_bucket_unique` on
  `(hr_bucket, steps_bucket, temp_bucket)`. A bucket may now hold multiple
  rows — one per variant.
- **Add** `style text` (nullable) — records the style prompt that produced
  the row, so an append-mode pool of mixed-style rows stays legible in the
  admin table. `null` / empty means the default voice.

`id` (serial) remains the per-row identity. No `variant` ordinal column —
row identity plus bucket grouping is enough.

### 2. Generation service (`hero-titles-service.ts`)

Reworked around batches. Core pieces:

- **`GenParams`** = `{ style: string; headlineWords: number; strapWords: number }`.
- **`enumerateUnits(variantsPerBucket)`** → an array of `150 × N` generation
  units. Each unit is a `GridPoint` (the grid repeated `N` times).
- **`generateBatch(units, params)`** → one LLM call covering ≤ 50 units.
  - Prompt: a system prompt with the voice rules, the style direction, and
    the word targets; a user prompt listing all the batch's states
    (numbered) and asking for a JSON **array** of objects in the same order.
  - Parses the array, validates each element, matches results to units by
    index.
  - Retries the whole batch up to 3× on failure / unparseable output.
  - Any unit still missing after retries gets flagged fallback copy
    (`FALLBACK[hrBucket]`) so the preview is always complete; failed units
    are marked so the UI can show them.
  - Returns rows shaped for `hero_titles` plus per-unit status.
- **`saveHeroTitles(rows, mode)`** → `mode: 'replace' | 'append'`.
  - `replace`: delete all rows, then insert the new set (single transaction).
  - `append`: plain insert of the new rows.
  - Re-validates every row server-side before writing (do not trust the
    client). Invalidates the in-memory title cache afterwards.
- **`runFullGeneration(params?)`** → loops every batch for `variantsPerBucket
  = 1` and saves in `replace` mode with default params. Used by the
  scheduler and the startup top-up. Defaults: empty style, headline 3 words,
  strap 22 words.
- **`validateGenerated(parsed, limits)`** → now takes
  `{ headlineWords, strapWords }` instead of hard-coded char limits.
  Validates by word count, with a generous derived char ceiling as a safety
  net. Keeps the existing rules: no digits anywhere; strap must contain
  `{bpm}` and at least one other token; `primary`/`ghost` upper-cased.
- **`snapHeroTitle(input)`** → snaps to a bucket as before, then picks a
  **random** row among all rows matching that bucket. Falls back to
  `FALLBACK[hrBucket]` when the bucket has no rows.

Batch size is a constant `BATCH_SIZE = 50`. `max_tokens` for a batch call is
sized generously to the batch (≈ 250 tokens × unit count); the per-call
timeout is raised from 90s to ~180s to cover a 50-unit call. GLM extended
reasoning stays disabled (`thinking: { type: 'disabled' }`).

### 3. Endpoints

Child routes of `/admin/hero` (auto-guarded by the central auth handle):

- **`POST /admin/hero/generate`** — body
  `{ style, headlineWords, strapWords, variantsPerBucket, batchIndex }`.
  Computes the unit list, slices batch `batchIndex`, runs `generateBatch`,
  returns `{ totalBatches, batchIndex, rows }`.
- **`POST /admin/hero/save`** — body `{ mode, rows }`. Calls
  `saveHeroTitles`. Returns the new pool count.
- **`POST /admin/hero/delete`** — body `{ id }` to prune a single variant,
  or `{ all: true }` to clear the whole pool. Invalidates the cache.

### 4. Admin page (`/admin/hero`)

**Controls panel** (top):

- **Style** textarea — "Influence tone, themes, references…". Empty = the
  current default voice.
- **Headline length** slider — 1-6 words, default 3. Applies to both
  `primary` and `ghost`.
- **Strap length** slider — 10-40 words, default 22.
- **Variants per bucket** number input — 1-5, default 1.
- **Generate preview** button — runs the client-driven batch loop.

**Generation (client-driven batch loop):** the page POSTs
`/admin/hero/generate` once per batch (`batchIndex` 0…`totalBatches-1`,
sequential), accumulating rows in client state and showing a "batch N/M"
progress line. Each request is a single ≤ 50-unit LLM call, so no request is
held longer than one call. `totalBatches` comes back on the first response.

**Preview table:** the accumulated generated rows, read-only, grouped by
bucket (variants listed together). Fallback / failed rows are visually
flagged. A save bar offers **Save — Replace pool**, **Save — Append to
pool**, and **Discard**. Save POSTs the whole accumulated set to
`/admin/hero/save` with the chosen mode.

**Current pool table:** below the controls, the existing saved rows, grouped
by bucket, each with a delete control; plus a **Clear pool** action. Shown
when no preview is active.

The last-used style text, slider values, and variant count are persisted to
`localStorage` and restored on load.

### 5. Landing page & scheduler

- Landing `+page.server.ts` is unchanged in shape — `snapHeroTitle()` now
  returns a random variant for the snapped bucket.
- `hero-titles-scheduler.ts` calls `runFullGeneration()` for both the
  weekly regeneration and the startup top-up. The startup check generates
  when the pool is empty or any bucket has zero variants.

### 6. Error handling

- A failed batch call retries up to 3× inside `generateBatch`.
- A partial array (e.g. 48 objects for 50 units) matches by index; missing
  units get flagged fallback copy.
- `saveHeroTitles` re-validates every row; an invalid row rejects the save
  with a message (defensive — the preview was already validated).
- `replace` runs inside a transaction so a mid-save failure cannot leave the
  pool empty.

### 7. Testing

Unit tests use an injected fake LLM function (the existing `LLMGenFn`
injection pattern):

- `validateGenerated` with custom word limits — pass / reject cases.
- `enumerateUnits` — produces `150 × N` units.
- `generateBatch` — array parsing, partial-result handling, fallback for
  missing units.
- `saveHeroTitles` — `replace` clears then inserts; `append` adds.
- `snapHeroTitle` — picks a random variant; falls back when a bucket is
  empty.

## Files

**Modified:**

- `src/lib/db/schema.ts` — drop unique index, add `style` column.
- `src/lib/landing/hero-titles-service.ts` — batch generation, save modes,
  parameterised validation, random variant snap.
- `src/lib/landing/hero-titles-scheduler.ts` — call `runFullGeneration()`.
- `src/routes/admin/hero/+page.server.ts` — load current pool rows.
- `src/routes/admin/hero/+page.svelte` — controls, batch loop, preview,
  pool management.
- `src/lib/landing/hero-titles-service.test.ts` — updated / new tests.

**New:**

- `src/routes/admin/hero/generate/+server.ts`
- `src/routes/admin/hero/save/+server.ts`
- `src/routes/admin/hero/delete/+server.ts`

## Rollout

1. `npx drizzle-kit push` to drop the index and add the column.
2. Existing rows survive (one variant each); the page works immediately.
3. Deploy via `scripts/deploy.sh`; verify the page and a small generation
   run on production.
