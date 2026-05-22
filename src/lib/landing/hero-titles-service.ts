import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { enumerateGrid, snapToBuckets, type GridPoint } from './hero-titles-buckets';

export interface HeroTitleCopy {
  primary: string;
  ghost: string;
  strapTemplate: string;
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
}

export async function snapHeroTitle(input: SnapInput): Promise<HeroTitleCopy> {
  const key = snapToBuckets(input.hr, input.steps, input.temp);
  try {
    const rows = await loadRows();
    const row = rows.find(
      (r) =>
        r.hrBucket === key.hrBucket &&
        r.stepsBucket === key.stepsBucket &&
        r.tempBucket === key.tempBucket,
    );
    if (row) {
      return { primary: row.primary, ghost: row.ghost, strapTemplate: row.strapTemplate };
    }
  } catch (err) {
    console.warn('[hero-titles] snap fell back:', err instanceof Error ? err.message : err);
  }
  return FALLBACK[key.hrBucket];
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
        max_tokens: 600,
        // Disable GLM's extended reasoning. These prompts need a tiny JSON
        // object, not a chain of thought — with reasoning on, calls ran
        // ~25-90s and burned the token budget (empty content / timeouts);
        // off, they return in ~4s. `thinking` is a z.ai-specific param.
        // @ts-expect-error -- z.ai extension, absent from the OpenAI types
        thinking: { type: 'disabled' },
      },
      { signal: controller.signal },
    );
    const text = completion.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text) {
      console.warn(
        '[hero-titles] empty LLM response, finish:',
        completion.choices?.[0]?.finish_reason,
      );
      return null;
    }
    const parsed = tryParseJson(text);
    const valid = validateGenerated(parsed);
    if (!valid) {
      console.warn('[hero-titles] validation failed; raw:', JSON.stringify(text).slice(0, 200));
    }
    return valid;
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
          // Reasoning length varies per call — retry a failed bucket a couple
          // of times before falling back, so one over-long reasoning run
          // doesn't doom the bucket to fallback copy.
          for (let attempt = 0; attempt < 3 && !copy; attempt++) {
            try {
              copy = await llmCall(point);
            } catch (e) {
              console.warn('[hero-titles] generation call threw', e);
            }
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
