# Hero Tagline Batch Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `/admin/hero` so the admin can influence generation style, control headline/strap length, generate multiple variants per bucket in batches of 50, and preview before saving.

**Architecture:** Keep the 150-bucket vitals grid. Generation produces `150 × variants` units, chunked into LLM calls of 50. The admin page drives the loop one batch at a time against a `generate` endpoint, accumulates a preview, then commits via a `save` endpoint in `replace` or `append` mode. The landing page picks a random variant per bucket.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Drizzle ORM + PostgreSQL, Vitest, the project LLM gateway (`$lib/jkai/llm-client`).

**Spec:** `docs/superpowers/specs/2026-05-22-hero-tagline-batch-generation-design.md`

**Test command:** `npm test` (runs `vitest run`). Type check: `npm run check`.

---

### Task 1: Schema — allow variants, add style column

**Files:**
- Modify: `src/lib/db/schema.ts:350-372`

- [ ] **Step 1: Replace the `heroTitles` table definition**

Replace the whole block at `src/lib/db/schema.ts:350-372` (the `export const heroTitles = pgTable(...)` statement) with:

```ts
export const heroTitles = pgTable('hero_titles', {
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
  style: text('style'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow(),
});
```

This drops the unique index on `(hr_bucket, steps_bucket, temp_bucket)` so a bucket can hold multiple variant rows, and adds a nullable `style` column. Leave the `uniqueIndex` import alone — other tables still use it.

- [ ] **Step 2: Push the schema change**

Run: `npx drizzle-kit push`
Expected: drizzle reports dropping index `hero_titles_bucket_unique` and adding column `style`. If prompted about the `style` column, choose **create column** (it is new, not a rename). Existing rows are preserved.

- [ ] **Step 3: Type check**

Run: `npm run check`
Expected: no errors from `schema.ts`. (Errors elsewhere referencing old `hero-titles-service` exports are expected until later tasks — note them and continue.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "Allow multiple hero_titles variants per bucket"
```

---

### Task 2: Add `enumerateUnits` to the buckets module

**Files:**
- Modify: `src/lib/landing/hero-titles-buckets.ts` (append after `enumerateGrid`, around line 101)
- Test: `src/lib/landing/hero-titles-buckets.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/landing/hero-titles-buckets.test.ts`, add `enumerateUnits` to the import list at the top:

```ts
import {
  snapBucket,
  snapToBuckets,
  enumerateGrid,
  enumerateUnits,
  fillStrap,
  HR_BUCKETS,
  STEPS_BUCKETS,
  TEMP_BUCKETS,
} from './hero-titles-buckets';
```

Then add this `describe` block after the existing `enumerateGrid` block (before `describe('fillStrap', ...)`):

```ts
describe('enumerateUnits', () => {
  it('repeats the 150-point grid once per variant', () => {
    expect(enumerateUnits(1)).toHaveLength(150);
    expect(enumerateUnits(3)).toHaveLength(450);
  });
  it('returns an empty list for zero variants', () => {
    expect(enumerateUnits(0)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- hero-titles-buckets`
Expected: FAIL — `enumerateUnits is not a function` / import error.

- [ ] **Step 3: Implement `enumerateUnits`**

In `src/lib/landing/hero-titles-buckets.ts`, add this function immediately after `enumerateGrid` (after line 101):

```ts
/**
 * The full unit list for a generation run: the 150-point grid repeated once
 * per variant. A run with `variantsPerBucket = 3` yields 450 units.
 */
export function enumerateUnits(variantsPerBucket: number): GridPoint[] {
  const grid = enumerateGrid();
  const out: GridPoint[] = [];
  for (let v = 0; v < variantsPerBucket; v++) {
    out.push(...grid);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- hero-titles-buckets`
Expected: PASS — all `hero-titles-buckets` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/hero-titles-buckets.ts src/lib/landing/hero-titles-buckets.test.ts
git commit -m "Add enumerateUnits — grid repeated per variant"
```

---

### Task 3: Rewrite the hero-titles service for batch generation

**Files:**
- Modify (full rewrite): `src/lib/landing/hero-titles-service.ts`
- Modify (full rewrite): `src/lib/landing/hero-titles-service.test.ts`

This task replaces the whole service: parameterised validation, batch prompt + parsing, `generateBatch`, save modes, random variant snapping, and a `runFullGeneration` for the scheduler. The old single-point generation (`callLLM`, `buildPrompt`, `upsertRow`, `loadExistingKeys`, `generateHeroTitles`, `isGenerationInProgress`, `LLMGenFn`) is removed.

- [ ] **Step 1: Write the new test file**

Replace the entire contents of `src/lib/landing/hero-titles-service.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  checkCopy,
  validateGenerated,
  parseBatchResponse,
  generateBatch,
  pickVariant,
  type GenParams,
} from './hero-titles-service';
import { enumerateGrid } from './hero-titles-buckets';

const LIMITS = { headlineWords: 3, strapWords: 22 };
const PARAMS: GenParams = { style: '', headlineWords: 3, strapWords: 22 };

describe('validateGenerated', () => {
  const good = {
    primary: 'still.',
    ghost: 'but plotting.',
    strap: '{bpm} beats, {steps} steps, {temp} of {sky} London.',
  };

  it('accepts a well-formed entry and upper-cases the headline', () => {
    const r = validateGenerated(good, LIMITS);
    expect(r).not.toBeNull();
    expect(r!.primary).toBe('STILL.');
    expect(r!.ghost).toBe('BUT PLOTTING.');
    expect(r!.strapTemplate).toBe(good.strap);
  });

  it('rejects a missing field', () => {
    expect(validateGenerated({ primary: 'A.', ghost: 'B.' }, LIMITS)).toBeNull();
  });

  it('rejects digits in the headline', () => {
    expect(validateGenerated({ ...good, primary: '62 BPM.' }, LIMITS)).toBeNull();
  });

  it('rejects digits in the strap', () => {
    expect(
      validateGenerated({ ...good, strap: '62 beats and {bpm} more.' }, LIMITS),
    ).toBeNull();
  });

  it('rejects a strap with no {bpm} token', () => {
    expect(
      validateGenerated({ ...good, strap: 'a quiet morning of {sky}.' }, LIMITS),
    ).toBeNull();
  });

  it('rejects a headline with more words than the limit', () => {
    expect(
      validateGenerated({ ...good, primary: 'one two three four.' }, LIMITS),
    ).toBeNull();
  });

  it('accepts a longer headline when the limit allows it', () => {
    const r = validateGenerated(
      { ...good, primary: 'one two three four.' },
      { headlineWords: 6, strapWords: 22 },
    );
    expect(r).not.toBeNull();
  });

  it('rejects a strap with more words than the limit', () => {
    const longStrap = '{bpm} ' + Array(30).fill('word').join(' ');
    expect(validateGenerated({ ...good, strap: longStrap }, LIMITS)).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(validateGenerated('nope', LIMITS)).toBeNull();
    expect(validateGenerated(null, LIMITS)).toBeNull();
  });
});

describe('checkCopy', () => {
  it('rejects an absurdly long single-word headline via the char ceiling', () => {
    expect(
      checkCopy('A'.repeat(70) + '.', 'OK.', '{bpm} and {sky}.', LIMITS),
    ).toBeNull();
  });
});

describe('parseBatchResponse', () => {
  const units = enumerateGrid().slice(0, 3);

  it('maps a full array of valid objects to rows', () => {
    const text = JSON.stringify(
      units.map(() => ({
        primary: 'still.',
        ghost: 'but here.',
        strap: '{bpm} beats, {steps} steps of {sky}.',
      })),
    );
    const rows = parseBatchResponse(text, units, PARAMS);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.failed)).toBe(true);
    expect(rows[0].primary).toBe('STILL.');
  });

  it('fills missing entries with flagged fallback copy', () => {
    const text = JSON.stringify([
      { primary: 'still.', ghost: 'but here.', strap: '{bpm} beats of {sky}.' },
    ]);
    const rows = parseBatchResponse(text, units, PARAMS);
    expect(rows).toHaveLength(3);
    expect(rows[0].failed).toBe(false);
    expect(rows[1].failed).toBe(true);
    expect(rows[2].failed).toBe(true);
  });

  it('returns all-fallback rows for unparseable text', () => {
    const rows = parseBatchResponse('not json at all', units, PARAMS);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.failed)).toBe(true);
  });

  it('extracts a JSON array embedded in surrounding prose', () => {
    const text =
      'Here you go:\n[{"primary":"lit.","ghost":"go.","strap":"{bpm} and {sky}."}]';
    const rows = parseBatchResponse(text, units.slice(0, 1), PARAMS);
    expect(rows[0].failed).toBe(false);
    expect(rows[0].primary).toBe('LIT.');
  });

  it('records the style on each row', () => {
    const rows = parseBatchResponse('garbage', units, { ...PARAMS, style: 'noir' });
    expect(rows[0].style).toBe('noir');
  });
});

describe('generateBatch', () => {
  const units = enumerateGrid().slice(0, 2);

  it('retries up to three times then returns fallback rows', async () => {
    let calls = 0;
    const rows = await generateBatch(units, PARAMS, async () => {
      calls++;
      return null;
    });
    expect(calls).toBe(3);
    expect(rows.every((r) => r.failed)).toBe(true);
  });

  it('uses the first successful response', async () => {
    let calls = 0;
    const rows = await generateBatch(units, PARAMS, async () => {
      calls++;
      if (calls < 2) return null;
      return JSON.stringify(
        units.map(() => ({
          primary: 'lit up.',
          ghost: "don't stop.",
          strap: '{bpm} beats and {sky}.',
        })),
      );
    });
    expect(calls).toBe(2);
    expect(rows.every((r) => !r.failed)).toBe(true);
    expect(rows[0].primary).toBe('LIT UP.');
  });
});

describe('pickVariant', () => {
  const mk = (id: number, hr: number, steps: number, temp: number) =>
    ({ id, hrBucket: hr, stepsBucket: steps, tempBucket: temp }) as never;

  it('returns a row matching the bucket key', () => {
    const rows = [mk(1, 0, 0, 0), mk(2, 1, 1, 1), mk(3, 0, 0, 0)];
    const picked = pickVariant(rows, { hrBucket: 0, stepsBucket: 0, tempBucket: 0 });
    expect(picked).not.toBeNull();
    expect([1, 3]).toContain(picked!.id);
  });

  it('returns null when no row matches', () => {
    const rows = [mk(1, 0, 0, 0)];
    expect(
      pickVariant(rows, { hrBucket: 4, stepsBucket: 4, tempBucket: 5 }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- hero-titles-service`
Expected: FAIL — imports `checkCopy`, `parseBatchResponse`, `generateBatch`, `pickVariant` do not exist yet.

- [ ] **Step 3: Rewrite the service file**

Replace the entire contents of `src/lib/landing/hero-titles-service.ts` with:

```ts
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import {
  enumerateUnits,
  snapToBuckets,
  type BucketKey,
  type GridPoint,
} from './hero-titles-buckets';

export interface HeroTitleCopy {
  primary: string;
  ghost: string;
  strapTemplate: string;
}

export interface LengthLimits {
  headlineWords: number;
  strapWords: number;
}

export interface GenParams {
  style: string;
  headlineWords: number;
  strapWords: number;
}

export interface GeneratedRow {
  hrBucket: number;
  stepsBucket: number;
  tempBucket: number;
  hrCentroid: number;
  stepsCentroid: number;
  tempCentroid: number;
  primary: string;
  ghost: string;
  strapTemplate: string;
  style: string | null;
  failed: boolean;
}

export const BATCH_SIZE = 50;
const BATCH_TIMEOUT_MS = 180_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const HEADLINE_CHAR_CEIL = 60;
const STRAP_CHAR_CEIL = 400;
const SAVE_LIMITS: LengthLimits = { headlineWords: 12, strapWords: 60 };
const DEFAULT_PARAMS: GenParams = { style: '', headlineWords: 3, strapWords: 22 };

/** Deterministic fallback, one entry per HR bucket index (0-4). */
const FALLBACK: HeroTitleCopy[] = [
  {
    primary: 'STILL.',
    ghost: 'FOR NOW.',
    strapTemplate:
      '{bpm} beats, {steps} steps, {temp} of {sky}. The day has not been agreed to yet.',
  },
  {
    primary: 'IDLING.',
    ghost: 'BUT HERE.',
    strapTemplate:
      '{bpm} beats, {steps} steps, {temp} and {sky}. Ticking over, nothing forced.',
  },
  {
    primary: 'WARMING UP.',
    ghost: 'KEEP GOING.',
    strapTemplate:
      '{bpm} beats, {steps} steps, {temp} of {sky}. The body is paying attention now.',
  },
  {
    primary: 'PUSHING.',
    ghost: "DON'T STOP.",
    strapTemplate:
      '{bpm} beats, {steps} steps, {temp} and {sky}. Well into the effort.',
  },
  {
    primary: 'FLAT OUT.',
    ghost: 'ALL IN.',
    strapTemplate:
      '{bpm} beats, {steps} steps, {temp} of {sky}. Nothing held in reserve.',
  },
];

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Core rule check on already-extracted, trimmed strings. */
export function checkCopy(
  primary: string,
  ghost: string,
  strap: string,
  limits: LengthLimits,
): HeroTitleCopy | null {
  if (!primary || !ghost || !strap) return null;
  if (wordCount(primary) > limits.headlineWords) return null;
  if (wordCount(ghost) > limits.headlineWords) return null;
  if (wordCount(strap) > limits.strapWords) return null;
  if (primary.length > HEADLINE_CHAR_CEIL || ghost.length > HEADLINE_CHAR_CEIL) {
    return null;
  }
  if (strap.length > STRAP_CHAR_CEIL) return null;
  if (/\d/.test(primary) || /\d/.test(ghost) || /\d/.test(strap)) return null;
  if (!strap.includes('{bpm}')) return null;
  return {
    primary: primary.toUpperCase(),
    ghost: ghost.toUpperCase(),
    strapTemplate: strap,
  };
}

/** Validate a raw LLM-generated entry. Returns null if it fails any rule. */
export function validateGenerated(
  parsed: unknown,
  limits: LengthLimits,
): HeroTitleCopy | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const primary = typeof o.primary === 'string' ? o.primary.trim() : '';
  const ghost = typeof o.ghost === 'string' ? o.ghost.trim() : '';
  const strap = typeof o.strap === 'string' ? o.strap.trim() : '';
  return checkCopy(primary, ghost, strap, limits);
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
}

/** Pick one row at random from those matching the bucket key. */
export function pickVariant(rows: Row[], key: BucketKey): Row | null {
  const matches = rows.filter(
    (r) =>
      r.hrBucket === key.hrBucket &&
      r.stepsBucket === key.stepsBucket &&
      r.tempBucket === key.tempBucket,
  );
  if (matches.length === 0) return null;
  return matches[Math.floor(Math.random() * matches.length)];
}

export async function snapHeroTitle(input: SnapInput): Promise<HeroTitleCopy> {
  const key = snapToBuckets(input.hr, input.steps, input.temp);
  try {
    const rows = await loadRows();
    const row = pickVariant(rows, key);
    if (row) {
      return {
        primary: row.primary,
        ghost: row.ghost,
        strapTemplate: row.strapTemplate,
      };
    }
  } catch (err) {
    console.warn(
      '[hero-titles] snap fell back:',
      err instanceof Error ? err.message : err,
    );
  }
  return FALLBACK[key.hrBucket];
}

// ---------------------------------------------------------------------------
// Batch prompt + parsing.
// ---------------------------------------------------------------------------

function buildBatchPrompt(
  units: GridPoint[],
  params: GenParams,
): { system: string; user: string } {
  const styleLine = params.style.trim()
    ? `Style direction from the site owner — follow it closely, it overrides the default tone: ${params.style.trim()}`
    : 'No extra style direction; use the default voice described above.';
  const system = [
    'You write the hero copy for the landing page of a personal website.',
    "The page shows the owner's live vitals; your copy is the first thing a visitor reads.",
    'Default tone: dry, witty, snappy, lightly provocative. Never cheerful, never preachy.',
    styleLine,
    'You will be given a numbered list of states. Return a JSON array with one',
    'object per state, in the same order. Each object: {"primary":"...","ghost":"...","strap":"..."}.',
    'Output strict JSON only — a single array. No code fences, no commentary.',
    `primary: up to ${params.headlineWords} word(s), ALL CAPS, ends with a full stop. Names the state.`,
    `ghost: up to ${params.headlineWords} word(s), ALL CAPS, ends with a full stop. The turn or the punchline.`,
    `strap: one sentence, ${params.strapWords} words maximum, same mood as the headline.`,
    'NUMBERS: never write digits anywhere. primary and ghost contain no numbers at all.',
    'In the strap, refer to live figures ONLY through these tokens: {bpm} {steps} {temp} {sky}.',
    'The strap MUST contain {bpm} and at least one other token.',
    'Make the entries varied — avoid repeating words or sentence shapes across the list.',
    'Voice examples (shape only — do not copy, let the style direction set the tone):',
    '  {"primary":"STILL.","ghost":"BUT PLOTTING.","strap":"{bpm} beats, {steps} steps, {temp} of {sky} London — the day has not been agreed to yet."}',
    '  {"primary":"LIT UP.","ghost":"DON\'T STOP.","strap":"{bpm} beats and climbing, {steps} steps deep, {temp} and {sky}: this is the good part."}',
  ].join('\n');
  const lines = units.map(
    (p, i) =>
      `${i + 1}. heart rate ${p.hrState} (~${p.hrCentroid} bpm); activity ${p.stepsState} (~${p.stepsCentroid.toLocaleString('en-GB')} steps); temperature ${p.tempState} (~${p.tempCentroid}°C)`,
  );
  const user = [
    `Write hero copy for these ${units.length} states. Return a JSON array of exactly ${units.length} objects, in order.`,
    '',
    ...lines,
    '',
    'Return only the JSON array.',
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
    /* fall through to bracket extraction */
  }
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      /* give up */
    }
  }
  return null;
}

function buildRow(
  p: GridPoint,
  copy: HeroTitleCopy,
  style: string,
  failed: boolean,
): GeneratedRow {
  return {
    hrBucket: p.hrBucket,
    stepsBucket: p.stepsBucket,
    tempBucket: p.tempBucket,
    hrCentroid: p.hrCentroid,
    stepsCentroid: p.stepsCentroid,
    tempCentroid: p.tempCentroid,
    primary: copy.primary,
    ghost: copy.ghost,
    strapTemplate: copy.strapTemplate,
    style: style.trim() || null,
    failed,
  };
}

/**
 * Map a raw LLM batch response onto its units. Always returns one row per
 * unit; a unit whose object is missing or invalid gets flagged fallback copy.
 */
export function parseBatchResponse(
  text: string,
  units: GridPoint[],
  params: GenParams,
): GeneratedRow[] {
  const limits: LengthLimits = {
    headlineWords: params.headlineWords,
    strapWords: params.strapWords,
  };
  const parsed = tryParseJson(text);
  const arr: unknown[] = Array.isArray(parsed) ? parsed : [];
  return units.map((p, i) => {
    const valid = validateGenerated(arr[i], limits);
    if (valid) return buildRow(p, valid, params.style, false);
    return buildRow(p, FALLBACK[p.hrBucket], params.style, true);
  });
}

// ---------------------------------------------------------------------------
// LLM batch call.
// ---------------------------------------------------------------------------

export type BatchLLMFn = (
  prompt: { system: string; user: string },
  unitCount: number,
) => Promise<string | null>;

async function callBatchLLM(
  prompt: { system: string; user: string },
  unitCount: number,
): Promise<string | null> {
  const ctx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(ctx);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0.9,
        // Sized to the batch — ~260 tokens per entry plus headroom, capped.
        max_tokens: Math.min(16000, 400 + unitCount * 260),
        // Disable GLM's extended reasoning — these prompts need JSON, not a
        // chain of thought. `thinking` is a z.ai-specific param.
        // @ts-expect-error -- z.ai extension, absent from the OpenAI types
        thinking: { type: 'disabled' },
      },
      { signal: controller.signal },
    );
    const text = completion.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text) {
      console.warn(
        '[hero-titles] empty batch response, finish:',
        completion.choices?.[0]?.finish_reason,
      );
      return null;
    }
    return text;
  } catch (e) {
    console.warn('[hero-titles] batch LLM call failed', e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate copy for one batch of units (≤ BATCH_SIZE). Retries the whole call
 * up to 3× on failure; after that, every unit gets flagged fallback copy.
 */
export async function generateBatch(
  units: GridPoint[],
  params: GenParams,
  llmCall: BatchLLMFn = callBatchLLM,
): Promise<GeneratedRow[]> {
  const prompt = buildBatchPrompt(units, params);
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await llmCall(prompt, units.length);
    if (text) return parseBatchResponse(text, units, params);
  }
  return units.map((p) => buildRow(p, FALLBACK[p.hrBucket], params.style, true));
}

// ---------------------------------------------------------------------------
// Persistence.
// ---------------------------------------------------------------------------

function prepareRowsForSave(
  rows: unknown[],
): (typeof heroTitles.$inferInsert)[] {
  const num = (v: unknown): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('row has an invalid numeric field');
    return n;
  };
  return rows.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('invalid row');
    const r = raw as Record<string, unknown>;
    const copy = checkCopy(
      String(r.primary ?? '').trim(),
      String(r.ghost ?? '').trim(),
      String(r.strapTemplate ?? '').trim(),
      SAVE_LIMITS,
    );
    if (!copy) throw new Error('row failed validation');
    return {
      hrBucket: num(r.hrBucket),
      stepsBucket: num(r.stepsBucket),
      tempBucket: num(r.tempBucket),
      hrCentroid: num(r.hrCentroid),
      stepsCentroid: num(r.stepsCentroid),
      tempCentroid: num(r.tempCentroid),
      primary: copy.primary,
      ghost: copy.ghost,
      strapTemplate: copy.strapTemplate,
      style:
        typeof r.style === 'string' && r.style.trim() ? r.style.trim() : null,
      generatedAt: new Date(),
    };
  });
}

export async function heroTitlesCount(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(heroTitles);
  return r?.n ?? 0;
}

/**
 * Persist a generated set. `replace` clears the pool first; `append` adds to
 * it. Every row is re-validated server-side before insert.
 */
export async function saveHeroTitles(
  rows: unknown[],
  mode: 'replace' | 'append',
): Promise<number> {
  const prepared = prepareRowsForSave(rows);
  await db.transaction(async (tx) => {
    if (mode === 'replace') await tx.delete(heroTitles);
    if (prepared.length > 0) await tx.insert(heroTitles).values(prepared);
  });
  invalidateHeroTitlesCache();
  return heroTitlesCount();
}

// ---------------------------------------------------------------------------
// Full run — used by the scheduler and the startup top-up.
// ---------------------------------------------------------------------------

let generationInProgress = false;

/**
 * Generate one variant for every bucket and save it in `replace` mode. No-op
 * if a run is already in progress.
 */
export async function runFullGeneration(
  params: GenParams = DEFAULT_PARAMS,
  llmCall: BatchLLMFn = callBatchLLM,
): Promise<{ ok: number; failed: number }> {
  if (generationInProgress) return { ok: 0, failed: 0 };
  generationInProgress = true;
  try {
    const units = enumerateUnits(1);
    const all: GeneratedRow[] = [];
    for (let i = 0; i < units.length; i += BATCH_SIZE) {
      const slice = units.slice(i, i + BATCH_SIZE);
      all.push(...(await generateBatch(slice, params, llmCall)));
    }
    await saveHeroTitles(all, 'replace');
    const ok = all.filter((r) => !r.failed).length;
    return { ok, failed: all.length - ok };
  } finally {
    generationInProgress = false;
    invalidateHeroTitlesCache();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- hero-titles-service`
Expected: PASS — all `hero-titles-service` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/hero-titles-service.ts src/lib/landing/hero-titles-service.test.ts
git commit -m "Rewrite hero-titles service for batched, style-aware generation"
```

---

### Task 4: Point the scheduler at `runFullGeneration`

**Files:**
- Modify (full rewrite): `src/lib/landing/hero-titles-scheduler.ts`

- [ ] **Step 1: Rewrite the scheduler**

Replace the entire contents of `src/lib/landing/hero-titles-scheduler.ts` with:

```ts
import { runFullGeneration, heroTitlesCount } from './hero-titles-service';
import { enumerateGrid } from './hero-titles-buckets';

let interval: ReturnType<typeof setInterval> | undefined;
let startTimeout: ReturnType<typeof setTimeout> | undefined;
let running = false;

const DEFAULT_MS = 7 * 24 * 60 * 60 * 1000; // weekly

export function startHeroTitlesScheduler(): void {
  if (running) return;
  running = true;

  // Guard against a bad env value — a NaN interval would make setInterval
  // fire as fast as possible, hammering the LLM in a loop.
  const raw = parseInt(process.env.HERO_TITLES_REGEN_MS || '', 10);
  const ms = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MS;
  console.log(`[hero-titles] regeneration every ${Math.round(ms / 3_600_000)}h`);

  // Let the app finish booting, then generate if the pool is incomplete —
  // a cold-start empty table, or a partial set left by a deploy that
  // restarted the service mid-generation. A populated pool waits.
  startTimeout = setTimeout(async () => {
    startTimeout = undefined;
    try {
      const count = await heroTitlesCount();
      const expected = enumerateGrid().length;
      if (count < expected) {
        console.log(
          `[hero-titles] pool incomplete (${count}/${expected}) — generating`,
        );
        const res = await runFullGeneration();
        console.log('[hero-titles] startup generation done', res);
      }
    } catch (e) {
      console.error('[hero-titles] startup check failed', e);
    }
    interval = setInterval(() => {
      runFullGeneration()
        .then((res) =>
          console.log('[hero-titles] scheduled regeneration done', res),
        )
        .catch((e) =>
          console.error('[hero-titles] scheduled regeneration failed', e),
        );
    }, ms);
  }, 30_000);
}

export function stopHeroTitlesScheduler(): void {
  if (startTimeout) clearTimeout(startTimeout);
  startTimeout = undefined;
  if (interval) clearInterval(interval);
  interval = undefined;
  running = false;
}
```

- [ ] **Step 2: Type check**

Run: `npm run check`
Expected: no errors in `hero-titles-scheduler.ts`. (The admin route still references removed exports — fixed in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/landing/hero-titles-scheduler.ts
git commit -m "Drive hero-titles scheduler via runFullGeneration"
```

---

### Task 5: Add the generate / save / delete endpoints

**Files:**
- Create: `src/routes/admin/hero/generate/+server.ts`
- Create: `src/routes/admin/hero/save/+server.ts`
- Create: `src/routes/admin/hero/delete/+server.ts`

These are child routes of `/admin/hero`, so the central auth handle in `hooks.server.ts` guards them automatically.

- [ ] **Step 1: Create the generate endpoint**

Create `src/routes/admin/hero/generate/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { enumerateUnits } from '$lib/landing/hero-titles-buckets';
import { generateBatch, BATCH_SIZE } from '$lib/landing/hero-titles-service';

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid body');
  const b = body as Record<string, unknown>;

  const variantsPerBucket = clampInt(b.variantsPerBucket, 1, 5, 1);
  const headlineWords = clampInt(b.headlineWords, 1, 6, 3);
  const strapWords = clampInt(b.strapWords, 10, 40, 22);
  const style = typeof b.style === 'string' ? b.style.slice(0, 2000) : '';
  const batchIndex = clampInt(b.batchIndex, 0, 999, 0);

  const units = enumerateUnits(variantsPerBucket);
  const totalBatches = Math.ceil(units.length / BATCH_SIZE);
  if (batchIndex >= totalBatches) throw error(400, 'batchIndex out of range');

  const slice = units.slice(
    batchIndex * BATCH_SIZE,
    batchIndex * BATCH_SIZE + BATCH_SIZE,
  );
  const rows = await generateBatch(slice, { style, headlineWords, strapWords });

  return json({ totalBatches, batchIndex, rows });
};
```

- [ ] **Step 2: Create the save endpoint**

Create `src/routes/admin/hero/save/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { saveHeroTitles } from '$lib/landing/hero-titles-service';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid body');
  const b = body as Record<string, unknown>;

  const mode = b.mode === 'append' ? 'append' : 'replace';
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length === 0) throw error(400, 'No rows to save');

  try {
    const count = await saveHeroTitles(rows, mode);
    return json({ ok: true, count });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'Save failed');
  }
};
```

- [ ] **Step 3: Create the delete endpoint**

Create `src/routes/admin/hero/delete/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import { invalidateHeroTitlesCache } from '$lib/landing/hero-titles-service';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid body');
  const b = body as Record<string, unknown>;

  if (b.all === true) {
    await db.delete(heroTitles);
  } else {
    const id = Math.round(Number(b.id));
    if (!Number.isInteger(id)) throw error(400, 'Invalid id');
    await db.delete(heroTitles).where(eq(heroTitles.id, id));
  }
  invalidateHeroTitlesCache();
  return json({ ok: true });
};
```

- [ ] **Step 4: Type check**

Run: `npm run check`
Expected: no errors in the three new `+server.ts` files.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/hero/generate/+server.ts src/routes/admin/hero/save/+server.ts src/routes/admin/hero/delete/+server.ts
git commit -m "Add hero generate/save/delete endpoints"
```

---

### Task 6: Rewrite the `/admin/hero` page

**Files:**
- Modify (full rewrite): `src/routes/admin/hero/+page.server.ts`
- Modify (full rewrite): `src/routes/admin/hero/+page.svelte`

- [ ] **Step 1: Rewrite the page load**

Replace the entire contents of `src/routes/admin/hero/+page.server.ts` with:

```ts
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select()
    .from(heroTitles)
    .orderBy(
      heroTitles.hrBucket,
      heroTitles.stepsBucket,
      heroTitles.tempBucket,
      heroTitles.id,
    );

  const generatedAt = rows.reduce<string | null>((latest, r) => {
    const t = r.generatedAt ? new Date(r.generatedAt).toISOString() : null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);

  return { rows, count: rows.length, generatedAt };
};
```

- [ ] **Step 2: Rewrite the page component**

Replace the entire contents of `src/routes/admin/hero/+page.svelte` with:

```svelte
<svelte:head><title>Hero Titles — Admin</title></svelte:head>

<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';
  import type { GeneratedRow } from '$lib/landing/hero-titles-service';

  let { data }: { data: PageData } = $props();

  let style = $state('');
  let headlineWords = $state(3);
  let strapWords = $state(22);
  let variantsPerBucket = $state(1);

  let phase = $state<'idle' | 'generating' | 'preview'>('idle');
  let progress = $state({ done: 0, total: 0 });
  let preview = $state<GeneratedRow[]>([]);
  let saveMode = $state<'replace' | 'append'>('replace');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const LS_KEY = 'admin-hero-settings';
  const plannedBatches = $derived(Math.ceil((150 * variantsPerBucket) / 50));
  const failedCount = $derived(preview.filter((r) => r.failed).length);

  onMount(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.style === 'string') style = s.style;
        if (typeof s.headlineWords === 'number') headlineWords = s.headlineWords;
        if (typeof s.strapWords === 'number') strapWords = s.strapWords;
        if (typeof s.variantsPerBucket === 'number')
          variantsPerBucket = s.variantsPerBucket;
      }
    } catch {
      /* ignore corrupt localStorage */
    }
  });

  function persistSettings() {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ style, headlineWords, strapWords, variantsPerBucket }),
      );
    } catch {
      /* ignore */
    }
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return 'never';
    return new Date(iso).toLocaleString('en-GB');
  }

  async function generate() {
    error = null;
    preview = [];
    phase = 'generating';
    progress = { done: 0, total: plannedBatches };
    persistSettings();
    const params = { style, headlineWords, strapWords, variantsPerBucket };
    try {
      let batchIndex = 0;
      let totalBatches = 1;
      do {
        const res = await fetch('/admin/hero/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...params, batchIndex }),
        });
        if (!res.ok)
          throw new Error(`Batch ${batchIndex + 1} failed (${res.status})`);
        const payload = await res.json();
        totalBatches = payload.totalBatches;
        preview = [...preview, ...payload.rows];
        batchIndex += 1;
        progress = { done: batchIndex, total: totalBatches };
      } while (batchIndex < totalBatches);
      phase = 'preview';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Generation failed';
      phase = 'idle';
      preview = [];
    }
  }

  async function save() {
    busy = true;
    error = null;
    try {
      const res = await fetch('/admin/hero/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: saveMode, rows: preview }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Save failed (${res.status})`);
      }
      preview = [];
      phase = 'idle';
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Save failed';
    } finally {
      busy = false;
    }
  }

  function discard() {
    preview = [];
    phase = 'idle';
    error = null;
  }

  async function deleteRow(id: number) {
    busy = true;
    error = null;
    try {
      const res = await fetch('/admin/hero/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Delete failed';
    } finally {
      busy = false;
    }
  }

  async function clearPool() {
    if (!confirm('Delete every saved hero entry? This cannot be undone.')) return;
    busy = true;
    error = null;
    try {
      const res = await fetch('/admin/hero/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error(`Clear failed (${res.status})`);
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Clear failed';
    } finally {
      busy = false;
    }
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Landing page"
    title="hero titles"
    sub="Generate the copy the landing hero snaps to. {data.count} entries saved; last generated {fmtDate(data.generatedAt)}."
  />

  {#if error}
    <div class="status-error">{error}</div>
  {/if}

  <section class="controls">
    <label class="ctl">
      <span class="ctl-label">Style influence</span>
      <textarea
        class="style-box"
        rows="3"
        placeholder="Tone, themes, references to steer the copy. Leave blank for the default voice."
        bind:value={style}
        disabled={phase === 'generating'}
      ></textarea>
    </label>

    <div class="ctl-row">
      <label class="ctl">
        <span class="ctl-label">
          Headline length — {headlineWords} word{headlineWords === 1 ? '' : 's'} max
        </span>
        <input
          type="range"
          min="1"
          max="6"
          step="1"
          bind:value={headlineWords}
          disabled={phase === 'generating'}
        />
      </label>
      <label class="ctl">
        <span class="ctl-label">Strap length — {strapWords} words max</span>
        <input
          type="range"
          min="10"
          max="40"
          step="1"
          bind:value={strapWords}
          disabled={phase === 'generating'}
        />
      </label>
      <label class="ctl ctl-narrow">
        <span class="ctl-label">Variants per bucket</span>
        <input
          type="number"
          min="1"
          max="5"
          step="1"
          bind:value={variantsPerBucket}
          disabled={phase === 'generating'}
        />
      </label>
    </div>

    <div class="ctl-actions">
      <button
        class="btn-primary"
        onclick={generate}
        disabled={phase === 'generating'}
      >
        {phase === 'generating'
          ? `Generating — batch ${progress.done}/${progress.total}…`
          : 'Generate preview'}
      </button>
      <span class="hint">
        {150 * variantsPerBucket} entries · {plannedBatches} batch{plannedBatches ===
        1
          ? ''
          : 'es'} of up to 50
      </span>
    </div>
  </section>

  {#if phase === 'preview'}
    <section class="panel">
      <div class="panel-bar">
        <span class="panel-title">
          Preview — {preview.length} entries{failedCount > 0
            ? `, ${failedCount} fell back`
            : ''}
        </span>
        <div class="save-controls">
          <label class="save-mode">
            <input
              type="radio"
              name="savemode"
              value="replace"
              bind:group={saveMode}
            />
            Replace pool
          </label>
          <label class="save-mode">
            <input
              type="radio"
              name="savemode"
              value="append"
              bind:group={saveMode}
            />
            Append to pool
          </label>
          <button class="btn-primary" onclick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button class="btn-ghost" onclick={discard} disabled={busy}>
            Discard
          </button>
        </div>
      </div>
      <table class="hero-table">
        <thead>
          <tr>
            <th>HR / Steps / Temp</th>
            <th>Headline</th>
            <th>Strap template</th>
          </tr>
        </thead>
        <tbody>
          {#each preview as row, i (i)}
            <tr class:row-failed={row.failed}>
              <td class="cell-meta">
                {row.hrCentroid} / {row.stepsCentroid.toLocaleString('en-GB')} /
                {row.tempCentroid}°
                {#if row.failed}<span class="flag">fallback</span>{/if}
              </td>
              <td class="cell-headline">
                {row.primary} <span class="ghost-text">{row.ghost}</span>
              </td>
              <td class="cell-strap">{row.strapTemplate}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {:else}
    <section class="panel">
      <div class="panel-bar">
        <span class="panel-title">Saved pool — {data.count} entries</span>
        {#if data.count > 0}
          <button class="btn-ghost" onclick={clearPool} disabled={busy}>
            Clear pool
          </button>
        {/if}
      </div>
      {#if data.rows.length === 0}
        <p class="empty-state">
          No entries yet. Generate a batch above to populate the pool.
        </p>
      {:else}
        <table class="hero-table">
          <thead>
            <tr>
              <th>HR / Steps / Temp</th>
              <th>Headline</th>
              <th>Strap template</th>
              <th>Style</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each data.rows as row (row.id)}
              <tr>
                <td class="cell-meta">
                  {row.hrCentroid} / {row.stepsCentroid.toLocaleString('en-GB')} /
                  {row.tempCentroid}°
                </td>
                <td class="cell-headline">
                  {row.primary} <span class="ghost-text">{row.ghost}</span>
                </td>
                <td class="cell-strap">{row.strapTemplate}</td>
                <td class="cell-style">{row.style ?? '—'}</td>
                <td class="cell-del">
                  <button
                    class="btn-del"
                    onclick={() => deleteRow(row.id)}
                    disabled={busy}
                    aria-label="Delete entry"
                  >
                    ×
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</PageWrap>

<style>
  .status-error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--status-error);
    margin-bottom: 1rem;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    margin-bottom: 2rem;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .ctl-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .style-box {
    width: 100%;
    resize: vertical;
    padding: 0.6rem 0.7rem;
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: 2px;
  }
  .ctl-row {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }
  .ctl-row .ctl {
    flex: 1;
    min-width: 200px;
  }
  .ctl-narrow {
    flex: 0 0 140px;
  }
  .ctl-narrow input {
    width: 70px;
    padding: 0.3rem 0.4rem;
    font-family: var(--font-mono);
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: 2px;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .ctl-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .hint {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
  }
  .btn-primary,
  .btn-ghost {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.5rem 1rem;
    border-radius: 2px;
    cursor: pointer;
  }
  .btn-primary {
    color: #fff;
    background: var(--accent);
    border: none;
  }
  .btn-ghost {
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--card-border);
  }
  .btn-primary:disabled,
  .btn-ghost:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .panel {
    margin-top: 1rem;
  }
  .panel-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .panel-title {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-secondary);
  }
  .save-controls {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
  }
  .save-mode {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .hero-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .hero-table thead tr {
    border-bottom: 2px solid var(--card-border);
    text-align: left;
  }
  .hero-table th {
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .hero-table tbody tr {
    border-bottom: 1px solid var(--divider);
  }
  .row-failed {
    background: color-mix(in srgb, var(--status-error) 8%, transparent);
  }
  .cell-meta {
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .flag {
    margin-left: 0.4rem;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--status-error);
  }
  .cell-headline {
    padding: 6px 8px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .ghost-text {
    color: var(--text-ghost);
  }
  .cell-strap {
    padding: 6px 8px;
    color: var(--text-secondary);
  }
  .cell-style {
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell-del {
    padding: 6px 8px;
    text-align: right;
  }
  .btn-del {
    font-size: 14px;
    line-height: 1;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
  }
  .btn-del:hover {
    color: var(--status-error);
  }
  .btn-del:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .empty-state {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
```

- [ ] **Step 3: Type check**

Run: `npm run check`
Expected: no errors. The whole project should now type-check cleanly.

- [ ] **Step 4: Confirm no stale references remain**

Run: `grep -rn "generateHeroTitles\|isGenerationInProgress" src`
Expected: no matches (the old exports are fully removed and unreferenced).

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin/hero/+page.server.ts src/routes/admin/hero/+page.svelte
git commit -m "Rebuild /admin/hero with style, length, variants and preview"
```

---

### Task 7: Verify end-to-end and deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests green, including `hero-titles-buckets` and `hero-titles-service`.

- [ ] **Step 2: Type check the whole project**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Exercise the page on the dev server**

Run: `npm run dev` and open `http://homeserv:5173/admin/hero`.

Verify:
- The controls render: style textarea, two sliders, variants input, Generate button.
- Set variants to 1, click **Generate preview** — the button shows "batch N/3" progress, then a preview table of 150 rows appears with the Replace/Append radios and Save/Discard.
- Click **Save** with **Replace pool** selected — the preview clears and the saved pool table shows 150 entries.
- Type a style (e.g. "noir detective voice"), set variants to 2, Generate again — preview shows 300 rows; the progress runs batch N/6.
- Save with **Append to pool** — the saved pool grows; appended rows show the style text in the Style column.
- Delete a single row with the `×` control — the pool count drops by one.
- **Clear pool** — confirms, then empties the pool.
- Load `http://homeserv:5173/` a few times and confirm the hero copy still renders (and varies if multiple variants are saved).

If the UI cannot be exercised in a browser, say so explicitly rather than claiming success.

- [ ] **Step 4: Deploy and verify live**

Push the branch, then run the deploy script:

```bash
git push
~/strange_rambling_svelte/scripts/deploy.sh
```

After the deploy completes, verify `https://strangeramblings.com/admin/hero` loads the new page and that the landing page hero still renders. If the build fails, suspect a stale `.svelte-kit/output` and do a clean rebuild.

---

## Self-Review

**Spec coverage:**
- Data model (drop unique index, add `style`) → Task 1. ✓
- Batch generation service, save modes, parameterised validation, random snap → Task 3. ✓
- `enumerateUnits` → Task 2. ✓
- Endpoints (generate / save / delete) → Task 5. ✓
- Admin page (style box, length sliders, variants input, batch loop, preview, save modes, pool delete / clear) → Task 6. ✓
- Landing page random variant → Task 3 (`snapHeroTitle` + `pickVariant`); the landing `+page.server.ts` needs no change since `snapHeroTitle` keeps its signature. ✓
- Scheduler via `runFullGeneration` → Task 4. ✓
- Testing → Tasks 2 and 3. ✓
- Rollout (drizzle push, deploy, verify) → Tasks 1 and 7. ✓

**Placeholder scan:** No TBD / TODO / "handle edge cases" — every step has complete code or an exact command.

**Type consistency:** `GenParams`, `GeneratedRow`, `LengthLimits`, `BatchLLMFn`, `HeroTitleCopy` are defined in Task 3 and used consistently. `generateBatch`, `parseBatchResponse`, `enumerateUnits`, `saveHeroTitles`, `BATCH_SIZE`, `invalidateHeroTitlesCache`, `checkCopy`, `validateGenerated`, `pickVariant`, `runFullGeneration` keep one signature across the service, endpoints, scheduler, and page. The endpoints send `{ totalBatches, batchIndex, rows }`; the page reads exactly those fields. `validateGenerated` and `checkCopy` take `LengthLimits` everywhere they are called.

**Note on the landing page:** `src/routes/+page.server.ts` calls `snapHeroTitle({ hr, steps, temp })` — unchanged signature, so no edit is needed there. Confirmed against the current file during planning.
