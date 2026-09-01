import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { resolveLandingModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
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
  const ctx = await resolveLandingModel();
  const { client, model } = await getLLMClient(ctx);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
  try {
    const completion = await withActivity('landing', () =>
      client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          temperature: 0.9,
          // Sized to the batch — ~260 tokens per entry plus headroom, capped.
          max_tokens: Math.min(16000, 400 + unitCount * 260),
        },
        { signal: controller.signal },
      ),
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
