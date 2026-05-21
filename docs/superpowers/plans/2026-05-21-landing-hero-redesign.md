# Landing Hero Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the landing-page hero in the `/health` v2 hero language, led by short witty LLM-generated headlines snapped from a pre-generated set of ~150 cached title combinations.

**Architecture:** A `hero_titles` Postgres table holds ~150 rows, one per bucket of (heart rate × steps × temperature). A generation service fills it via the LLM; a weekly scheduler and an admin page refresh it. At SSR the landing page snaps live vitals to the nearest bucket per axis and renders that row's headline + a strap whose number-slots are filled with live values. The hero background is an ECG trace by default with a toggle back to the existing biome particle field.

**Tech Stack:** SvelteKit (Svelte 5 runes), Drizzle ORM + PostgreSQL, OpenAI-compatible LLM client via `$lib/jkai/llm-client`, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-21-landing-hero-redesign-design.md`

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `src/lib/db/schema.ts` | Add `heroTitles` table (modify) |
| `src/lib/landing/hero-titles-buckets.ts` | Pure grid math: bucket defs, snapping, grid enumeration, strap fill (create) |
| `src/lib/landing/hero-titles-buckets.test.ts` | Tests for the above (create) |
| `src/lib/landing/hero-titles-service.ts` | Validation, LLM generation, in-memory cache, `snapHeroTitle`, fallback (create) |
| `src/lib/landing/hero-titles-service.test.ts` | Tests for validation (create) |
| `src/lib/landing/hero-titles-scheduler.ts` | Weekly regeneration cron (create) |
| `src/lib/components/shared/Ecg.svelte` | ECG trace, moved from `health/v2/` (move) |
| `src/lib/components/health/v2/Hero.svelte` | Update `Ecg` import path (modify) |
| `src/lib/components/landing/LandingHero.svelte` | New hero foreground content (create) |
| `src/lib/components/landing/BackgroundToggle.svelte` | ECG ⇄ biome toggle, generalised from `BiomeToggle` (create) |
| `src/routes/+page.server.ts` | Snap live vitals → `heroTitle` (modify) |
| `src/routes/+page.svelte` | Use `LandingHero`, switch background, section numbering (modify) |
| `src/routes/admin/hero/+page.server.ts` | Admin load + regenerate action (create) |
| `src/routes/admin/hero/+page.svelte` | Admin UI (create) |
| `src/hooks.server.ts` | Start/stop the hero-titles scheduler (modify) |

---

## Task 1: Add the `hero_titles` table

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add the table definition**

Append after the `biomeConfig` table definition (`src/lib/db/schema.ts`, around line 344). `serial`, `integer`, `text`, `timestamp`, and `uniqueIndex` are already imported at the top of the file.

```ts
export const heroTitles = pgTable(
  'hero_titles',
  {
    id: serial('id').primaryKey(),
    hrBucket: integer('hr_bucket').notNull(),
    stepsBucket: integer('steps_bucket').notNull(),
    tempBucket: integer('temp_bucket').notNull(),
    hrCentroid: integer('hr_centroid').notNull(),
    stepsCentroid: integer('steps_centroid').notNull(),
    tempCentroid: integer('temp_centroid').notNull(),
    primary: text('primary').notNull(),
    ghost: text('ghost').notNull(),
    strapTemplate: text('strap_template').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    bucketUnique: uniqueIndex('hero_titles_bucket_unique').on(
      t.hrBucket,
      t.stepsBucket,
      t.tempBucket,
    ),
  }),
);
```

- [ ] **Step 2: Push the schema to the database**

Run: `npx drizzle-kit push`
Expected: prompts to create table `hero_titles`; confirm. Output ends with changes applied, no errors.

- [ ] **Step 3: Verify the table exists**

Run: `npx drizzle-kit studio` is not needed — instead verify via psql or pgweb that `hero_titles` exists with the 10 columns. Quick check:
Run: `node -e "import('./src/lib/db/index.js')" 2>/dev/null; echo "schema compiles"`
Expected: no throw. (If the project has no compiled JS, skip — Step 4 of Task 12 covers a full type check.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(landing): add hero_titles table for cached hero copy"
```

---

## Task 2: Bucket grid math (`hero-titles-buckets.ts`)

Pure functions — no DB, no network. Test-driven.

**Files:**
- Create: `src/lib/landing/hero-titles-buckets.ts`
- Test: `src/lib/landing/hero-titles-buckets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/landing/hero-titles-buckets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  snapBucket,
  snapToBuckets,
  enumerateGrid,
  fillStrap,
  HR_BUCKETS,
  STEPS_BUCKETS,
  TEMP_BUCKETS,
} from './hero-titles-buckets';

describe('snapBucket', () => {
  it('picks the nearest centroid index', () => {
    expect(snapBucket(55, HR_BUCKETS.centroids)).toBe(0); // 50 closer than 62
    expect(snapBucket(57, HR_BUCKETS.centroids)).toBe(1); // 62 closer than 50
  });
  it('clamps values beyond the ends to the end buckets', () => {
    expect(snapBucket(200, HR_BUCKETS.centroids)).toBe(4);
    expect(snapBucket(10, HR_BUCKETS.centroids)).toBe(0);
  });
  it('breaks ties toward the lower index', () => {
    expect(snapBucket(56, HR_BUCKETS.centroids)).toBe(0); // equidistant 50/62
  });
});

describe('snapToBuckets', () => {
  it('snaps each axis independently', () => {
    expect(snapToBuckets(62, 200, 15)).toEqual({
      hrBucket: 1,
      stepsBucket: 0,
      tempBucket: 3,
    });
  });
});

describe('enumerateGrid', () => {
  it('produces exactly 150 unique grid points', () => {
    const grid = enumerateGrid();
    expect(grid).toHaveLength(150);
    const keys = new Set(
      grid.map((p) => `${p.hrBucket}-${p.stepsBucket}-${p.tempBucket}`),
    );
    expect(keys.size).toBe(150);
  });
  it('carries centroid and state for each axis', () => {
    const p = enumerateGrid()[0];
    expect(p.hrCentroid).toBe(HR_BUCKETS.centroids[0]);
    expect(p.tempState).toBe(TEMP_BUCKETS.states[0]);
  });
});

describe('fillStrap', () => {
  it('replaces every known token with a live value', () => {
    const out = fillStrap('{bpm} beats, {steps} steps, {temp} of {sky} sky', {
      bpm: 62.4,
      steps: 9400,
      temp: 14.6,
      sky: 'CLOUDY',
    });
    expect(out).toBe('62 beats, 9,400 steps, 15° of cloudy sky');
  });
  it('leaves unknown tokens untouched', () => {
    expect(fillStrap('a {wat} b', { bpm: 1, steps: 1, temp: 1, sky: 'x' })).toBe(
      'a {wat} b',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/landing/hero-titles-buckets.test.ts`
Expected: FAIL — cannot resolve `./hero-titles-buckets`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/landing/hero-titles-buckets.ts`:

```ts
export interface AxisBuckets {
  axis: 'hr' | 'steps' | 'temp';
  states: string[];
  centroids: number[];
}

export const HR_BUCKETS: AxisBuckets = {
  axis: 'hr',
  states: ['deep rest', 'resting', 'slightly raised', 'elevated', 'working hard'],
  centroids: [50, 62, 80, 105, 140],
};

export const STEPS_BUCKETS: AxisBuckets = {
  axis: 'steps',
  states: ['barely moved', 'a slow start', 'building up', 'active', 'a big day'],
  centroids: [200, 2000, 6000, 11000, 18000],
};

export const TEMP_BUCKETS: AxisBuckets = {
  axis: 'temp',
  states: ['freezing', 'cold', 'cool', 'mild', 'warm', 'hot'],
  centroids: [-2, 5, 10, 15, 21, 28],
};

/** Index of the centroid nearest to `value`. Ties resolve to the lower index. */
export function snapBucket(value: number, centroids: number[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const d = Math.abs(value - centroids[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export interface BucketKey {
  hrBucket: number;
  stepsBucket: number;
  tempBucket: number;
}

/**
 * Snap live vitals to a bucket key. The centroids form an axis-aligned grid,
 * so the nearest grid point equals the per-axis nearest centroid.
 */
export function snapToBuckets(hr: number, steps: number, temp: number): BucketKey {
  return {
    hrBucket: snapBucket(hr, HR_BUCKETS.centroids),
    stepsBucket: snapBucket(steps, STEPS_BUCKETS.centroids),
    tempBucket: snapBucket(temp, TEMP_BUCKETS.centroids),
  };
}

export interface GridPoint {
  hrBucket: number;
  stepsBucket: number;
  tempBucket: number;
  hrCentroid: number;
  stepsCentroid: number;
  tempCentroid: number;
  hrState: string;
  stepsState: string;
  tempState: string;
}

/** Every (hr × steps × temp) combination — 5 × 5 × 6 = 150 points. */
export function enumerateGrid(): GridPoint[] {
  const out: GridPoint[] = [];
  for (let h = 0; h < HR_BUCKETS.centroids.length; h++) {
    for (let s = 0; s < STEPS_BUCKETS.centroids.length; s++) {
      for (let t = 0; t < TEMP_BUCKETS.centroids.length; t++) {
        out.push({
          hrBucket: h,
          stepsBucket: s,
          tempBucket: t,
          hrCentroid: HR_BUCKETS.centroids[h],
          stepsCentroid: STEPS_BUCKETS.centroids[s],
          tempCentroid: TEMP_BUCKETS.centroids[t],
          hrState: HR_BUCKETS.states[h],
          stepsState: STEPS_BUCKETS.states[s],
          tempState: TEMP_BUCKETS.states[t],
        });
      }
    }
  }
  return out;
}

export interface StrapVitals {
  bpm: number;
  steps: number;
  temp: number;
  sky: string;
}

/** Fill a strap template's number-slots with live values. */
export function fillStrap(template: string, v: StrapVitals): string {
  return template
    .replace(/\{bpm\}/g, String(Math.round(v.bpm)))
    .replace(/\{steps\}/g, v.steps.toLocaleString('en-GB'))
    .replace(/\{temp\}/g, `${Math.round(v.temp)}°`)
    .replace(/\{sky\}/g, v.sky.toLowerCase());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/landing/hero-titles-buckets.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/hero-titles-buckets.ts src/lib/landing/hero-titles-buckets.test.ts
git commit -m "feat(landing): hero-title bucket grid + snapping"
```

---

## Task 3: Title service — validation, generation, snapping (`hero-titles-service.ts`)

**Files:**
- Create: `src/lib/landing/hero-titles-service.ts`
- Test: `src/lib/landing/hero-titles-service.test.ts`

- [ ] **Step 1: Write the failing test for `validateGenerated`**

Create `src/lib/landing/hero-titles-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateGenerated } from './hero-titles-service';

describe('validateGenerated', () => {
  const good = {
    primary: 'still.',
    ghost: 'but plotting.',
    strap: '{bpm} beats, {steps} steps, {temp} of {sky} London.',
  };

  it('accepts a well-formed entry and upper-cases the headline', () => {
    const r = validateGenerated(good);
    expect(r).not.toBeNull();
    expect(r!.primary).toBe('STILL.');
    expect(r!.ghost).toBe('BUT PLOTTING.');
    expect(r!.strapTemplate).toBe(good.strap);
  });

  it('rejects a missing field', () => {
    expect(validateGenerated({ primary: 'A.', ghost: 'B.' })).toBeNull();
  });

  it('rejects digits in the headline', () => {
    expect(validateGenerated({ ...good, primary: '62 BPM.' })).toBeNull();
  });

  it('rejects digits in the strap', () => {
    expect(
      validateGenerated({ ...good, strap: '62 beats and {bpm} more.' }),
    ).toBeNull();
  });

  it('rejects a strap with no {bpm} token', () => {
    expect(
      validateGenerated({ ...good, strap: 'a quiet morning of {sky}.' }),
    ).toBeNull();
  });

  it('rejects an over-length headline', () => {
    expect(
      validateGenerated({ ...good, primary: 'A'.repeat(25) }),
    ).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(validateGenerated('nope')).toBeNull();
    expect(validateGenerated(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/landing/hero-titles-service.test.ts`
Expected: FAIL — cannot resolve `./hero-titles-service`.

- [ ] **Step 3: Write the service implementation**

Create `src/lib/landing/hero-titles-service.ts`:

```ts
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import {
  enumerateGrid,
  snapToBuckets,
  fillStrap,
  type GridPoint,
} from './hero-titles-buckets';

export interface HeroTitleCopy {
  primary: string;
  ghost: string;
  strapTemplate: string;
}

export interface HeroTitle {
  primary: string;
  ghost: string;
  strap: string;
}

const MAX_HEADLINE_LEN = 24;
const MAX_STRAP_LEN = 200;
const TIMEOUT_MS = 90_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;

/** Deterministic fallback, one entry per HR bucket index (0-4). */
const FALLBACK: HeroTitleCopy[] = [
  {
    primary: 'STILL.',
    ghost: 'FOR NOW.',
    strapTemplate: '{bpm} beats, {steps} steps, {temp} of {sky}. The day has not been agreed to yet.',
  },
  {
    primary: 'IDLING.',
    ghost: 'BUT HERE.',
    strapTemplate: '{bpm} beats, {steps} steps, {temp} and {sky}. Ticking over, nothing forced.',
  },
  {
    primary: 'WARMING UP.',
    ghost: 'KEEP GOING.',
    strapTemplate: '{bpm} beats, {steps} steps, {temp} of {sky}. The body is paying attention now.',
  },
  {
    primary: 'PUSHING.',
    ghost: "DON'T STOP.",
    strapTemplate: '{bpm} beats, {steps} steps, {temp} and {sky}. Well into the effort.',
  },
  {
    primary: 'FLAT OUT.',
    ghost: 'ALL IN.',
    strapTemplate: '{bpm} beats, {steps} steps, {temp} of {sky}. Nothing held in reserve.',
  },
];

/** Validate an LLM-generated entry. Returns null if it fails any rule. */
export function validateGenerated(parsed: unknown): HeroTitleCopy | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
  const ghost = typeof o.ghost === 'string' ? o.ghost.trim() : '';
  const strap = typeof o.strap === 'string' ? o.strap.trim() : '';
  if (!primary || !ghost || !strap) return null;
  if (primary.length > MAX_HEADLINE_LEN || ghost.length > MAX_HEADLINE_LEN) return null;
  if (strap.length > MAX_STRAP_LEN) return null;
  if (/\d/.test(primary) || /\d/.test(ghost) || /\d/.test(strap)) return null;
  if (!strap.includes('{bpm}')) return null;
  return {
    primary: primary.toUpperCase(),
    ghost: ghost.toUpperCase(),
    strapTemplate: strap,
  };
}

// ---------------------------------------------------------------------------
// In-memory cache (5-minute TTL) — covers cron regenerations and admin edits.
// ---------------------------------------------------------------------------

type Row = typeof heroTitles.$inferSelect;
let cache: { rows: Row[]; loadedAt: number } | null = null;

async function loadRows(): Promise<Row[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows = await db.select().from(heroTitles);
  cache = { rows, loadedAt: now };
  return rows;
}

export function invalidateHeroTitlesCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Snapping — used by the landing page SSR load.
// ---------------------------------------------------------------------------

export interface SnapInput {
  hr: number;
  steps: number;
  temp: number;
  condition: string;
}

export async function snapHeroTitle(input: SnapInput): Promise<HeroTitle> {
  const key = snapToBuckets(input.hr, input.steps, input.temp);
  let copy: HeroTitleCopy;
  try {
    const rows = await loadRows();
    const row = rows.find(
      (r) =>
        r.hrBucket === key.hrBucket &&
        r.stepsBucket === key.stepsBucket &&
        r.tempBucket === key.tempBucket,
    );
    copy = row
      ? { primary: row.primary, ghost: row.ghost, strapTemplate: row.strapTemplate }
      : FALLBACK[key.hrBucket];
  } catch (err) {
    console.warn('[hero-titles] snap fell back:', err instanceof Error ? err.message : err);
    copy = FALLBACK[key.hrBucket];
  }
  return {
    primary: copy.primary,
    ghost: copy.ghost,
    strap: fillStrap(copy.strapTemplate, {
      bpm: input.hr,
      steps: input.steps,
      temp: input.temp,
      sky: input.condition,
    }),
  };
}

// ---------------------------------------------------------------------------
// LLM generation.
// ---------------------------------------------------------------------------

function buildPrompt(p: GridPoint): { system: string; user: string } {
  const system = [
    'You write the hero copy for the landing page of a personal website.',
    "The page shows the owner's live vitals; your copy is the first thing a visitor reads.",
    'Tone: dry, witty, snappy, lightly provocative. Never cheerful, never preachy.',
    'Output strict JSON only: {"primary":"...","ghost":"...","strap":"..."}.',
    'No code fences, no commentary.',
    'primary: 1-3 words, ALL CAPS, ends with a full stop. Names the state.',
    'ghost: 1-3 words, ALL CAPS, ends with a full stop. The turn or the punchline.',
    'strap: one sentence, 22 words maximum, same mood as the headline.',
    'NUMBERS: never write digits anywhere. primary and ghost contain no numbers at all.',
    'In the strap, refer to live figures ONLY through these tokens: {bpm} {steps} {temp} {sky}.',
    'The strap MUST contain {bpm} and at least one other token.',
    'Voice examples (do not copy verbatim):',
    '  {"primary":"STILL.","ghost":"BUT PLOTTING.","strap":"{bpm} beats, {steps} steps, {temp} of {sky} London — the day has not been agreed to yet."}',
    '  {"primary":"LIT UP.","ghost":"DON\'T STOP.","strap":"{bpm} beats and climbing, {steps} steps deep, {temp} and {sky}: this is the good part."}',
    '  {"primary":"SPENT.","ghost":"WELL SPENT.","strap":"{bpm} beats settling, {steps} steps banked, {temp} and {sky} — nothing left to prove today."}',
  ].join('\n');
  const user = [
    "The owner's current state:",
    `- heart rate: ${p.hrState} (around ${p.hrCentroid} bpm)`,
    `- activity so far today: ${p.stepsState} (around ${p.stepsCentroid.toLocaleString('en-GB')} steps)`,
    `- temperature where they are: ${p.tempState} (around ${p.tempCentroid}°C)`,
    '',
    'Return only the JSON object.',
  ].join('\n');
  return { system, user };
}

function tryParseJson(s: string): unknown {
  const cleaned = s
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** One LLM call for one grid point. Returns null on any failure. */
async function callLLM(p: GridPoint): Promise<HeroTitleCopy | null> {
  const ctx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(ctx);
  const { system, user } = buildPrompt(p);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.9,
        // GLM consumes reasoning tokens out of max_tokens before any visible
        // output — give it room (mirrors hero-copy-service).
        max_tokens: 3000,
      },
      { signal: controller.signal },
    );
    const text = completion.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text) return null;
    return validateGenerated(tryParseJson(text));
  } finally {
    clearTimeout(timeout);
  }
}

export type LLMGenFn = (p: GridPoint) => Promise<HeroTitleCopy | null>;

async function upsertRow(p: GridPoint, copy: HeroTitleCopy): Promise<void> {
  await db
    .insert(heroTitles)
    .values({
      hrBucket: p.hrBucket,
      stepsBucket: p.stepsBucket,
      tempBucket: p.tempBucket,
      hrCentroid: p.hrCentroid,
      stepsCentroid: p.stepsCentroid,
      tempCentroid: p.tempCentroid,
      primary: copy.primary,
      ghost: copy.ghost,
      strapTemplate: copy.strapTemplate,
      generatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [heroTitles.hrBucket, heroTitles.stepsBucket, heroTitles.tempBucket],
      set: {
        hrCentroid: p.hrCentroid,
        stepsCentroid: p.stepsCentroid,
        tempCentroid: p.tempCentroid,
        primary: copy.primary,
        ghost: copy.ghost,
        strapTemplate: copy.strapTemplate,
        generatedAt: new Date(),
      },
    });
}

async function loadExistingKeys(): Promise<Set<string>> {
  const rows = await db
    .select({
      h: heroTitles.hrBucket,
      s: heroTitles.stepsBucket,
      t: heroTitles.tempBucket,
    })
    .from(heroTitles);
  return new Set(rows.map((r) => `${r.h}-${r.s}-${r.t}`));
}

export async function heroTitlesCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(heroTitles);
  return r?.n ?? 0;
}

let generationInProgress = false;

export function isGenerationInProgress(): boolean {
  return generationInProgress;
}

/**
 * Regenerate the full ~150-entry set. Non-destructive on partial failure: a
 * bucket whose LLM call fails keeps its existing row, or gets the fallback if
 * it has no row yet. No-op if a generation is already running.
 */
export async function generateHeroTitles(
  llmCall: LLMGenFn = callLLM,
): Promise<{ ok: number; failed: number }> {
  if (generationInProgress) return { ok: 0, failed: 0 };
  generationInProgress = true;
  let ok = 0;
  let failed = 0;
  try {
    const grid = enumerateGrid();
    const existing = await loadExistingKeys();
    for (let i = 0; i < grid.length; i += CONCURRENCY) {
      const batch = grid.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (point) => {
          let copy: HeroTitleCopy | null = null;
          try {
            copy = await llmCall(point);
          } catch (e) {
            console.warn('[hero-titles] generation call threw', e);
          }
          if (copy) {
            await upsertRow(point, copy);
            ok++;
          } else {
            failed++;
            const keyStr = `${point.hrBucket}-${point.stepsBucket}-${point.tempBucket}`;
            if (!existing.has(keyStr)) {
              await upsertRow(point, FALLBACK[point.hrBucket]);
            }
          }
        }),
      );
    }
  } finally {
    generationInProgress = false;
    invalidateHeroTitlesCache();
  }
  return { ok, failed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/landing/hero-titles-service.test.ts`
Expected: PASS — all 7 `validateGenerated` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/hero-titles-service.ts src/lib/landing/hero-titles-service.test.ts
git commit -m "feat(landing): hero-title generation, validation, snapping service"
```

---

## Task 4: Regeneration scheduler

**Files:**
- Create: `src/lib/landing/hero-titles-scheduler.ts`
- Modify: `src/hooks.server.ts`

- [ ] **Step 1: Write the scheduler**

Create `src/lib/landing/hero-titles-scheduler.ts`:

```ts
import { generateHeroTitles, heroTitlesCount } from './hero-titles-service';

let interval: ReturnType<typeof setInterval> | undefined;
let running = false;

const DEFAULT_MS = 7 * 24 * 60 * 60 * 1000; // weekly

export function startHeroTitlesScheduler(): void {
  if (running) return;
  running = true;
  const ms = parseInt(process.env.HERO_TITLES_REGEN_MS || String(DEFAULT_MS), 10);
  console.log(`[hero-titles] regeneration every ${Math.round(ms / 3_600_000)}h`);

  // Let the app finish booting, then generate immediately only if the table
  // is empty (cold start). Otherwise wait one full interval.
  setTimeout(async () => {
    try {
      const count = await heroTitlesCount();
      if (count === 0) {
        console.log('[hero-titles] table empty — generating initial set');
        const res = await generateHeroTitles();
        console.log('[hero-titles] initial generation done', res);
      }
    } catch (e) {
      console.error('[hero-titles] startup check failed', e);
    }
    interval = setInterval(() => {
      generateHeroTitles()
        .then((res) => console.log('[hero-titles] scheduled regeneration done', res))
        .catch((e) => console.error('[hero-titles] scheduled regeneration failed', e));
    }, ms);
  }, 30_000);
}

export function stopHeroTitlesScheduler(): void {
  if (interval) clearInterval(interval);
  interval = undefined;
  running = false;
}
```

- [ ] **Step 2: Wire the scheduler into `hooks.server.ts`**

In `src/hooks.server.ts`, add the import alongside the other scheduler imports near the top (after the `startScheduler as startWorkflowScheduler` import line):

```ts
import {
  startHeroTitlesScheduler,
  stopHeroTitlesScheduler,
} from '$lib/landing/hero-titles-scheduler';
```

Add the start call right after the `startWorkflowScheduler()` block (after its `.catch(...)`):

```ts
// Start the landing-page hero-title regeneration scheduler
startHeroTitlesScheduler();
```

In the `gracefulShutdown()` function, add this line alongside the other `stop…()` calls:

```ts
  stopHeroTitlesScheduler();
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run check 2>&1 | grep -E "hero-titles|hooks.server" || echo "no hero-titles/hooks errors"`
Expected: `no hero-titles/hooks errors`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/landing/hero-titles-scheduler.ts src/hooks.server.ts
git commit -m "feat(landing): weekly hero-title regeneration scheduler"
```

---

## Task 5: Move `Ecg.svelte` to a shared location

The ECG component is currently `/health`-only. Both `/` and `/health` will use it.

**Files:**
- Move: `src/lib/components/health/v2/Ecg.svelte` → `src/lib/components/shared/Ecg.svelte`
- Modify: `src/lib/components/shared/Ecg.svelte` (fix one import)
- Modify: `src/lib/components/health/v2/Hero.svelte` (update import path)

- [ ] **Step 1: Move the file**

```bash
mkdir -p src/lib/components/shared
git mv src/lib/components/health/v2/Ecg.svelte src/lib/components/shared/Ecg.svelte
```

- [ ] **Step 2: Fix the `utils` import in the moved file**

In `src/lib/components/shared/Ecg.svelte`, the import on line 2 currently reads:

```ts
  import { prefersReducedMotion } from './utils';
```

Change it to an absolute path (the util still lives under `health/v2`):

```ts
  import { prefersReducedMotion } from '$lib/components/health/v2/utils';
```

- [ ] **Step 3: Update the import in `Hero.svelte`**

In `src/lib/components/health/v2/Hero.svelte`, line 4 currently reads:

```ts
  import Ecg from './Ecg.svelte';
```

Change it to:

```ts
  import Ecg from '$lib/components/shared/Ecg.svelte';
```

- [ ] **Step 4: Verify nothing else imported the old path**

Run: `grep -rn "health/v2/Ecg" src/ || echo "no stale Ecg imports"`
Expected: `no stale Ecg imports`.

- [ ] **Step 5: Verify it compiles**

Run: `npm run check 2>&1 | grep -E "Ecg" || echo "no Ecg errors"`
Expected: `no Ecg errors`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/shared/Ecg.svelte src/lib/components/health/v2/Hero.svelte
git commit -m "refactor: move Ecg.svelte to shared components"
```

---

## Task 6: Background toggle component

Generalises `BiomeToggle.svelte` into an ECG ⇄ biome switch.

**Files:**
- Create: `src/lib/components/landing/BackgroundToggle.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/components/landing/BackgroundToggle.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let mode = $state<'ecg' | 'biome'>('ecg');

  onMount(() => {
    const stored = localStorage.getItem('landing-bg');
    if (stored === 'biome' || stored === 'ecg') mode = stored;
  });

  function toggle() {
    mode = mode === 'ecg' ? 'biome' : 'ecg';
    localStorage.setItem('landing-bg', mode);
    window.dispatchEvent(new CustomEvent('landing-bg-change', { detail: { mode } }));
  }
</script>

<button
  onclick={toggle}
  class="fixed bottom-4 left-4 z-30 flex items-center gap-2 rounded-full px-3 py-1.5 transition-opacity hover:opacity-100"
  style="background: var(--card-bg); border: 1px solid var(--card-border); opacity: 0.7;"
  title="Switch hero background"
  aria-label="Switch hero background"
>
  <span
    class="text-[9px] uppercase tracking-[0.15em]"
    style="color: var(--text-ghost); font-family: var(--font-mono);"
  >
    {mode === 'ecg' ? 'ECG' : 'Biome'}
  </span>
  <span class="text-[10px]" style="color: var(--text-ghost);">⇄</span>
</button>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check 2>&1 | grep -E "BackgroundToggle" || echo "no BackgroundToggle errors"`
Expected: `no BackgroundToggle errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/landing/BackgroundToggle.svelte
git commit -m "feat(landing): ECG/biome background toggle component"
```

---

## Task 7: `LandingHero` component

The hero foreground: mono tag, primary+ghost headline, accent strap, mono vitals line.

**Files:**
- Create: `src/lib/components/landing/LandingHero.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/components/landing/LandingHero.svelte`:

```svelte
<script lang="ts">
  import { roundPulse } from '$lib/biome/state';

  let {
    tag,
    primary,
    ghost,
    strap,
    pulse,
    steps,
    temp,
    condition,
  }: {
    tag: string;
    primary: string;
    ghost: string;
    strap: string;
    pulse: number;
    steps: number;
    temp: number;
    condition: string;
  } = $props();
</script>

<div class="lh">
  <p class="lh-tag">{tag}</p>
  <h1 class="lh-head">{primary}<br /><span class="ghost">{ghost}</span></h1>
  <p class="lh-strap">{strap}</p>
  <p class="lh-vitals">
    {roundPulse(pulse)} BPM <span class="sep">/</span>
    {steps.toLocaleString('en-GB')} STEPS <span class="sep">/</span>
    {Math.round(temp)}°C {condition.toUpperCase()}
  </p>
</div>

<style>
  .lh {
    max-width: 760px;
  }
  .lh-tag {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 14px;
  }
  .lh-head {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(52px, 9vw, 120px);
    line-height: 0.86;
    letter-spacing: -0.03em;
    text-transform: uppercase;
    margin: 0;
    color: var(--text-primary);
  }
  .lh-head .ghost {
    color: var(--text-ghost);
  }
  .lh-strap {
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-secondary);
    border-left: 3px solid var(--accent);
    padding-left: 14px;
    margin: 20px 0 0;
    max-width: 440px;
  }
  .lh-vitals {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--accent);
    margin: 18px 0 0;
  }
  .lh-vitals .sep {
    color: var(--text-ghost);
  }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check 2>&1 | grep -E "LandingHero" || echo "no LandingHero errors"`
Expected: `no LandingHero errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/landing/LandingHero.svelte
git commit -m "feat(landing): LandingHero component"
```

---

## Task 8: Snap the hero title in the page load

**Files:**
- Modify: `src/routes/+page.server.ts`

- [ ] **Step 1: Add the snap call**

Replace the entire contents of `src/routes/+page.server.ts` with:

```ts
import { getAllPosts } from '$lib/blog';
import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { snapHeroTitle } from '$lib/landing/hero-titles-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const [posts, stepsRows, biomeRes] = await Promise.all([
    getAllPosts().then((p) => p.slice(0, 5)).catch(() => []),
    db
      .select({ value: appleHealthMetrics.value })
      .from(appleHealthMetrics)
      .where(
        and(
          eq(appleHealthMetrics.metricName, 'step_count'),
          gte(appleHealthMetrics.date, todayStart),
        ),
      )
      .catch(() => []),
    fetch('/api/biome/state')
      .then((r) => r.json())
      .catch(() => null),
  ]);

  // Steps are stored * 100, sum all readings for today
  const steps = stepsRows.reduce((sum, r) => sum + Math.round((r.value || 0) / 100), 0);

  const heroTitle = await snapHeroTitle({
    hr: biomeRes?.pulse ?? 60,
    steps,
    temp: biomeRes?.weather?.temp ?? 15,
    condition: biomeRes?.weather?.condition ?? 'clear',
  });

  return { posts, steps, initialBiome: biomeRes, heroTitle };
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run check 2>&1 | grep -E "\+page.server" || echo "no page.server errors"`
Expected: `no page.server errors`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.server.ts
git commit -m "feat(landing): snap hero title from live vitals on page load"
```

---

## Task 9: Rebuild the landing hero in `+page.svelte`

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Replace the script block**

In `src/routes/+page.svelte`, replace the entire `<script lang="ts">` block (lines 13-51) with:

```svelte
<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import ScrollReveal from '$lib/components/ScrollReveal.svelte';
  import BiomeBackground from '$lib/components/BiomeBackground.svelte';
  import BackgroundToggle from '$lib/components/landing/BackgroundToggle.svelte';
  import LandingHero from '$lib/components/landing/LandingHero.svelte';
  import Ecg from '$lib/components/shared/Ecg.svelte';
  import LiveWalkBanner from '$lib/components/LiveWalkBanner.svelte';
  import SiteNav from '$lib/components/SiteNav.svelte';
  import { roundPulse } from '$lib/biome/state';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  const store = getContext<BiomeStore>('biome');

  let { data } = $props();

  let mounted = $state(false);
  let bgMode = $state<'ecg' | 'biome'>('ecg');

  // Before mount: use server-fetched biome data. After mount: use live store.
  let pulse = $derived(mounted ? store.state.pulse : (data.initialBiome?.pulse ?? 60));
  let temp = $derived(
    mounted ? store.state.weather.temp : (data.initialBiome?.weather?.temp ?? 15),
  );
  let condition = $derived(
    mounted
      ? store.state.weather.condition
      : (data.initialBiome?.weather?.condition ?? 'clear'),
  );

  const heroTag = `RIGHT NOW · ${new Date()
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .toUpperCase()} · LONDON`;

  onMount(() => {
    if (data.initialBiome) {
      store.setState(data.initialBiome);
    }
    mounted = true;

    const stored = localStorage.getItem('landing-bg');
    if (stored === 'biome' || stored === 'ecg') bgMode = stored;

    function handleBgChange(e: Event) {
      bgMode = (e as CustomEvent<{ mode: 'ecg' | 'biome' }>).detail.mode;
    }
    window.addEventListener('landing-bg-change', handleBgChange);
    return () => window.removeEventListener('landing-bg-change', handleBgChange);
  });
</script>
```

- [ ] **Step 2: Replace the hero section markup**

In the same file, replace the hero `<section>` (the block from `<!-- HERO -->` through its closing `</section>`, originally lines 53-98) with:

```svelte
<!-- HERO — full viewport, /health hero language -->
<section
  class="relative min-h-screen flex flex-col justify-between px-6 sm:px-10 md:px-16 py-8 overflow-hidden"
>
  {#if bgMode === 'biome'}
    <BiomeBackground {store} position="absolute" transparent />
  {:else}
    <div class="absolute inset-0 pointer-events-none">
      <Ecg rhr={roundPulse(pulse)} />
    </div>
  {/if}

  <!-- Top bar -->
  <SiteNav variant="hero" />

  <!-- Center — hero copy -->
  <div class="relative z-10 flex-1 flex items-center">
    <LandingHero
      tag={heroTag}
      primary={data.heroTitle.primary}
      ghost={data.heroTitle.ghost}
      strap={data.heroTitle.strap}
      {pulse}
      steps={data.steps}
      {temp}
      {condition}
    />
  </div>

  <!-- Live walk banner -->
  <div class="relative z-10 text-center mt-4">
    <LiveWalkBanner />
  </div>

  <!-- Footer meta bar -->
  <div
    class="relative z-10 flex justify-between items-center"
    style="font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);"
  >
    <span>Signature · {bgMode === 'biome' ? 'Biome' : 'Pulse'} · Live</span>
    <span style="opacity: 0.5;">Scroll ↓</span>
  </div>
</section>
```

- [ ] **Step 3: Replace `BiomeToggle` with `BackgroundToggle` at the bottom of the file**

At the end of `src/routes/+page.svelte`, the last element before EOF is `<BiomeToggle />`. Replace that line with:

```svelte
<BackgroundToggle />
```

(The old `import BiomeToggle` line was already removed in Step 1.)

- [ ] **Step 4: Add section numbers to the Biome and Writing sections**

In the "THE BIOME" section, the `<p class="label mb-4">The Biome</p>` line becomes two lines:

```svelte
      <p class="label" style="color: var(--text-ghost); margin-bottom: 4px;">02 / SIGNATURE</p>
      <p class="label mb-4">The Biome</p>
```

In the "WRITING" section, the `<p class="label">Writing</p>` line becomes:

```svelte
        <div>
          <p class="label" style="color: var(--text-ghost); margin-bottom: 4px;">03 / WRITING</p>
          <p class="label">Writing</p>
        </div>
```

(That `<p class="label">Writing</p>` sits inside a `<div class="flex justify-between items-end mb-6">` next to the "All posts →" link — wrap the label in the `<div>` shown above so the link stays right-aligned.)

- [ ] **Step 5: Verify it compiles**

Run: `npm run check 2>&1 | grep -E "routes/\+page" || echo "no +page errors"`
Expected: `no +page errors`.

- [ ] **Step 6: Visual check in the browser**

Run: `npm run dev`
Open: `http://homeserv:5173/`
Verify: hero shows the mono tag, a large primary+ghost headline, an accent strap with live numbers, and the mono vitals line; ECG trace animates behind it; the bottom-left toggle switches to the biome particle field and back; the Biome and Writing sections show their `02 /` and `03 /` numbers. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(landing): rebuild hero with cached titles + ECG background"
```

---

## Task 10: Admin page — `/admin/hero`

**Files:**
- Create: `src/routes/admin/hero/+page.server.ts`
- Create: `src/routes/admin/hero/+page.svelte`

- [ ] **Step 1: Write the server load + regenerate action**

Create `src/routes/admin/hero/+page.server.ts`:

```ts
import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import {
  generateHeroTitles,
  isGenerationInProgress,
} from '$lib/landing/hero-titles-service';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select()
    .from(heroTitles)
    .orderBy(heroTitles.hrBucket, heroTitles.stepsBucket, heroTitles.tempBucket);

  const generatedAt = rows.reduce<string | null>((latest, r) => {
    const t = r.generatedAt ? new Date(r.generatedAt).toISOString() : null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);

  return {
    rows,
    count: rows.length,
    inProgress: isGenerationInProgress(),
    generatedAt,
  };
};

export const actions: Actions = {
  regenerate: async () => {
    if (isGenerationInProgress()) {
      return fail(409, { message: 'Generation already running' });
    }
    // Fire-and-forget — generation of ~150 entries takes minutes.
    void generateHeroTitles().catch((e) =>
      console.error('[hero-titles] admin regeneration failed', e),
    );
    return { started: true };
  },
};
```

- [ ] **Step 2: Write the admin page**

Create `src/routes/admin/hero/+page.svelte`:

```svelte
<svelte:head><title>Hero Titles — Admin</title></svelte:head>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let submitting = $state(false);

  function fmtDate(iso: string | null): string {
    if (!iso) return 'never';
    return new Date(iso).toLocaleString('en-GB');
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Landing page"
    title="hero titles"
    sub="The pre-generated set the landing hero snaps to. {data.count} of 150 entries; last generated {fmtDate(data.generatedAt)}."
  />

  <form
    method="POST"
    action="?/regenerate"
    use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        await update();
        submitting = false;
        await invalidateAll();
      };
    }}
    style="margin-bottom: 1.5rem;"
  >
    <button
      type="submit"
      disabled={submitting || data.inProgress}
      style="font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; padding: 8px 16px; background: var(--accent); color: #fff; border: none; cursor: pointer;"
    >
      {data.inProgress ? 'Generating…' : submitting ? 'Starting…' : 'Regenerate all'}
    </button>
    {#if data.inProgress}
      <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: 10px;">
        A regeneration is currently running — reload to refresh status.
      </span>
    {/if}
  </form>

  {#if data.rows.length === 0}
    <p style="color: var(--text-muted); font-size: 14px;">
      No entries yet. The scheduler generates the initial set ~30s after server start,
      or use the button above.
    </p>
  {:else}
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--card-border);">
          <th style="padding: 6px 8px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted);">HR / Steps / Temp</th>
          <th style="padding: 6px 8px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted);">Headline</th>
          <th style="padding: 6px 8px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted);">Strap template</th>
        </tr>
      </thead>
      <tbody>
        {#each data.rows as row (row.id)}
          <tr style="border-bottom: 1px solid var(--divider);">
            <td style="padding: 6px 8px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); white-space: nowrap;">
              {row.hrCentroid} / {row.stepsCentroid.toLocaleString('en-GB')} / {row.tempCentroid}°
            </td>
            <td style="padding: 6px 8px; font-weight: 600; color: var(--text-primary); white-space: nowrap;">
              {row.primary} <span style="color: var(--text-ghost);">{row.ghost}</span>
            </td>
            <td style="padding: 6px 8px; color: var(--text-secondary);">{row.strapTemplate}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</PageWrap>
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run check 2>&1 | grep -E "admin/hero" || echo "no admin/hero errors"`
Expected: `no admin/hero errors`.

- [ ] **Step 4: Visual check in the browser**

Run: `npm run dev`
Open: `http://homeserv:5173/admin/hero`
Verify: the page renders with the header and (if the table is populated) the entry table; clicking "Regenerate all" disables the button and a reload eventually shows 150 entries with a fresh "last generated" time. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/hero/+page.server.ts src/routes/admin/hero/+page.svelte
git commit -m "feat(admin): hero-titles regeneration + browse page"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — including the new `hero-titles-buckets.test.ts` and `hero-titles-service.test.ts`. No regressions.

- [ ] **Step 2: Run the type check**

Run: `npm run check`
Expected: 0 errors. (Pre-existing warnings unrelated to this change are acceptable; no new errors in `src/lib/landing/`, `src/lib/components/landing/`, `src/lib/components/shared/`, `src/routes/+page.*`, `src/routes/admin/hero/`, or `src/hooks.server.ts`.)

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build completes with no errors. If it fails on stale output, run `rm -rf .svelte-kit/output && npm run build`.

- [ ] **Step 4: End-to-end check against a fresh dev server**

Run: `npm run dev`
Then verify, on `http://homeserv:5173`:
- The hero renders a headline + strap (from a generated row, or the fallback if the table is still empty).
- The strap's numbers match the mono vitals line and the live data.
- Toggling the background switches ECG ⇄ biome and the choice survives a reload.
- `/health` still renders its hero with the ECG variant (the moved component).
- `/admin/hero` lists entries and the regenerate button works.

Stop the dev server when done.

- [ ] **Step 5: Commit any verification fixes**

If Steps 1-4 surfaced fixes, commit them:

```bash
git add -A
git commit -m "fix(landing): address verification findings for hero redesign"
```

If nothing needed fixing, skip this step.

---

## Task 12: Deploy

**Files:** none (deployment)

- [ ] **Step 1: Push the branch**

```bash
git push
```

- [ ] **Step 2: Run the deploy script**

Run: `~/strange_rambling_svelte/scripts/deploy.sh`
Expected: deploy completes. The `hero_titles` table must exist in the production database — if `drizzle-kit push` (Task 1) was run against dev only, run it against production per the project's schema-deploy process.

- [ ] **Step 3: Verify the change is live**

Run: `curl -s https://strangeramblings.com | grep -o 'lh-head' | head -1`
Expected: `lh-head` — confirming the new hero component is server-rendered.

Open `https://strangeramblings.com` in a browser and confirm the hero renders correctly. On first deploy the table is empty, so the fallback copy shows until the scheduler completes the initial generation (~minutes after server start); reload after a few minutes to see LLM copy.

- [ ] **Step 4: Final commit if needed**

Deployment makes no code changes; nothing to commit unless Step 2/3 surfaced an issue.

---

## Self-Review Notes

- **Spec coverage:** Hero layout (Task 7, 9), ECG-default + toggle (Tasks 5, 6, 9), `hero_titles` table (Task 1), 5×5×6 grid + snapping (Task 2), strap number-slots (Tasks 2, 3), generation service + validation (Task 3), in-memory cache + fallback (Task 3), weekly cron (Task 4), admin page (Task 10), below-hero reconciliation (Task 9 Step 4), error handling (fallback paths in Task 3), testing (Tasks 2, 3, 11) — all covered.
- **Type consistency:** `HeroTitleCopy` (`primary`/`ghost`/`strapTemplate`), `HeroTitle` (`primary`/`ghost`/`strap`), `SnapInput` (`hr`/`steps`/`temp`/`condition`), `GridPoint`, `BucketKey`, and `LLMGenFn` are defined once in Tasks 2-3 and used consistently through Tasks 8-10.
- **Note:** Component behaviour (Svelte files) is verified by browser checks rather than unit tests — the repo has no component test harness. Pure logic (buckets, validation) is fully unit-tested.
