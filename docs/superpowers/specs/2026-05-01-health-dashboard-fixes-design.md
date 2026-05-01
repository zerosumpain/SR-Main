# Health Dashboard Fixes — Design

**Date:** 2026-05-01
**Scope:** `/health` dashboard — fix pulse-grid peak detection, replace deterministic hero copy with LLM-generated copy, replace hardcoded correlations with auto-discovery.

---

## Problem

Three issues on `/health`:

1. **Pulse grid peak ring lands on the wrong day.** Yesterday's HRV of 90 is the actual best in the 30-day window, but the black "peak" ring sits on an earlier day. Same class of bug for steps and other metrics.
2. **Hero headline is one of five hardcoded strings** keyed off recovery percent. Same for the strap. No personality, no contextual nuance.
3. **"What moves what" always shows the same four hand-coded analyses.** Not extensible; can't surface unexpected patterns.

---

## 1. Pulse grid peak detection

### Bug

`src/lib/components/health/v2/PulseGrid.svelte:69-95` finds the peak by `max` of `row.f(d)` — but `row.f` clamps the normalised value to `[0, 1]`:

| Metric | `f()` | Clamps at 1.0 when |
| --- | --- | --- |
| HRV | `clamp((hrv - 25) / 50, 0, 1)` | hrv ≥ 75 |
| RHR | `clamp(1 - (rhr - 50) / 22, 0, 1)` | rhr ≤ 50 |
| Sleep | `clamp((slept - 5) / 4, 0, 1)` | slept ≥ 9h |
| Steps | `clamp(steps / 16000, 0, 1)` | steps ≥ 16k |
| Strain | `clamp(strain / 21, 0, 1)` | strain ≥ 21 |

When multiple days clamp to 1.0, strict `>` keeps the **first** one. The black ring lands on the earliest day above the threshold, not the actual best.

A second bug: today is excluded entirely (`upto = series.length - 1`), so today can never win the ring.

### Fix

Re-implement `peakIndex(row)` to rank on **raw values**:

- HRV / REC / SLEPT / STRAIN / STEPS → max raw value wins.
- RHR → min raw value wins (lower is better).
- Skip days where the raw value is `0` or null (no data).
- Today is **eligible**.

Pseudocode:

```ts
function peakIndex(row: Row): number {
  const directionMax = row.key !== 'rhr';
  let best = directionMax ? -Infinity : Infinity;
  let idx = -1;
  for (let i = 0; i < series.length; i++) {
    const raw = rawValueFor(series[i], row.key);
    if (raw <= 0) continue;
    if (directionMax ? raw > best : raw < best) {
      best = raw;
      idx = i;
    }
  }
  return idx;
}
```

Strict comparison still picks the first occurrence on a true tie — that's fine, it's no longer driven by the clamp.

### Today + peak coexist

Today already has its cream `::after` tint. The peak is also drawn via `::after`, so they currently can't coexist. Refactor:

- Move the cream tint to a dedicated rule — e.g. an additional pseudo-element via `.h-pg-cell.today` painted as a `box-shadow inset` or a separate inner `<span>`, so it doesn't conflict with the peak's `::after` ring.
- The peak's black ring stays on `::after`.
- When today is the peak, both visuals render: cream tint underneath, black ring on top.
- `aria-label`: append `· today · row peak` when both apply.

### Tests

Pulse grid logic has no tests today. Extract `peakIndex` into `src/lib/components/health/v2/utils.ts` (already exists) and add a small unit test:

- HRV column with values `[60, 90, 88, 75]` → peak at index 1.
- RHR column with values `[55, 48, 52, 50]` → peak at index 1 (lowest non-zero).
- Column with all zeros → peak `-1`.
- Column where today (last index) is the actual best → peak = last index.

---

## 2. Hero LLM headline + strap

### Replace

`pickHeadline(rec)` and `buildStrap(today, yesterday, rhrBaseline)` in `src/lib/health/series-30d-service.ts:121-143`. They stay in the file as the **fallback path** if the LLM call fails.

### New module: `src/lib/health/hero-copy-service.ts`

```ts
export interface HeroCopy {
  headline: { primary: string; ghost: string };
  strap: string;
}

export interface HeroCopyInput {
  date: string;
  rec: number;
  hrv: number;
  rhr: number;
  slept: number;
  rhrBaseline: number;
  hrvDeltaPct: number;
}

export async function getHeroCopy(input: HeroCopyInput): Promise<HeroCopy>;
```

### Behaviour

- **In-process cache.** `Map<string, { copy: HeroCopy; expires: number }>`.
- **Cache key:** `${date}|${rec}|${hrv}|${rhr}|${slept}` — regenerates whenever any underlying number shifts.
- **TTL:** 6 hours.
- **LLM call:** via the existing pattern — `resolveDefaultModel('chat')` → `getLLMClient(ctx)` (matches how `src/lib/workflows/nodes/llm-helpers.ts` resolves the chat default). The CLAUDE.md "all AI calls via `$lib/vertex`" rule predates this stack; use the same client every other server caller uses today.
- **Prompt:** asks for JSON `{ "primary": "...", "ghost": "...", "strap": "..." }`. Constraints in the prompt:
  - `primary` and `ghost` are 1-3 words each, ALL CAPS, brutal/witty/funny tone, reflecting today's recovery position. Example shape: `"WRECKED."` / `"DON'T LIFT."`.
  - `strap` is one sentence (≤ 24 words). MUST mention at least two of: `rec%`, `hrv` change, `rhr` vs baseline, `slept` hours. Same dry tone as the existing strap.
- **Schema validation:** parse JSON; require all three fields are non-empty strings; primary+ghost ≤ 32 chars combined; strap ≤ 200 chars. On any failure, fall back to `pickHeadline` + `buildStrap`.
- **Timeout / error path:** wrap in `try/catch` with a 6s timeout. Any failure → fallback. Page never breaks; failures log to `console.warn` server-side only.

### Wiring

`series-30d-service.ts:516-517`:

```ts
// before
const headline = pickHeadline(today.rec);
const strap = buildStrap(today, yesterday, rhrBaseline);

// after
const heroCopy = await getHeroCopy({
  date: today.date,
  rec: today.rec,
  hrv: today.hrv,
  rhr: today.rhr,
  slept: today.slept,
  rhrBaseline,
  hrvDeltaPct: yesterday.hrv > 0
    ? Math.round(((today.hrv - yesterday.hrv) / yesterday.hrv) * 100)
    : 0,
});
const { headline, strap } = heroCopy;
```

`pickHeadline` and `buildStrap` stay exported and become the fallback inside `getHeroCopy`.

### Tests

`tests/lib/health/hero-copy-service.test.ts` (new):

- Cache hit: same input twice → LLM client called once.
- Cache miss on different `hrv` → LLM client called twice.
- Cache expiry after 6h → LLM client called again.
- LLM throws → returns `pickHeadline`/`buildStrap` output, no exception bubbles.
- LLM returns malformed JSON → fallback used.
- LLM returns valid JSON missing `strap` field → fallback used.
- LLM returns oversized strap (> 200 chars) → fallback used.

Mock the LLM client; do not hit real models in tests.

---

## 3. Correlations auto-discovery

### Replace

The 4 hardcoded analyses in `src/lib/health/correlations-service.ts:129-220`.

### New engine

Same data-loading prologue (lines 47-127 stay). After `ordered` is built:

1. **Candidate pairs.** All ordered (X, Y) where X, Y ∈ `{rec, hrv, rhr, slept, strain, steps, sleepScore}` and X ≠ Y, in two flavours:
   - Same-day: pair `(d.X, d.Y)`.
   - Lagged: pair `(d_yesterday.X, d_today.Y)` — "after a high-X day, what does Y do".
2. **Denylist** (definitionally entangled, both same-day and lagged):
   - `rec ↔ hrv`
   - `rec ↔ rhr`
   - `sleepScore ↔ slept`
   - Ordered both directions.
3. For each surviving candidate, compute Pearson r over the 90-day window using only days where both raw values are non-null and > 0. Record `n` (number of paired days).
4. Filter `n ≥ 10 AND |r| ≥ 0.3`.
5. Rank by `|r| × √n` descending. Take top 4.
6. Render each via a `(metric, lag) → label` map:

```ts
const NOUN: Record<MetricKey, { cause: string; effect: string }> = {
  rec:        { cause: 'recovery',     effect: 'recovery' },
  hrv:        { cause: 'HRV',          effect: 'HRV' },
  rhr:        { cause: 'resting HR',   effect: 'resting HR' },
  slept:      { cause: 'sleep',        effect: 'sleep duration' },
  strain:     { cause: 'strain',       effect: 'strain' },
  steps:      { cause: 'steps',        effect: 'steps' },
  sleepScore: { cause: 'sleep score',  effect: 'sleep score' },
};
```

Cause string templates:
- Same-day: `${NOUN[X].cause} ↔ ${NOUN[Y].effect}`
- Lagged: `After a high-${NOUN[X].cause} day` / effect `Next-day ${NOUN[Y].effect}`

`num` is `r = ${sign}${|r|.toFixed(2)}`. Effect direction word ("tracks with" / "inverts with") chosen by sign of r.

### Confidence label

Add `confidence: 'STRONG' | 'MAYBE' | 'NOISE'` to the `Correlation` type.

```ts
function bucket(n: number, r: number): 'STRONG' | 'MAYBE' | 'NOISE' {
  const a = Math.abs(r);
  if (n >= 30 && a >= 0.5) return 'STRONG';
  if (n >= 10 && a >= 0.3) return 'MAYBE';
  return 'NOISE';
}
```

In practice the `n ≥ 10 AND |r| ≥ 0.3` filter means only `STRONG` and `MAYBE` ever render — `NOISE` is kept on the type so the threshold can be relaxed later for a "weak signals" mode.

### Type change

In `src/lib/health/series-30d-service.ts:40`:

```ts
export type Correlation = {
  cause: string;
  effect: string;
  num: string;
  conf: string;                // existing — n=X annotation
  confidence: 'STRONG' | 'MAYBE' | 'NOISE';   // new
};
```

`STATIC_CORRELATIONS` (line 288) used as a fallback when DB is empty — give each entry `confidence: 'MAYBE'` so the badge doesn't break.

### UI change

`src/lib/components/health/v2/Correlations.svelte` — add a small badge above `h-corr-conf`:

```svelte
<p class="h-corr-badge h-corr-badge-{it.confidence.toLowerCase()}">{it.confidence}</p>
```

Badge styling: same mono font, 9px, letter-spaced. STRONG → accent colour; MAYBE → text-muted; NOISE → text-ghost. (NOISE shouldn't render in practice but style it anyway.)

### Tests

`tests/lib/health/correlations-service.test.ts` — extend existing or add:

- Synthetic data with strong correlation between two non-blacklisted metrics → appears in output, `confidence: 'STRONG'` if n ≥ 30.
- Synthetic data with strong correlation between blacklisted pair (e.g. rec/hrv) → does NOT appear.
- Weak correlation `|r| < 0.3` → does NOT appear.
- More than 4 passing pairs → top 4 by `|r| × √n` returned.
- All-zero data → empty result, no crash.

---

## Files touched

- `src/lib/components/health/v2/PulseGrid.svelte` — peak logic + CSS for today+peak coexistence.
- `src/lib/components/health/v2/utils.ts` — extract `peakIndex` for testability.
- `src/lib/components/health/v2/Correlations.svelte` — confidence badge.
- `src/lib/health/correlations-service.ts` — full rewrite of analysis engine, retain DB loading prologue.
- `src/lib/health/hero-copy-service.ts` — **new**.
- `src/lib/health/series-30d-service.ts` — call `getHeroCopy`, add `confidence` field to `Correlation`, update `STATIC_CORRELATIONS`. Keep `pickHeadline`/`buildStrap` as fallback exports.
- `tests/lib/health/correlations-service.test.ts` — new or extended.
- `tests/lib/health/hero-copy-service.test.ts` — **new**.
- `tests/lib/components/health/pulse-grid-peak.test.ts` — **new** small unit test for the extracted `peakIndex`.

---

## Out of scope

- DB persistence for hero copy (in-process cache is enough; restart regenerates).
- A/B switch between deterministic and LLM hero copy.
- Visual changes to hero foot meta or `h-annot` blocks.
- Tuning the auto-discovery filter thresholds (`n ≥ 10`, `|r| ≥ 0.3`) — start with these, adjust if results are bad.
- Removing the existing 4 hand-coded analyses' wording — auto-discovery may rediscover some of them with different labels and that's fine.

---

## Risks / open questions

- **LLM tone drift.** The model may produce bland or overly safe output. Mitigation: include 2-3 few-shot examples in the prompt matching the existing voice ("WRECKED." / "DON'T LIFT.", "MEH." / "WALK IT OFF.").
- **Cold-load latency.** First page hit after server restart pays the LLM call. 6s timeout caps the worst case; fallback is instant. Acceptable for a personal site.
- **Auto-discovery surfaces nothing useful.** If the top 4 are all weak/boring after the denylist, the section will look thin. Mitigation: STATIC_CORRELATIONS fallback already exists for the empty case; could extend to "fewer than 2 results" later if needed.
